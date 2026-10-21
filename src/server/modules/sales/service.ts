import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { SalesDocumentKind, SalesDocumentStatus } from "@/generated/prisma/enums";
import { addDays, toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { writeAudit } from "@/server/audit/audit";
import { authorize, hasPermission, type Actor, type Permission } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { invoiceJournal, postJournal } from "@/server/modules/accounting/journal";
import { customerBalance } from "@/server/modules/payments/service";
import { applyStockChanges, releaseReservations, reserveStock } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { discountsOf, priceDocument, pricesDiffer, type Priced } from "./pricing";
import {
  draftSchema,
  EDITABLE_STATUSES,
  KIND_LABELS,
  postInvoiceSchema,
  reasonSchema,
  updateDraftSchema,
  versionOnlySchema,
  type DraftValues,
} from "./schemas";

export const MANAGE_PERMISSION: Record<SalesDocumentKind, Permission> = {
  QUOTATION: "quotations.manage",
  SALES_ORDER: "orders.manage",
  INVOICE: "invoices.manage",
  CREDIT_NOTE: "credit_notes.manage",
};

const SEQUENCE: Record<"QUOTATION" | "SALES_ORDER", "QUOTATION" | "SALES_ORDER"> = {
  QUOTATION: "QUOTATION",
  SALES_ORDER: "SALES_ORDER",
};

/** "INV-000012" for posted invoices, "Draft invoice" for drafts. */
export function documentLabel(d: { kind: SalesDocumentKind; number: string | null }): string {
  return d.number ?? `Draft ${KIND_LABELS[d.kind].one.toLowerCase()}`;
}

async function activeCustomer(tx: DbOrTx, id: string) {
  const c = await tx.customer.findUnique({ where: { id } });
  if (!c || c.status !== "ACTIVE") throw new ValidationError({ customerId: ["Choose an active customer"] });
  return c;
}

async function activeWarehouse(tx: DbOrTx, id: string) {
  const w = await tx.warehouse.findUnique({ where: { id } });
  if (!w || w.status !== "ACTIVE") throw new ValidationError({ warehouseId: ["Choose an active warehouse"] });
  return w;
}

/** Lock the document row for the rest of the transaction, then read it. */
async function lockDocument(tx: DbOrTx, id: string) {
  await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${id}::uuid FOR UPDATE`;
  const doc = await tx.salesDocument.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!doc) throw new NotFoundError("That document no longer exists.");
  return doc;
}

function assertVersion(
  doc: { version: number; kind: SalesDocumentKind; number: string | null },
  version: number,
) {
  if (doc.version !== version) {
    throw new ConflictError(
      `${documentLabel(doc)} was changed by someone else while you had it open. Reload to see the latest version.`,
    );
  }
}

const lineRows = (priced: Priced) =>
  priced.lines.map((l) => ({
    position: l.position,
    productId: l.productId,
    sku: l.sku,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    piecesPerUnit: l.piecesPerUnit,
    pieces: l.pieces,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent,
    taxCategory: l.taxCategory,
    taxRate: l.taxRate,
    netAmount: l.netAmount,
    discountAmount: l.discountAmount,
    taxAmount: l.taxAmount,
    grossAmount: l.grossAmount,
  }));

const totalsData = (priced: Priced) => ({
  priceListId: priced.priceListId,
  pricesIncludeTax: priced.pricesIncludeTax,
  subtotal: priced.totals.subtotal,
  discountTotal: priced.totals.discountTotal,
  taxTotal: priced.totals.taxTotal,
  total: priced.totals.total,
});

const auditBase = (actor: Actor, ctx: AuditContext) => ({
  actorUserId: actor.id,
  actorLabel: actor.email,
  ...ctx,
});

// ─── Drafts ─────────────────────────────────────────────────────────

/** Create a draft quotation, sales order or invoice. Quotes and orders get their number now; invoices when posted. */
export async function createDraft(
  db: Db,
  actor: Actor,
  kind: Exclude<SalesDocumentKind, "CREDIT_NOTE">,
  input: unknown,
  ctx: AuditContext = {},
): Promise<{ id: string; number: string | null }> {
  authorize(actor, MANAGE_PERMISSION[kind]);
  const values = parseInput(draftSchema, input);
  return db.$transaction(async (tx) => {
    const customer = await activeCustomer(tx, values.customerId);
    await activeWarehouse(tx, values.warehouseId);
    const priced = await priceDocument(tx, actor, { customer, lines: values.lines, sourceDocumentId: null });
    const number = kind === "INVOICE" ? null : await nextNumber(tx, SEQUENCE[kind]);
    const doc = await tx.salesDocument.create({
      data: {
        kind,
        number,
        customerId: customer.id,
        warehouseId: values.warehouseId,
        issueDate: toDbDate(values.issueDate),
        validUntil: kind === "QUOTATION" && values.validUntil ? toDbDate(values.validUntil) : null,
        customerReference: values.customerReference,
        notes: values.notes,
        createdById: actor.id,
        ...totalsData(priced),
        lines: { create: lineRows(priced) },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SALES_DOCUMENT_CREATED",
      entityType: "SalesDocument",
      entityId: doc.id,
      summary: `${documentLabel(doc)} for ${customer.name}: ${formatKES(priced.totals.total)}`,
      after: { kind, customerId: customer.id, total: priced.totals.total, lines: priced.lines.length },
    });
    return { id: doc.id, number };
  });
}

/** Replace a draft's header and lines. Prices and totals are worked out again from the price list. */
export async function updateDraft(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<void> {
  const values = parseInput(updateDraftSchema, input);
  await db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, id);
    authorize(actor, MANAGE_PERMISSION[doc.kind]);
    assertVersion(doc, values.version);
    if (!EDITABLE_STATUSES[doc.kind].includes(doc.status)) {
      throw new ConflictError(
        `${documentLabel(doc)} is ${doc.status.toLowerCase()} and can no longer be edited.`,
      );
    }
    if (doc.sourceDocumentId && values.customerId !== doc.customerId) {
      throw new ValidationError({
        customerId: ["This was converted from another document, so the customer can't change"],
      });
    }
    const customer = await activeCustomer(tx, values.customerId);
    await activeWarehouse(tx, values.warehouseId);
    const priced = await priceDocument(tx, actor, {
      customer,
      lines: values.lines,
      sourceDocumentId: doc.sourceDocumentId,
      existingDiscounts: discountsOf(doc.lines),
    });
    await tx.salesDocumentLine.deleteMany({ where: { documentId: id } });
    await tx.salesDocument.update({
      where: { id },
      data: {
        customerId: customer.id,
        warehouseId: values.warehouseId,
        issueDate: toDbDate(values.issueDate),
        validUntil: doc.kind === "QUOTATION" && values.validUntil ? toDbDate(values.validUntil) : null,
        customerReference: values.customerReference,
        notes: values.notes,
        version: { increment: 1 },
        ...totalsData(priced),
        lines: { create: lineRows(priced) },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SALES_DOCUMENT_UPDATED",
      entityType: "SalesDocument",
      entityId: id,
      summary: `${documentLabel(doc)} edited: ${formatKES(doc.total.toFixed(2))} → ${formatKES(priced.totals.total)}`,
      before: { total: doc.total.toFixed(2), lines: doc.lines.length, customerId: doc.customerId },
      after: { total: priced.totals.total, lines: priced.lines.length, customerId: customer.id },
    });
  });
}

// ─── Quotations ─────────────────────────────────────────────────────

const QUOTE_MOVES: Record<"SENT" | "ACCEPTED" | "DECLINED", SalesDocumentStatus[]> = {
  SENT: ["DRAFT"],
  ACCEPTED: ["DRAFT", "SENT", "DECLINED"],
  DECLINED: ["DRAFT", "SENT", "ACCEPTED"],
};

export async function setQuotationStatus(
  db: Db,
  actor: Actor,
  id: string,
  to: "SENT" | "ACCEPTED" | "DECLINED",
  input: unknown,
  ctx: AuditContext = {},
): Promise<void> {
  authorize(actor, "quotations.manage");
  const { version } = parseInput(versionOnlySchema, input);
  await db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, id);
    if (doc.kind !== "QUOTATION") throw new NotFoundError();
    assertVersion(doc, version);
    if (!QUOTE_MOVES[to].includes(doc.status)) {
      throw new ConflictError(
        `${doc.number} is ${doc.status.toLowerCase()}; it can't be marked ${to.toLowerCase()}.`,
      );
    }
    await tx.salesDocument.update({ where: { id }, data: { status: to, version: { increment: 1 } } });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "QUOTATION_STATUS_CHANGED",
      entityType: "SalesDocument",
      entityId: id,
      summary: `${doc.number}: ${doc.status} → ${to}`,
      before: { status: doc.status },
      after: { status: to },
    });
  });
}

// ─── Conversion ─────────────────────────────────────────────────────

/**
 * Turn a quotation into a sales order or invoice, or a confirmed order into an
 * invoice. The new document is a draft with the same lines; quoted prices are
 * kept while the quotation is valid, and order prices are always kept.
 * Converting twice returns the document made the first time.
 */
export async function convertDocument(
  db: Db,
  actor: Actor,
  id: string,
  target: "SALES_ORDER" | "INVOICE",
  ctx: AuditContext = {},
): Promise<{ id: string; kind: SalesDocumentKind; alreadyConverted: boolean }> {
  authorize(actor, MANAGE_PERMISSION[target]);
  return db.$transaction(async (tx) => {
    const source = await lockDocument(tx, id);
    const allowed =
      (source.kind === "QUOTATION" && ["DRAFT", "SENT", "ACCEPTED"].includes(source.status)) ||
      (source.kind === "SALES_ORDER" && target === "INVOICE" && source.status === "CONFIRMED");

    const existing = await tx.salesDocument.findFirst({
      where: { sourceDocumentId: id, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
    });
    if (existing && (source.status === "CONVERTED" || source.kind === "SALES_ORDER")) {
      return { id: existing.id, kind: existing.kind, alreadyConverted: true };
    }
    if (!allowed) {
      throw new ConflictError(
        source.kind === "SALES_ORDER" && source.status === "DRAFT"
          ? `Confirm ${source.number} first; confirming reserves the stock.`
          : `${documentLabel(source)} is ${source.status.toLowerCase()} and can't be converted.`,
      );
    }

    const customer = await activeCustomer(tx, source.customerId);
    await activeWarehouse(tx, source.warehouseId);
    const priced = await priceDocument(tx, actor, {
      customer,
      lines: source.lines.map((l) => ({
        productId: l.productId,
        unit: l.unit,
        quantity: l.quantity,
        discountPercent: l.discountPercent.toFixed(2),
      })),
      sourceDocumentId: source.id,
    });
    const number = target === "INVOICE" ? null : await nextNumber(tx, "SALES_ORDER");
    const doc = await tx.salesDocument.create({
      data: {
        kind: target,
        number,
        customerId: customer.id,
        warehouseId: source.warehouseId,
        issueDate: toDbDate(todayInNairobi()),
        customerReference: source.customerReference,
        notes: source.notes,
        sourceDocumentId: source.id,
        createdById: actor.id,
        ...totalsData(priced),
        lines: { create: lineRows(priced) },
      },
    });
    if (source.kind === "QUOTATION") {
      await tx.salesDocument.update({
        where: { id: source.id },
        data: { status: "CONVERTED", version: { increment: 1 } },
      });
    }
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SALES_DOCUMENT_CONVERTED",
      entityType: "SalesDocument",
      entityId: doc.id,
      summary: `${documentLabel(source)} → ${documentLabel(doc)}`,
      after: { sourceId: source.id, total: priced.totals.total },
    });
    return { id: doc.id, kind: target, alreadyConverted: false };
  });
}

// ─── Sales orders ───────────────────────────────────────────────────

/** Confirm a draft order. Its stock is reserved, so nobody else can sell it. */
export async function confirmOrder(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<{ alreadyConfirmed: boolean }> {
  authorize(actor, "orders.manage");
  const { version } = parseInput(versionOnlySchema, input);
  return db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, id);
    if (doc.kind !== "SALES_ORDER") throw new NotFoundError();
    if (doc.status === "CONFIRMED" && doc.version === version + 1) return { alreadyConfirmed: true };
    assertVersion(doc, version);
    if (doc.status !== "DRAFT") throw new ConflictError(`${doc.number} is ${doc.status.toLowerCase()}.`);
    await activeCustomer(tx, doc.customerId);
    await activeWarehouse(tx, doc.warehouseId);
    await reserveStock(
      tx,
      doc.id,
      doc.lines.map((l) => ({ productId: l.productId, warehouseId: doc.warehouseId, quantity: l.pieces })),
    );
    await tx.salesDocument.update({
      where: { id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), version: { increment: 1 } },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SALES_ORDER_CONFIRMED",
      entityType: "SalesDocument",
      entityId: id,
      summary: `${doc.number} confirmed; stock reserved for ${doc.lines.length} line(s)`,
      after: { reserved: doc.lines.map((l) => ({ productId: l.productId, pieces: l.pieces })) },
    });
    return { alreadyConfirmed: false };
  });
}

// ─── Cancelling ─────────────────────────────────────────────────────

const CANCELLABLE: Record<SalesDocumentKind, SalesDocumentStatus[]> = {
  QUOTATION: ["DRAFT", "SENT", "ACCEPTED", "DECLINED"],
  SALES_ORDER: ["DRAFT", "CONFIRMED"],
  INVOICE: ["DRAFT"],
  CREDIT_NOTE: [],
};

export async function cancelDocument(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<void> {
  const values = parseInput(reasonSchema, input);
  await db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, id);
    authorize(actor, MANAGE_PERMISSION[doc.kind]);
    assertVersion(doc, values.version);
    if (doc.kind === "INVOICE" && doc.status === "POSTED") {
      throw new ConflictError(
        `${doc.number} is posted and can't be cancelled. Correct it with a credit note (coming in Phase 5).`,
      );
    }
    if (!CANCELLABLE[doc.kind].includes(doc.status)) {
      throw new ConflictError(`${documentLabel(doc)} is ${doc.status.toLowerCase()} and can't be cancelled.`);
    }
    if (doc.kind === "SALES_ORDER") {
      const draftInvoice = await tx.salesDocument.findFirst({
        where: { sourceDocumentId: id, kind: "INVOICE", status: "DRAFT" },
      });
      if (draftInvoice) {
        throw new ConflictError(`There is a draft invoice for ${doc.number}. Cancel that draft first.`);
      }
      await releaseReservations(tx, id);
    }
    await tx.salesDocument.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: values.reason,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SALES_DOCUMENT_CANCELLED",
      entityType: "SalesDocument",
      entityId: id,
      summary: `${documentLabel(doc)} cancelled: ${values.reason}`,
      before: { status: doc.status },
      after: { status: "CANCELLED", reason: values.reason },
    });
  });
}

// ─── Credit ─────────────────────────────────────────────────────────

/** What a customer owes overall: unpaid invoices less payments and credit notes not yet applied. */
export async function customerOutstanding(db: DbOrTx, customerId: string): Promise<string> {
  return (await customerBalance(db, customerId)).balance;
}

/**
 * Credit rule:
 *  - a credit limit above 0: what they owe plus this invoice must stay within it;
 *  - a credit limit of 0 means cash only: they may not owe anything else when a new invoice is posted.
 */
export function creditProblem(args: {
  creditLimit: string;
  outstanding: string;
  amount: string;
}): string | null {
  const limit = toDecimal(args.creditLimit);
  const owed = toDecimal(args.outstanding);
  if (limit.isZero()) {
    return owed.greaterThan(0)
      ? `This is a cash-only customer and they still owe ${formatKES(owed)} on earlier invoices.`
      : null;
  }
  const after = owed.plus(toDecimal(args.amount));
  return after.greaterThan(limit)
    ? `This takes them to ${formatKES(after)} owed, over their credit limit of ${formatKES(limit)} (already owing ${formatKES(owed)}).`
    : null;
}

// ─── Posting invoices ───────────────────────────────────────────────

export type PostInvoiceResult = { number: string; alreadyPosted: boolean };

/**
 * Post a draft invoice, in one transaction:
 *  1. lock the draft (a second click waits, then sees it's already posted);
 *  2. price every line again; if anything changed since the draft was saved,
 *     save the new prices and stop, so nobody posts figures they haven't seen;
 *  3. check the customer's credit (an owner or admin may override, with a reason);
 *  4. give it the next INV- number, today's date and its due date;
 *  5. take the stock out (releasing the order's reservation first);
 *  6. freeze company and customer details for reprints, and write the audit.
 * After posting, the database refuses any change to the invoice or its lines.
 */
export async function postInvoice(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<PostInvoiceResult> {
  authorize(actor, "invoices.post");
  const values = parseInput(postInvoiceSchema, input);

  const outcome = await db.$transaction(async (tx) => {
    const doc = await lockDocument(tx, id);
    if (doc.kind !== "INVOICE") throw new NotFoundError();
    if (doc.status === "POSTED") return { kind: "posted" as const, number: doc.number!, already: true };
    assertVersion(doc, values.version);
    if (doc.status !== "DRAFT") throw new ConflictError(`This invoice is ${doc.status.toLowerCase()}.`);

    // Customer row lock: two invoices for one customer are credit-checked one after the other.
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${doc.customerId}::uuid FOR UPDATE`;
    const customer = await activeCustomer(tx, doc.customerId);
    const warehouse = await activeWarehouse(tx, doc.warehouseId);

    const priced = await priceDocument(tx, actor, {
      customer,
      lines: doc.lines.map((l) => ({
        productId: l.productId,
        unit: l.unit,
        quantity: l.quantity,
        discountPercent: l.discountPercent.toFixed(2),
      })),
      sourceDocumentId: doc.sourceDocumentId,
      existingDiscounts: discountsOf(doc.lines),
    });
    if (pricesDiffer(doc.lines, priced.lines) || doc.pricesIncludeTax !== priced.pricesIncludeTax) {
      await tx.salesDocumentLine.deleteMany({ where: { documentId: id } });
      await tx.salesDocument.update({
        where: { id },
        data: { ...totalsData(priced), version: { increment: 1 }, lines: { create: lineRows(priced) } },
      });
      await writeAudit(tx, {
        ...auditBase(actor, ctx),
        action: "INVOICE_REPRICED",
        entityType: "SalesDocument",
        entityId: id,
        summary: `Draft invoice repriced before posting: ${formatKES(doc.total.toFixed(2))} → ${formatKES(priced.totals.total)}`,
        before: { total: doc.total.toFixed(2) },
        after: { total: priced.totals.total },
      });
      return { kind: "repriced" as const, from: doc.total.toFixed(2), to: priced.totals.total };
    }

    let sourceOrder: { id: string; number: string | null } | null = null;
    if (doc.sourceDocumentId) {
      const src = await lockDocument(tx, doc.sourceDocumentId);
      if (src.kind === "SALES_ORDER") {
        if (src.status !== "CONFIRMED") {
          throw new ConflictError(
            `Sales order ${src.number} is ${src.status.toLowerCase()}; this invoice can't be posted.`,
          );
        }
        sourceOrder = { id: src.id, number: src.number };
      }
    }

    const outstanding = await customerOutstanding(tx, customer.id);
    const problem = creditProblem({
      creditLimit: customer.creditLimit.toFixed(2),
      outstanding,
      amount: doc.total.toFixed(2),
    });
    let override: { reason: string } | null = null;
    if (problem) {
      if (!values.creditOverrideReason) {
        throw new ConflictError(
          `Credit check failed for ${customer.name}. ${problem} ` +
            (hasPermission(actor.role, "credit.override")
              ? "To post anyway, give a reason for the override."
              : "Ask an owner or administrator to post it, or take payment first."),
        );
      }
      if (!hasPermission(actor.role, "credit.override")) {
        throw new ForbiddenError("Only an owner or administrator can override a credit limit.");
      }
      override = { reason: values.creditOverrideReason };
    }

    const number = await nextNumber(tx, "INVOICE");
    const today = todayInNairobi();
    const company = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });

    if (sourceOrder) await releaseReservations(tx, sourceOrder.id);
    await applyStockChanges(
      tx,
      doc.lines.map((l) => ({
        productId: l.productId,
        warehouseId: warehouse.id,
        quantity: -l.pieces,
        type: "SALE" as const,
      })),
      { type: "Invoice", id: doc.id, number, reason: `Sale to ${customer.name}`, actorId: actor.id },
      { respectReservations: true },
    );

    await tx.salesDocument.update({
      where: { id },
      data: {
        number,
        status: "POSTED",
        issueDate: toDbDate(today),
        dueDate: toDbDate(addDays(today, customer.paymentTermsDays || company.defaultPaymentTermsDays)),
        postedAt: new Date(),
        postedById: actor.id,
        creditOverrideById: override ? actor.id : null,
        creditOverrideReason: override?.reason ?? null,
        version: { increment: 1 },
        companySnapshot: {
          name: company.name,
          telephone: company.telephone,
          documentEmail: company.documentEmail,
          kraPin: company.kraPin,
          physicalAddress: company.physicalAddress,
          postalAddress: company.postalAddress,
          paymentInstructions: company.paymentInstructions,
          invoiceTerms: company.invoiceTerms,
          currency: company.currency,
        } satisfies Prisma.InputJsonObject,
        customerSnapshot: {
          code: customer.code,
          name: customer.name,
          contactPerson: customer.contactPerson,
          phone: customer.phone,
          email: customer.email,
          kraPin: customer.kraPin,
          physicalAddress: customer.physicalAddress,
          town: customer.town,
        } satisfies Prisma.InputJsonObject,
      },
    });
    if (sourceOrder) {
      await tx.salesDocument.update({
        where: { id: sourceOrder.id },
        data: { status: "INVOICED", version: { increment: 1 } },
      });
    }
    await postJournal(
      tx,
      invoiceJournal({
        id: doc.id,
        number,
        customerId: customer.id,
        customerName: customer.name,
        day: today,
        subtotal: doc.subtotal.toFixed(2),
        taxTotal: doc.taxTotal.toFixed(2),
        total: doc.total.toFixed(2),
        actorId: actor.id,
      }),
    );
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "INVOICE_POSTED",
      entityType: "SalesDocument",
      entityId: id,
      summary:
        `${number} posted for ${customer.name}: ${formatKES(doc.total.toFixed(2))}` +
        (override ? ` (credit limit overridden: ${override.reason})` : ""),
      after: {
        number,
        total: doc.total.toFixed(2),
        taxTotal: doc.taxTotal.toFixed(2),
        outstandingBefore: outstanding,
        creditOverride: override?.reason ?? null,
        fromOrder: sourceOrder?.number ?? null,
      },
    });
    return { kind: "posted" as const, number, already: false };
  });

  if (outcome.kind === "repriced") {
    throw new ConflictError(
      `Prices or tax rates changed since this draft was saved, so it has been updated (${formatKES(outcome.from)} → ${formatKES(outcome.to)}). Check it, then post again.`,
    );
  }
  return { number: outcome.number, alreadyPosted: outcome.already };
}

export type { DraftValues };
