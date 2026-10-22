import "server-only";

import type { Db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { phoneDisplay, type Printable } from "@/server/modules/sales/pdf";
import { isUuid } from "@/server/shared/validation";

import { PO_STATUS_LABELS } from "./schemas";

const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Africa/Nairobi" });

/** A purchase order in VeeJam's document design, to send to the supplier. */
export async function loadPrintablePurchaseOrder(db: Db, id: string): Promise<Printable> {
  if (!isUuid(id)) throw new NotFoundError();
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: true,
      createdBy: { select: { fullName: true } },
      lines: {
        orderBy: { position: "asc" },
        include: { product: { select: { unitsPerPack: true, packsPerCarton: true } } },
      },
    },
  });
  if (!po) throw new NotFoundError();
  const settings = await db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const s = po.supplier;
  const tone = po.status === "CANCELLED" ? "grey" : po.status === "DRAFT" ? "amber" : "green";
  return {
    variant: "PURCHASE_ORDER",
    title: "PURCHASE ORDER",
    number: po.number,
    draft: po.status === "DRAFT",
    cancelled: po.status === "CANCELLED",
    status: { label: PO_STATUS_LABELS[po.status], tone },
    meta: [
      ["PO #", po.number],
      ["Date", longDate.format(po.orderDate)],
      ...(po.expectedDate ? ([["Deliver By", longDate.format(po.expectedDate)]] as [string, string][]) : []),
      ["Ordered By", po.createdBy.fullName],
    ],
    company: {
      name: settings.name,
      tagline: settings.tagline,
      kraPin: settings.kraPin,
      telephone: phoneDisplay(settings.telephone),
      email: settings.documentEmail,
      address: [settings.physicalAddress, settings.postalAddress].filter(Boolean).join(", ") || null,
      vatRegistered: settings.vatRegistered,
      paybill: null,
      account: null,
      paymentInstructions: null,
      terms: null,
    },
    customer: {
      name: s.name,
      lines: [
        s.contactPerson,
        s.physicalAddress,
        phoneDisplay(s.phone) ? `Tel: ${phoneDisplay(s.phone)}` : null,
        s.email,
        s.kraPin ? `KRA PIN: ${s.kraPin}` : null,
      ].filter((x): x is string => Boolean(x)),
      kraPin: s.kraPin,
    },
    lines: po.lines.map((l) => ({
      sku: l.sku,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      pieces: l.pieces,
      sizes: l.product,
      unitPrice: l.unitCost.toFixed(2),
      discountPercent: "0",
      taxRate: l.taxRate.toFixed(4),
      netAmount: l.netAmount.toFixed(2),
      discountAmount: "0",
      taxAmount: l.taxAmount.toFixed(2),
      grossAmount: l.grossAmount.toFixed(2),
    })),
    pricesIncludeTax: false,
    totals: {
      subtotal: po.subtotal.toFixed(2),
      discountTotal: "0",
      taxTotal: po.taxTotal.toFixed(2),
      total: po.total.toFixed(2),
      amountPaid: "0",
    },
    notes: po.status === "CANCELLED" ? `Cancelled: ${po.cancelReason}` : po.notes,
    footerNote: `Deliver to: ${settings.name}, ${po.warehouse.name}${po.warehouse.location ? ` (${po.warehouse.location})` : ""}. Please quote ${po.number} on your delivery note and invoice.`,
  };
}
