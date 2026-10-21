import "server-only";

import { z } from "zod";

import type { SellUnit } from "@/generated/prisma/enums";
import { RecordStatus } from "@/generated/prisma/enums";
import { toDecimal } from "@/lib/money";
import { SELL_UNITS } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { codeSchema, moneyField, parseInput, requiredText } from "@/server/shared/validation";

export type AuditContext = { ipAddress?: string | null; userAgent?: string | null };
type AuditActor = { id: string | null; email: string };

// ─── Price lists ──────────────────────────────────────────────────

const priceListSchema = z.object({
  code: codeSchema("price list code"),
  name: requiredText(80, "Enter a name, e.g. Wholesale"),
  pricesIncludeTax: z
    .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  status: z.enum(RecordStatus).default("ACTIVE"),
});

export async function listPriceLists(db: Db, actor: Actor) {
  authorize(actor, "catalogue.view");
  const [lists, settings] = await Promise.all([
    db.priceList.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: true, customers: true } } },
    }),
    db.companySettings.findUnique({ where: { id: 1 }, select: { defaultPriceListId: true } }),
  ]);
  return lists.map((l) => ({ ...l, isDefault: l.id === settings?.defaultPriceListId }));
}

export async function getDefaultPriceListId(db: DbOrTx): Promise<string | null> {
  const s = await db.companySettings.findUnique({ where: { id: 1 }, select: { defaultPriceListId: true } });
  return s?.defaultPriceListId ?? null;
}

export async function createPriceList(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "pricing.manage");
  const values = parseInput(priceListSchema, input);
  return db.$transaction(async (tx) => {
    if (await tx.priceList.findUnique({ where: { code: values.code } })) {
      throw new ValidationError({ code: ["A price list with this code already exists"] });
    }
    const list = await tx.priceList.create({ data: values });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "PRICE_LIST_CREATED",
      entityType: "PriceList",
      entityId: list.id,
      summary: `${list.code} ${list.name}`,
      after: values,
      ...ctx,
    });
    return list;
  });
}

export async function updatePriceList(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "pricing.manage");
  const values = parseInput(priceListSchema.omit({ code: true }), input);
  return db.$transaction(async (tx) => {
    const current = await tx.priceList.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("That price list no longer exists.");
    if (values.status === "INACTIVE" && (await getDefaultPriceListId(tx)) === id) {
      throw new ConflictError(
        "This is the default price list. Choose another default before deactivating it.",
      );
    }
    const list = await tx.priceList.update({ where: { id }, data: values });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "PRICE_LIST_UPDATED",
      entityType: "PriceList",
      entityId: id,
      summary: `${current.code} updated`,
      before: { name: current.name, pricesIncludeTax: current.pricesIncludeTax, status: current.status },
      after: values,
      ...ctx,
    });
    return list;
  });
}

export async function setDefaultPriceList(db: Db, actor: Actor, id: string, ctx: AuditContext = {}) {
  authorize(actor, "pricing.manage");
  return db.$transaction(async (tx) => {
    const list = await tx.priceList.findUnique({ where: { id } });
    if (!list || list.status !== "ACTIVE") throw new NotFoundError("Choose an active price list.");
    const before = await getDefaultPriceListId(tx);
    await tx.companySettings.update({ where: { id: 1 }, data: { defaultPriceListId: id } });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "DEFAULT_PRICE_LIST_CHANGED",
      entityType: "CompanySettings",
      entityId: "1",
      summary: `Default price list: ${list.code}`,
      before: { defaultPriceListId: before },
      after: { defaultPriceListId: id },
      ...ctx,
    });
  });
}

// ─── Prices ───────────────────────────────────────────────────────

export type PriceEntry = { productId: string; unit: SellUnit; price: string | null };

/** All products with their prices on one list, for the price grid. */
export async function getPriceGrid(db: Db, actor: Actor, priceListId: string) {
  authorize(actor, "catalogue.view");
  const list = await db.priceList.findUnique({ where: { id: priceListId } });
  if (!list) throw new NotFoundError("That price list no longer exists.");
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
    select: {
      id: true,
      sku: true,
      name: true,
      unitsPerPack: true,
      packsPerCarton: true,
      prices: { where: { priceListId }, select: { unit: true, price: true } },
    },
  });
  return {
    list,
    isDefault: (await getDefaultPriceListId(db)) === priceListId,
    rows: products.map((p) => ({
      ...p,
      prices: Object.fromEntries(p.prices.map((x) => [x.unit, x.price.toFixed(2)])) as Partial<
        Record<SellUnit, string>
      >,
    })),
  };
}

const priceEntriesSchema = z
  .array(
    z.object({
      productId: z.uuid(),
      unit: z.enum(SELL_UNITS),
      price: moneyField({ allowBlank: true, min: "0.01" }),
    }),
  )
  .max(20_000);

/**
 * Write prices inside an existing transaction. A blank price removes the price
 * for that unit. Only real changes are written and audited; returns how many changed.
 */
export async function writePrices(
  tx: DbOrTx,
  actor: AuditActor,
  priceListId: string,
  entries: PriceEntry[],
  ctx: AuditContext & { via?: string } = {},
): Promise<number> {
  if (!entries.length) return 0;
  const productIds = [...new Set(entries.map((e) => e.productId))];
  const existing = await tx.priceListItem.findMany({ where: { priceListId, productId: { in: productIds } } });
  const key = (p: string, u: string) => `${p}:${u}`;
  const current = new Map(existing.map((e) => [key(e.productId, e.unit), e]));
  const changes: { productId: string; unit: SellUnit; before: string | null; after: string | null }[] = [];

  for (const entry of entries) {
    const was = current.get(key(entry.productId, entry.unit));
    const before = was ? was.price.toFixed(2) : null;
    const after = entry.price === null ? null : toDecimal(entry.price).toFixed(2);
    if (before === after) continue;
    if (after === null) {
      await tx.priceListItem.delete({ where: { id: was!.id } });
    } else {
      await tx.priceListItem.upsert({
        where: { priceListId_productId_unit: { priceListId, productId: entry.productId, unit: entry.unit } },
        create: {
          priceListId,
          productId: entry.productId,
          unit: entry.unit,
          price: after,
          updatedById: actor.id,
        },
        update: { price: after, updatedById: actor.id },
      });
    }
    changes.push({ productId: entry.productId, unit: entry.unit, before, after });
  }

  if (changes.length) {
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "PRICES_CHANGED",
      entityType: "PriceList",
      entityId: priceListId,
      summary: `${changes.length} price${changes.length === 1 ? "" : "s"} changed${ctx.via ? ` (${ctx.via})` : ""}`,
      metadata: { changes },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
  return changes.length;
}

export async function savePrices(
  db: Db,
  actor: Actor,
  priceListId: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<number> {
  authorize(actor, "pricing.manage");
  const entries = parseInput(priceEntriesSchema, input);
  return db.$transaction(async (tx) => {
    const list = await tx.priceList.findUnique({ where: { id: priceListId } });
    if (!list) throw new NotFoundError("That price list no longer exists.");
    const known = await tx.product.count({
      where: { id: { in: [...new Set(entries.map((e) => e.productId))] } },
    });
    if (known !== new Set(entries.map((e) => e.productId)).size) {
      throw new ConflictError("Some products no longer exist. Reload the page.");
    }
    return writePrices(tx, actor, priceListId, entries, ctx);
  });
}

/**
 * The price to charge for a product in a unit: the customer's own price list
 * first, then the default list. Null when neither has a price.
 * Used by quotations and invoices from Phase 4.
 */
export async function resolvePrice(
  db: DbOrTx,
  args: { productId: string; unit: SellUnit; customerId?: string | null },
): Promise<{ price: string; priceListId: string; pricesIncludeTax: boolean } | null> {
  const lists: string[] = [];
  if (args.customerId) {
    const c = await db.customer.findUnique({ where: { id: args.customerId }, select: { priceListId: true } });
    if (c?.priceListId) lists.push(c.priceListId);
  }
  const def = await getDefaultPriceListId(db);
  if (def && !lists.includes(def)) lists.push(def);
  for (const priceListId of lists) {
    const item = await db.priceListItem.findUnique({
      where: { priceListId_productId_unit: { priceListId, productId: args.productId, unit: args.unit } },
      include: { priceList: { select: { status: true, pricesIncludeTax: true } } },
    });
    if (item && item.priceList.status === "ACTIVE") {
      return { price: item.price.toFixed(2), priceListId, pricesIncludeTax: item.priceList.pricesIncludeTax };
    }
  }
  return null;
}
