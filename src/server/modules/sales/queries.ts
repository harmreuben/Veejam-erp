import "server-only";

import type { SalesDocumentKind, SalesDocumentStatus, SellUnit } from "@/generated/prisma/enums";
import { fromDbDate } from "@/lib/dates";
import { authorize, hasPermission, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { isUuid } from "@/server/shared/validation";
import { availability } from "@/server/modules/inventory/stock";
import { getDefaultPriceListId } from "@/server/modules/pricing/service";

import { currentTaxRates } from "./pricing";
import { creditProblem, customerOutstanding } from "./service";

export async function listDocuments(
  db: Db,
  actor: Actor,
  kind: SalesDocumentKind,
  filter: { q?: string; status?: SalesDocumentStatus | "ALL" } = {},
) {
  authorize(actor, "sales.view");
  const q = filter.q?.trim();
  const rows = await db.salesDocument.findMany({
    where: {
      kind,
      ...(filter.status && filter.status !== "ALL" ? { status: filter.status } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { customer: { name: { contains: q, mode: "insensitive" } } },
              { customer: { code: { contains: q, mode: "insensitive" } } },
              { customerReference: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { customer: { select: { name: true, code: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return rows.map((d) => ({
    id: d.id,
    kind: d.kind,
    number: d.number,
    status: d.status,
    historical: d.historical,
    customer: d.customer,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    validUntil: d.validUntil,
    total: d.total.toFixed(2),
    outstanding: d.total.minus(d.amountPaid).minus(d.amountCredited).toFixed(2),
  }));
}

export async function getDocument(db: Db, actor: Actor, id: string) {
  authorize(actor, "sales.view");
  if (!isUuid(id)) throw new NotFoundError();
  const d = await db.salesDocument.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: { position: "asc" },
        include: { product: { select: { unitsPerPack: true, packsPerCarton: true } } },
      },
      customer: true,
      warehouse: { select: { id: true, name: true, code: true } },
      priceList: { select: { name: true } },
      sourceDocument: { select: { id: true, kind: true, number: true, status: true } },
      derivedDocuments: {
        select: { id: true, kind: true, number: true, status: true },
        orderBy: { createdAt: "asc" },
      },
      deliveryNote: { select: { id: true, number: true, status: true } },
      createdBy: { select: { fullName: true } },
      postedBy: { select: { fullName: true } },
      creditOverrideBy: { select: { fullName: true } },
      reservations: true,
      allocationsReceived: {
        where: { reversedAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          payment: { select: { id: true, number: true, method: true, receivedOn: true } },
          creditNote: { select: { id: true, number: true } },
        },
      },
      allocationsGiven: {
        where: { reversedAt: null },
        include: { invoice: { select: { id: true, number: true } } },
      },
    },
  });
  if (!d) throw new NotFoundError("That document no longer exists.");

  const stock =
    d.status === "POSTED" || d.status === "CANCELLED" || d.status === "INVOICED" || d.status === "CONVERTED"
      ? null
      : await availability(
          db,
          d.warehouseId,
          d.lines.map((l) => l.productId),
        );
  const outstanding = await customerOutstanding(db, d.customerId);
  const credit =
    d.kind === "INVOICE" && d.status === "DRAFT"
      ? creditProblem({
          creditLimit: d.customer.creditLimit.toFixed(2),
          outstanding,
          amount: d.total.toFixed(2),
        })
      : null;

  const shareLinks = hasPermission(actor, "documents.share")
    ? await db.documentShareLink.findMany({
        where: { documentId: id },
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { fullName: true } } },
      })
    : [];

  const company = await db.companySettings.findUnique({
    where: { id: 1 },
    select: { defaultPaymentTermsDays: true },
  });
  return {
    ...d,
    termsDays: d.customer.paymentTermsDays || (company?.defaultPaymentTermsDays ?? 0),
    issueDay: fromDbDate(d.issueDate),
    validUntilDay: d.validUntil ? fromDbDate(d.validUntil) : null,
    subtotal: d.subtotal.toFixed(2),
    discountTotal: d.discountTotal.toFixed(2),
    taxTotal: d.taxTotal.toFixed(2),
    total: d.total.toFixed(2),
    amountPaid: d.amountPaid.toFixed(2),
    amountCredited: d.amountCredited.toFixed(2),
    balanceDue: d.total.minus(d.amountPaid).minus(d.amountCredited).toFixed(2),
    settlements: d.allocationsReceived.map((a) => ({
      id: a.id,
      amount: a.amount.toFixed(2),
      createdAt: a.createdAt,
      payment: a.payment,
      creditNote: a.creditNote,
    })),
    creditsGiven: d.allocationsGiven.map((a) => ({
      id: a.id,
      amount: a.amount.toFixed(2),
      invoice: a.invoice,
    })),
    customer: { ...d.customer, creditLimit: d.customer.creditLimit.toFixed(2) },
    lines: d.lines.map((l) => ({
      ...l,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercent: l.discountPercent.toFixed(2),
      taxRate: l.taxRate.toFixed(4),
      netAmount: l.netAmount.toFixed(2),
      discountAmount: l.discountAmount.toFixed(2),
      taxAmount: l.taxAmount.toFixed(2),
      grossAmount: l.grossAmount.toFixed(2),
      stock: stock?.get(l.productId) ?? null,
      reservedHere: d.reservations.find((r) => r.productId === l.productId)?.quantity ?? 0,
    })),
    outstanding,
    creditProblem: credit,
    shareLinks,
  };
}
export type SalesDocumentDetail = Awaited<ReturnType<typeof getDocument>>;

/**
 * Everything the document editor needs: active customers, warehouses,
 * products with every price, and tax rates, so the browser can show totals
 * as you type. The server works everything out again when saving.
 */
export async function editorData(db: Db, actor: Actor) {
  authorize(actor, "sales.view");
  const [customers, warehouses, products, lists, items, rates, defaultId, balances, reservations] =
    await Promise.all([
      db.customer.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, priceListId: true, paymentTermsDays: true },
      }),
      db.warehouse.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.product.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          unitsPerPack: true,
          packsPerCarton: true,
          taxCategory: true,
        },
      }),
      db.priceList.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, pricesIncludeTax: true },
      }),
      db.priceListItem.findMany({
        where: { priceList: { status: "ACTIVE" } },
        select: { priceListId: true, productId: true, unit: true, price: true },
      }),
      currentTaxRates(db),
      getDefaultPriceListId(db),
      db.stockBalance.findMany({ select: { productId: true, warehouseId: true, quantity: true } }),
      db.stockReservation.groupBy({ by: ["productId", "warehouseId"], _sum: { quantity: true } }),
    ]);

  const prices: Record<string, Record<string, string>> = {};
  for (const i of items) {
    (prices[i.priceListId] ??= {})[`${i.productId}|${i.unit}`] = i.price.toFixed(2);
  }
  const available: Record<string, Record<string, number>> = {};
  for (const b of balances) (available[b.productId] ??= {})[b.warehouseId] = b.quantity;
  for (const r of reservations) {
    const row = (available[r.productId] ??= {});
    row[r.warehouseId] = (row[r.warehouseId] ?? 0) - (r._sum.quantity ?? 0);
  }
  return {
    customers,
    warehouses,
    products: products.map((p) => ({ ...p, available: available[p.id] ?? {} })),
    priceLists: lists,
    prices,
    taxRates: Object.fromEntries(rates) as Record<string, string>,
    defaultPriceListId: defaultId,
    canDiscount: hasPermission(actor, "sales.discount"),
    canPost: hasPermission(actor, "invoices.post"),
  };
}
export type EditorData = Awaited<ReturnType<typeof editorData>>;

export type EditorLine = { productId: string; unit: SellUnit; quantity: number; discountPercent: string };
