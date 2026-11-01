import "server-only";

import { toDecimal } from "@/lib/money";
import type { DbOrTx } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/server/errors";
import { isUuid } from "@/server/shared/validation";

/**
 * Turns the short form on an invoice's page (amount, method, reference, date)
 * into an ordinary payment for that invoice's customer, applied to that invoice.
 * Up to what the invoice still owes goes to it; anything over stays on the
 * customer's account as credit. recordPayment then checks and posts it as usual
 * (locks, permissions, M-Pesa code, closed periods, double-submit protection).
 */
export async function invoicePaymentInput(
  db: DbOrTx,
  invoiceId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!isUuid(invoiceId)) throw new NotFoundError("Invoice not found");
  const inv = await db.salesDocument.findUnique({
    where: { id: invoiceId },
    select: {
      kind: true,
      status: true,
      deletedAt: true,
      customerId: true,
      total: true,
      amountPaid: true,
      amountCredited: true,
    },
  });
  if (!inv || inv.kind !== "INVOICE") throw new NotFoundError("Invoice not found");
  if (inv.status !== "POSTED" || inv.deletedAt) {
    throw new ValidationError({ form: ["Only posted invoices can be paid."] });
  }
  const outstanding = inv.total.minus(inv.amountPaid).minus(inv.amountCredited);
  if (outstanding.lessThanOrEqualTo(0)) {
    throw new ValidationError({ form: ["This invoice is already fully paid."] });
  }

  const raw = String(input.amount ?? "")
    .replace(/,/g, "")
    .trim();
  const valid = /^\d+(\.\d{1,2})?$/.test(raw) && toDecimal(raw).greaterThan(0);
  const toInvoice = valid ? (toDecimal(raw).lessThan(outstanding) ? toDecimal(raw) : outstanding) : null;

  return {
    customerId: inv.customerId,
    receivedOn: input.receivedOn,
    method: input.method,
    reference: input.reference,
    amount: input.amount,
    notes: input.notes,
    idempotencyKey: input.idempotencyKey,
    allocate: "manual",
    allocations: toInvoice ? [{ invoiceId, amount: toInvoice.toFixed(2) }] : [],
  };
}
