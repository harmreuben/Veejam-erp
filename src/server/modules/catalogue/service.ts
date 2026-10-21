import "server-only";

import type { Product } from "@/generated/prisma/client";
import type { RecordStatus } from "@/generated/prisma/enums";
import { diffFields, writeAudit } from "@/server/audit/audit";
import { authorize, hasPermission, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  getDefaultPriceListId,
  writePrices,
  type AuditContext,
  type PriceEntry,
} from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { createProductSchema, updateProductSchema, type ProductValues, type UnitPrices } from "./schemas";

type AuditActor = { id: string | null; email: string };

/** Product as shown to a user; cost price is removed for roles that may not see it. */
export type ProductView = Omit<Product, "costPrice"> & { costPrice: string | null };

function view(p: Product, actor: Actor): ProductView {
  return {
    ...p,
    costPrice: hasPermission(actor.role, "catalogue.costs") ? (p.costPrice?.toFixed(2) ?? null) : null,
  };
}

export async function listProducts(
  db: Db,
  actor: Actor,
  filter: { q?: string; status?: RecordStatus | "ALL" } = {},
) {
  authorize(actor, "catalogue.view");
  const q = filter.q?.trim();
  const products = await db.product.findMany({
    where: {
      ...(filter.status && filter.status !== "ALL" ? { status: filter.status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { brand: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { barcode: { equals: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { brand: "asc" }, { name: "asc" }],
    include: { balances: { select: { quantity: true } } },
    take: 500,
  });
  return products.map(({ balances, ...p }) => {
    const onHand = balances.reduce((sum, b) => sum + b.quantity, 0);
    return { ...view(p, actor), onHand, lowStock: p.status === "ACTIVE" && onHand <= p.reorderLevel };
  });
}

export async function getProduct(db: Db, actor: Actor, id: string) {
  authorize(actor, "catalogue.view");
  const p = await db.product.findUnique({
    where: { id },
    include: {
      prices: { include: { priceList: { select: { id: true, code: true, name: true, status: true } } } },
      balances: { include: { warehouse: { select: { id: true, code: true, name: true } } } },
    },
  });
  if (!p) throw new NotFoundError("That product no longer exists.");
  const { prices, balances, ...product } = p;
  return {
    product: view(product, actor),
    prices: prices.map((x) => ({ ...x, price: x.price.toFixed(2) })),
    balances,
    defaultPriceListId: await getDefaultPriceListId(db),
  };
}

/** Uniqueness checks with field-level messages (SKU, barcode). */
async function assertUnique(tx: DbOrTx, values: { sku: string; barcode: string | null }, exceptId?: string) {
  const errors: Record<string, string[]> = {};
  const sameSku = await tx.product.findUnique({
    where: { sku: values.sku },
    select: { id: true, name: true },
  });
  if (sameSku && sameSku.id !== exceptId)
    errors.sku = [`SKU ${values.sku} is already used by ${sameSku.name}`];
  if (values.barcode) {
    const sameBarcode = await tx.product.findUnique({
      where: { barcode: values.barcode },
      select: { id: true, name: true },
    });
    if (sameBarcode && sameBarcode.id !== exceptId)
      errors.barcode = [`This barcode is already used by ${sameBarcode.name}`];
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

function priceEntries(productId: string, prices: UnitPrices | undefined): PriceEntry[] {
  if (!prices) return [];
  return (["PIECE", "PACK", "CARTON"] as const)
    .filter((unit) => prices[unit] !== null)
    .map((unit) => ({ productId, unit, price: prices[unit] }));
}

/** Insert a product (and optional default-list prices) inside a transaction. Shared with imports. */
export async function insertProduct(
  tx: DbOrTx,
  actor: AuditActor,
  values: ProductValues,
  prices: UnitPrices | undefined,
  ctx: AuditContext & { via?: string } = {},
): Promise<Product> {
  await assertUnique(tx, values);
  const product = await tx.product.create({ data: values });
  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: product.id,
    summary: `${product.sku} ${product.name}${ctx.via ? ` (${ctx.via})` : ""}`,
    after: values,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  const entries = priceEntries(product.id, prices);
  if (entries.length) {
    const listId = await getDefaultPriceListId(tx);
    if (!listId)
      throw new ConflictError("There is no default price list. Run the database seed or create one.");
    await writePrices(tx, actor, listId, entries, ctx);
  }
  return product;
}

/** Apply changes to an existing product inside a transaction. Shared with imports. */
export async function applyProductUpdate(
  tx: DbOrTx,
  actor: AuditActor,
  current: Product,
  values: ProductValues,
  ctx: AuditContext & { via?: string; expectedVersion?: number } = {},
): Promise<Product> {
  await assertUnique(tx, values, current.id);
  const comparable = { ...current, costPrice: current.costPrice?.toFixed(2) ?? null } as Record<
    string,
    unknown
  >;
  const changes = diffFields(comparable, values);
  if (!changes) return current;
  const updated = await tx.product.updateMany({
    where: { id: current.id, ...(ctx.expectedVersion ? { version: ctx.expectedVersion } : {}) },
    data: { ...values, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new ConflictError("Someone else changed this product. Reload the page to see their changes.");
  }
  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "PRODUCT_UPDATED",
    entityType: "Product",
    entityId: current.id,
    summary: `${values.sku}: ${Object.keys(changes.after).join(", ")}${ctx.via ? ` (${ctx.via})` : ""}`,
    before: changes.before as never,
    after: changes.after as never,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return tx.product.findUniqueOrThrow({ where: { id: current.id } });
}

export async function createProduct(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "catalogue.manage");
  const { prices, ...values } = parseInput(createProductSchema, input);
  if (values.costPrice !== null && !hasPermission(actor.role, "catalogue.costs")) {
    throw new ForbiddenError("Your role can't set cost prices.");
  }
  if (priceEntries("x", prices).length) authorize(actor, "pricing.manage");
  return db.$transaction((tx) => insertProduct(tx, actor, values, prices, ctx));
}

export async function updateProduct(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "catalogue.manage");
  const { version, ...values } = parseInput(updateProductSchema, input);
  return db.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("That product no longer exists.");
    if (!hasPermission(actor.role, "catalogue.costs")) {
      // Keep the stored cost: this role can't see it, so the form never sent it.
      values.costPrice = current.costPrice?.toFixed(2) ?? null;
    }
    if (current.version !== version) {
      throw new ConflictError("Someone else changed this product. Reload the page to see their changes.");
    }
    return applyProductUpdate(tx, actor, current, values, { ...ctx, expectedVersion: version });
  });
}
