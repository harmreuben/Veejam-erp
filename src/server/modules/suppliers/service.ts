import "server-only";

import type { Supplier } from "@/generated/prisma/client";
import type { RecordStatus } from "@/generated/prisma/enums";
import { normalizeKenyanPhone } from "@/lib/phone";
import { diffFields, writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  supplierFieldsSchema,
  updateSupplierSchema,
  type SupplierValues,
} from "@/server/modules/customers/schemas";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

type AuditActor = { id: string | null; email: string };

export async function listSuppliers(
  db: Db,
  actor: Actor,
  filter: { q?: string; status?: RecordStatus | "ALL" } = {},
) {
  authorize(actor, "suppliers.view");
  const q = filter.q?.trim();
  const phone = q ? normalizeKenyanPhone(q) : null;
  return db.supplier.findMany({
    where: {
      ...(filter.status && filter.status !== "ALL" ? { status: filter.status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { contactPerson: { contains: q, mode: "insensitive" } },
              ...(phone ? [{ phone }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: 500,
  });
}

export async function getSupplier(db: Db, actor: Actor, id: string) {
  authorize(actor, "suppliers.view");
  const s = await db.supplier.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("That supplier no longer exists.");
  return s;
}

async function checkKraPin(tx: DbOrTx, values: SupplierValues, exceptId?: string) {
  if (!values.kraPin) return;
  const same = await tx.supplier.findUnique({
    where: { kraPin: values.kraPin },
    select: { id: true, name: true },
  });
  if (same && same.id !== exceptId)
    throw new ValidationError({ kraPin: [`This KRA PIN belongs to ${same.name}`] });
}

export async function insertSupplier(
  tx: DbOrTx,
  actor: AuditActor,
  values: SupplierValues,
  ctx: AuditContext & { via?: string } = {},
): Promise<Supplier> {
  await checkKraPin(tx, values);
  const code = await nextNumber(tx, "SUPPLIER");
  const supplier = await tx.supplier.create({ data: { ...values, code } });
  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "SUPPLIER_CREATED",
    entityType: "Supplier",
    entityId: supplier.id,
    summary: `${code} ${supplier.name}${ctx.via ? ` (${ctx.via})` : ""}`,
    after: values,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return supplier;
}

export async function applySupplierUpdate(
  tx: DbOrTx,
  actor: AuditActor,
  current: Supplier,
  values: SupplierValues,
  ctx: AuditContext & { via?: string; expectedVersion?: number } = {},
): Promise<Supplier> {
  await checkKraPin(tx, values, current.id);
  const changes = diffFields(current as unknown as Record<string, unknown>, values);
  if (!changes) return current;
  const updated = await tx.supplier.updateMany({
    where: { id: current.id, ...(ctx.expectedVersion ? { version: ctx.expectedVersion } : {}) },
    data: { ...values, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new ConflictError("Someone else changed this supplier. Reload the page to see their changes.");
  }
  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "SUPPLIER_UPDATED",
    entityType: "Supplier",
    entityId: current.id,
    summary: `${current.code}: ${Object.keys(changes.after).join(", ")}${ctx.via ? ` (${ctx.via})` : ""}`,
    before: changes.before as never,
    after: changes.after as never,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  return tx.supplier.findUniqueOrThrow({ where: { id: current.id } });
}

export async function createSupplier(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "suppliers.manage");
  const values = parseInput(supplierFieldsSchema, input);
  return db.$transaction((tx) => insertSupplier(tx, actor, values, ctx));
}

export async function updateSupplier(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "suppliers.manage");
  const { version, ...values } = parseInput(updateSupplierSchema, input);
  return db.$transaction(async (tx) => {
    const current = await tx.supplier.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("That supplier no longer exists.");
    if (current.version !== version) {
      throw new ConflictError("Someone else changed this supplier. Reload the page to see their changes.");
    }
    return applySupplierUpdate(tx, actor, current, values, { ...ctx, expectedVersion: version });
  });
}
