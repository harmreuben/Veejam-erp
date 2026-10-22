import "server-only";

import type { Customer } from "@/generated/prisma/client";
import type { CustomerType, RecordStatus } from "@/generated/prisma/enums";
import { toDecimal } from "@/lib/money";
import { normalizeKenyanPhone } from "@/lib/phone";
import { diffFields, writeAudit } from "@/server/audit/audit";
import { authorize, hasPermission, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { createCustomerSchema, updateCustomerSchema, type CustomerValues } from "./schemas";

type AuditActor = { id: string | null; email: string };

export type CustomerView = Omit<Customer, "creditLimit"> & { creditLimit: string };
const view = (c: Customer): CustomerView => ({ ...c, creditLimit: c.creditLimit.toFixed(2) });

/** Lower-case, single spaces, no punctuation: "Abdi  Wholesalers." → "abdi wholesalers". */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function listCustomers(
  db: Db,
  actor: Actor,
  filter: { q?: string; status?: RecordStatus | "ALL"; type?: CustomerType | "ALL" } = {},
) {
  authorize(actor, "customers.view");
  const q = filter.q?.trim();
  const phone = q ? normalizeKenyanPhone(q) : null;
  const rows = await db.customer.findMany({
    where: {
      ...(filter.status && filter.status !== "ALL" ? { status: filter.status } : {}),
      ...(filter.type && filter.type !== "ALL" ? { type: filter.type } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { town: { contains: q, mode: "insensitive" } },
              { contactPerson: { contains: q, mode: "insensitive" } },
              { kraPin: { equals: q.toUpperCase() } },
              { legacyNames: { has: q } },
              ...(phone ? [{ phone }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { priceList: { select: { code: true, name: true } } },
    take: 500,
  });
  return rows.map((r) => ({ ...view(r), priceList: r.priceList }));
}

export async function getCustomer(db: Db, actor: Actor, id: string) {
  authorize(actor, "customers.view");
  const c = await db.customer.findUnique({
    where: { id },
    include: {
      priceList: { select: { id: true, code: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  if (!c) throw new NotFoundError("That customer no longer exists.");
  return { ...view(c), priceList: c.priceList, createdBy: c.createdBy };
}

async function checkReferences(tx: DbOrTx, values: CustomerValues, exceptId?: string) {
  const errors: Record<string, string[]> = {};
  if (values.kraPin) {
    const same = await tx.customer.findUnique({
      where: { kraPin: values.kraPin },
      select: { id: true, name: true },
    });
    if (same && same.id !== exceptId) errors.kraPin = [`This KRA PIN belongs to ${same.name}`];
  }
  if (values.priceListId) {
    const list = await tx.priceList.findUnique({
      where: { id: values.priceListId },
      select: { status: true },
    });
    if (!list || list.status !== "ACTIVE") errors.priceListId = ["Choose an active price list"];
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

/** Customers whose name matches after ignoring case, spacing and punctuation. */
export async function findSameName(tx: DbOrTx, name: string, exceptId?: string) {
  const key = nameKey(name);
  const firstWord = key.split(" ")[0] ?? key;
  const candidates = await tx.customer.findMany({
    where: {
      name: { contains: firstWord, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, code: true, name: true },
    take: 50,
  });
  return candidates.filter((c) => nameKey(c.name) === key);
}

const creditChanged = (values: CustomerValues, before?: { creditLimit: string; paymentTermsDays: number }) =>
  before
    ? !toDecimal(values.creditLimit).equals(before.creditLimit) ||
      values.paymentTermsDays !== before.paymentTermsDays
    : !toDecimal(values.creditLimit).isZero() || values.paymentTermsDays !== 0;

/** Insert a customer inside a transaction (assigns the next CUS- number). Shared with imports. */
export async function insertCustomer(
  tx: DbOrTx,
  actor: AuditActor,
  values: CustomerValues,
  ctx: AuditContext & { via?: string; legacyNames?: string[] } = {},
): Promise<Customer> {
  await checkReferences(tx, values);
  const code = await nextNumber(tx, "CUSTOMER");
  const customer = await tx.customer.create({
    data: { ...values, code, createdById: actor.id, legacyNames: ctx.legacyNames ?? [] },
  });
  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "CUSTOMER_CREATED",
    entityType: "Customer",
    entityId: customer.id,
    summary: `${code} ${customer.name}${ctx.via ? ` (${ctx.via})` : ""}`,
    after: values,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return customer;
}

/** Apply changes to a customer inside a transaction. Shared with imports. */
export async function applyCustomerUpdate(
  tx: DbOrTx,
  actor: AuditActor,
  current: Customer,
  values: CustomerValues,
  ctx: AuditContext & { via?: string; expectedVersion?: number } = {},
): Promise<Customer> {
  await checkReferences(tx, values, current.id);
  const changes = diffFields(
    { ...current, creditLimit: current.creditLimit.toFixed(2) } as Record<string, unknown>,
    values,
  );
  if (!changes) return current;
  const updated = await tx.customer.updateMany({
    where: { id: current.id, ...(ctx.expectedVersion ? { version: ctx.expectedVersion } : {}) },
    data: { ...values, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new ConflictError("Someone else changed this customer. Reload the page to see their changes.");
  }
  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "CUSTOMER_UPDATED",
    entityType: "Customer",
    entityId: current.id,
    summary: `${current.code}: ${Object.keys(changes.after).join(", ")}${ctx.via ? ` (${ctx.via})` : ""}`,
    before: changes.before as never,
    after: changes.after as never,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return tx.customer.findUniqueOrThrow({ where: { id: current.id } });
}

export async function createCustomer(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "customers.manage");
  const { allowDuplicateName, ...values } = parseInput(createCustomerSchema, input);
  if (creditChanged(values) && !hasPermission(actor, "customers.credit")) {
    throw new ForbiddenError("Only an owner, administrator or accountant can give credit or payment terms.");
  }
  return db.$transaction(async (tx) => {
    const same = await findSameName(tx, values.name);
    if (same.length && !allowDuplicateName) {
      throw new ValidationError({
        name: [
          `A customer with this name already exists (${same.map((s) => s.code).join(", ")}). ` +
            "If this really is a different business, tick “This is a different customer”.",
        ],
      });
    }
    return view(await insertCustomer(tx, actor, values, ctx));
  });
}

export async function updateCustomer(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "customers.manage");
  const { version, ...values } = parseInput(updateCustomerSchema, input);
  return db.$transaction(async (tx) => {
    const current = await tx.customer.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("That customer no longer exists.");
    if (current.version !== version) {
      throw new ConflictError("Someone else changed this customer. Reload the page to see their changes.");
    }
    if (
      creditChanged(values, {
        creditLimit: current.creditLimit.toFixed(2),
        paymentTermsDays: current.paymentTermsDays,
      }) &&
      !hasPermission(actor, "customers.credit")
    ) {
      throw new ForbiddenError(
        "Only an owner, administrator or accountant can change credit limits or payment terms.",
      );
    }
    return view(await applyCustomerUpdate(tx, actor, current, values, { ...ctx, expectedVersion: version }));
  });
}
