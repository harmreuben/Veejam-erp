import "server-only";

import { degrees, PDFDocument, rgb, StandardFonts, type Color, type PDFFont, type PDFPage } from "pdf-lib";

import type { SalesDocumentKind } from "@/generated/prisma/enums";
import { formatKES, toDecimal } from "@/lib/money";
import { formatRate } from "@/lib/sales-math";
import { UNIT_LABELS, type PackSizes, type Unit } from "@/lib/units";
import type { Db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { customerBalance } from "@/server/modules/payments/service";
import { isUuid } from "@/server/shared/validation";

/**
 * PDFs for quotations, sales orders, invoices and delivery notes, in VeeJam's
 * own invoice design (green header bar, logo block, meta box, green table
 * header, payment box). Drawn with pdf-lib: pure JavaScript, works on Vercel.
 * Posted invoices print from the company and customer details frozen at
 * posting, so a reprint years later matches the original.
 */

export type PrintableLine = {
  sku: string;
  description: string;
  unit: Unit;
  quantity: number;
  pieces: number;
  sizes: PackSizes;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  netAmount: string;
  discountAmount: string;
  taxAmount: string;
  grossAmount: string;
};

export type ReceiptDetails = {
  method: string;
  reference: string | null;
  date: string;
  amount: string;
  allocations: { number: string; date: string; total: string; applied: string }[];
  unapplied: string;
  balanceAfter: string;
};

export type Printable = {
  variant: SalesDocumentKind | "DELIVERY_NOTE" | "RECEIPT";
  /** Receipts only. */
  receipt?: ReceiptDetails;
  /** Watermark word for cancelled/reversed documents (default CANCELLED). */
  stampWord?: string;
  title: string;
  number: string;
  draft: boolean;
  cancelled: boolean;
  status: { label: string; tone: "green" | "amber" | "red" | "grey" } | null;
  /** Rows of the box under the title: [label, value]. */
  meta: [string, string][];
  company: {
    name: string;
    tagline: string | null;
    kraPin: string | null;
    telephone: string | null;
    email: string | null;
    address: string | null;
    vatRegistered: boolean;
    paybill: string | null;
    account: string | null;
    paymentInstructions: string | null;
    terms: string | null;
  };
  customer: { name: string; lines: string[]; kraPin: string | null };
  lines: PrintableLine[];
  pricesIncludeTax: boolean;
  totals: {
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
    amountPaid: string;
    amountCredited?: string;
  };
  notes: string | null;
  footerNote: string | null;
};

const TITLES: Record<SalesDocumentKind, string> = {
  QUOTATION: "QUOTATION",
  SALES_ORDER: "SALES ORDER",
  INVOICE: "INVOICE",
  CREDIT_NOTE: "CREDIT NOTE",
};

const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Africa/Nairobi" });
const fmtDate = (d: Date | null | undefined) => (d ? longDate.format(d) : "—");

type Snapshot = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function phoneDisplay(phone: string | null): string | null {
  if (!phone) return null;
  return /^254\d{9}$/.test(phone) ? `0${phone.slice(3)}` : phone;
}

function invoiceStatus(d: {
  status: string;
  total: { toFixed(n: number): string };
  amountPaid: { toFixed(n: number): string };
  amountCredited: { toFixed(n: number): string };
}): Printable["status"] {
  if (d.status === "CANCELLED") return { label: "Cancelled", tone: "grey" };
  if (d.status === "DRAFT") return { label: "Draft", tone: "grey" };
  const total = toDecimal(d.total.toFixed(2));
  const paid = toDecimal(d.amountPaid.toFixed(2)).plus(d.amountCredited.toFixed(2));
  if (paid.greaterThanOrEqualTo(total)) return { label: "Paid", tone: "green" };
  if (paid.greaterThan(0)) return { label: "Partially Paid", tone: "amber" };
  return { label: "Pending", tone: "amber" };
}

/** Load a sales document in printable form. Callers check permissions (or a share token) first. */
export async function loadPrintableDocument(db: Db, id: string): Promise<Printable> {
  if (!isUuid(id)) throw new NotFoundError();
  const d = await db.salesDocument.findUnique({
    where: { id },
    include: {
      customer: true,
      createdBy: { select: { fullName: true } },
      sourceDocument: { select: { number: true } },
      lines: {
        orderBy: { position: "asc" },
        include: { product: { select: { unitsPerPack: true, packsPerCarton: true } } },
      },
    },
  });
  if (!d) throw new NotFoundError();
  const settings = await db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  // Posted invoices use the details frozen at posting; anything missing from an
  // older snapshot (e.g. the paybill) comes from today's settings.
  // Posted invoices use the details frozen at posting; anything the snapshot
  // doesn't have (e.g. a paybill added later) comes from today's settings.
  const company: Snapshot = { ...(settings as unknown as Snapshot) };
  for (const [k, v] of Object.entries((d.companySnapshot as Snapshot | null) ?? {})) {
    if (v != null && v !== "") company[k] = v;
  }
  const customer: Snapshot = (d.customerSnapshot as Snapshot | null) ?? (d.customer as unknown as Snapshot);
  const terms = d.customer.paymentTermsDays || settings.defaultPaymentTermsDays;

  const meta: [string, string][] = [];
  const typeLabel = d.customer.type === "WALK_IN" ? "Walk-in Customer" : "Registered Customer";
  if (d.kind === "INVOICE") {
    meta.push(["Invoice #", d.number ?? "Draft"]);
    meta.push(["Invoice Date", d.status === "POSTED" ? fmtDate(d.issueDate) : "On posting"]);
    meta.push(["Due Date", d.dueDate ? fmtDate(d.dueDate) : `${terms} days after posting`]);
  } else if (d.kind === "QUOTATION") {
    meta.push(["Quotation #", d.number ?? "—"]);
    meta.push(["Date", fmtDate(d.issueDate)]);
    if (d.validUntil) meta.push(["Valid Until", fmtDate(d.validUntil)]);
  } else if (d.kind === "CREDIT_NOTE") {
    meta.push(["Credit Note #", d.number ?? "—"]);
    meta.push(["Date", fmtDate(d.issueDate)]);
    meta.push(["Against Invoice", d.sourceDocument?.number ?? "—"]);
  } else {
    meta.push(["Order #", d.number ?? "—"]);
    meta.push(["Order Date", fmtDate(d.issueDate)]);
  }
  meta.push(["Sales Agent", d.historical ? "—" : d.createdBy.fullName]);
  if (d.customerReference) meta.push(["Your Ref.", d.customerReference]);
  meta.push(["Type", typeLabel]);

  const address =
    [str(company.physicalAddress), str(company.postalAddress)].filter(Boolean).join(", ") || null;
  return {
    variant: d.kind,
    title: TITLES[d.kind],
    number: d.number ?? "DRAFT",
    draft: d.status === "DRAFT",
    cancelled: d.status === "CANCELLED",
    status:
      d.kind === "INVOICE"
        ? invoiceStatus(d)
        : d.status === "CANCELLED"
          ? { label: "Cancelled", tone: "grey" }
          : null,
    meta,
    company: {
      name: str(company.name) ?? "",
      tagline: str(company.tagline),
      kraPin: str(company.kraPin),
      telephone: phoneDisplay(str(company.telephone)),
      email: str(company.documentEmail),
      address,
      vatRegistered: company.vatRegistered === true,
      paybill: str(company.mpesaPaybill),
      account: str(company.mpesaAccount),
      paymentInstructions: str(company.paymentInstructions),
      terms: str(company.invoiceTerms),
    },
    customer: {
      name: str(customer.name) ?? "",
      lines: [
        str(customer.contactPerson),
        [str(customer.physicalAddress), str(customer.town)].filter(Boolean).join(", ") || null,
        phoneDisplay(str(customer.phone)) ? `Tel: ${phoneDisplay(str(customer.phone))}` : null,
        str(customer.kraPin) ? `KRA PIN: ${str(customer.kraPin)}` : null,
      ].filter((x): x is string => Boolean(x)),
      kraPin: str(customer.kraPin),
    },
    lines: d.lines.map((l) => ({
      sku: l.sku,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      pieces: l.pieces,
      sizes: l.product,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercent: l.discountPercent.toFixed(2),
      taxRate: l.taxRate.toFixed(4),
      netAmount: l.netAmount.toFixed(2),
      discountAmount: l.discountAmount.toFixed(2),
      taxAmount: l.taxAmount.toFixed(2),
      grossAmount: l.grossAmount.toFixed(2),
    })),
    pricesIncludeTax: d.pricesIncludeTax,
    totals: {
      subtotal: d.subtotal.toFixed(2),
      discountTotal: d.discountTotal.toFixed(2),
      taxTotal: d.taxTotal.toFixed(2),
      total: d.total.toFixed(2),
      amountPaid: d.amountPaid.toFixed(2),
      amountCredited: d.amountCredited.toFixed(2),
    },
    notes: d.notes,
    footerNote: d.historical
      ? "Issued by the previous system; reprinted from VeeJam ERP."
      : d.kind === "INVOICE" && d.status === "DRAFT"
        ? "DRAFT - not an invoice until posted. Prices are checked again when it is posted."
        : d.kind === "QUOTATION"
          ? "Prices and availability are confirmed when you order."
          : null,
  };
}

export async function loadPrintableDeliveryNote(db: Db, id: string): Promise<Printable> {
  if (!isUuid(id)) throw new NotFoundError();
  const note = await db.deliveryNote.findUnique({
    where: { id },
    select: {
      invoiceId: true,
      number: true,
      status: true,
      vehicle: true,
      driver: true,
      dispatchedAt: true,
      deliveredAt: true,
      receivedBy: true,
      notes: true,
    },
  });
  if (!note) throw new NotFoundError();
  const inv = await loadPrintableDocument(db, note.invoiceId);
  const meta: [string, string][] = [
    ["Delivery Note #", note.number],
    ["Invoice #", inv.number],
    ["Dispatched", fmtDate(note.dispatchedAt)],
  ];
  if (note.vehicle) meta.push(["Vehicle", note.vehicle]);
  if (note.driver) meta.push(["Driver", note.driver]);
  if (note.deliveredAt) meta.push(["Delivered", fmtDate(note.deliveredAt)]);
  const label = {
    PREPARED: "Prepared",
    DISPATCHED: "Dispatched",
    DELIVERED: "Delivered",
    CANCELLED: "Cancelled",
  };
  return {
    ...inv,
    variant: "DELIVERY_NOTE",
    title: "DELIVERY NOTE",
    number: note.number,
    draft: false,
    cancelled: note.status === "CANCELLED",
    status: {
      label: label[note.status],
      tone: note.status === "DELIVERED" ? "green" : note.status === "CANCELLED" ? "grey" : "amber",
    },
    meta,
    notes: note.notes,
    footerNote: note.receivedBy ? `Received by ${note.receivedBy}.` : null,
  };
}

// ─── Drawing ────────────────────────────────────────────────────────

const hex = (h: string) =>
  rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  );

const C = {
  green: hex("#0B5D3B"),
  greenBright: hex("#10B981"),
  ink: hex("#111827"),
  body: hex("#374151"),
  muted: hex("#6B7280"),
  faint: hex("#9CA3AF"),
  rule: hex("#E5E7EB"),
  zebra: hex("#F6F8F7"),
  metaBg: hex("#F5F6F7"),
  red: hex("#DC2626"),
  amberBg: hex("#FEF3C7"),
  amberInk: hex("#B45309"),
  amberBorder: hex("#FCD34D"),
  greenBg: hex("#ECFDF5"),
  greenBorder: hex("#A7F3D0"),
  greenInk: hex("#047857"),
  greyBg: hex("#F3F4F6"),
  blueBg: hex("#EFF6FF"),
  blueBorder: hex("#BFDBFE"),
  blueInk: hex("#1E40AF"),
  white: rgb(1, 1, 1),
};

const A4: [number, number] = [595.28, 841.89];
const M = 36; // side margin
const RIGHT = A4[0] - M;
const WIDTH = RIGHT - M;
const FOOTER_SPACE = 120;

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; mono: PDFFont };

/** Keep only characters the built-in PDF fonts can draw. */
function makeSafe(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (text: string) =>
    [...text.replace(/[−‐‑]/g, "-").replace(/→/g, "->")]
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?"))
      .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Rounded rectangle; (x, y) is the bottom-left corner as in pdf-lib. */
function roundRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { fill?: Color; border?: Color; borderWidth?: number },
) {
  const path =
    `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} ` +
    `H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(path, {
    x,
    y: y + h,
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.border ? (opts.borderWidth ?? 0.8) : 0,
  });
}

/** The green bar at the top and bottom of every page: dark → bright → dark. */
function gradientBar(page: PDFPage, y: number, h: number) {
  const steps = 60;
  const w = A4[0] / steps;
  const a = [11, 93, 59];
  const b = [16, 185, 129];
  for (let i = 0; i < steps; i++) {
    const t = 1 - Math.abs(i / (steps - 1) - 0.5) * 2; // 0 at the edges, 1 in the middle
    const c = a.map((v, k) => (v + (b[k]! - v) * t) / 255);
    page.drawRectangle({ x: i * w, y, width: w + 0.5, height: h, color: rgb(c[0]!, c[1]!, c[2]!) });
  }
}

function initials(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const caps = first.replace(/[^A-Z]/g, "");
  if (caps.length >= 2) return caps.slice(0, 2);
  const words = name.trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

const kes = (v: string) => formatKES(v);

export async function renderPdf(doc: Printable): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title === "INVOICE" ? "Invoice" : doc.title} ${doc.number} — ${doc.company.name}`);
  pdf.setAuthor(doc.company.name);
  pdf.setProducer("VeeJam ERP");
  pdf.setCreator("VeeJam ERP");
  const f: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  const safe = makeSafe(f.regular);
  const isInvoice = doc.variant === "INVOICE";
  const isDelivery = doc.variant === "DELIVERY_NOTE";
  const withPrices = !isDelivery;

  let page!: PDFPage;
  let y = 0;
  const text = (s: string, x: number, yy: number, size = 9, font = f.regular, color: Color = C.body) =>
    page.drawText(safe(s), { x, y: yy, size, font, color });
  const textRight = (s: string, xr: number, yy: number, size = 9, font = f.regular, color: Color = C.body) =>
    text(s, xr - font.widthOfTextAtSize(safe(s), size), yy, size, font, color);
  const textCenter = (s: string, xc: number, yy: number, size = 9, font = f.regular, color: Color = C.body) =>
    text(s, xc - font.widthOfTextAtSize(safe(s), size) / 2, yy, size, font, color);
  const spaced = (s: string) => s.split("").join(" ");

  const newPage = () => {
    page = pdf.addPage(A4);
    gradientBar(page, A4[1] - 6, 6);
    gradientBar(page, 0, 6);
    // Watermark
    const word = doc.cancelled ? (doc.stampWord ?? "CANCELLED") : doc.draft ? "DRAFT" : "VEEJAM";
    const color = doc.cancelled || doc.draft ? C.red : C.green;
    page.drawText(word, {
      x: 150,
      y: 300,
      size: word === "VEEJAM" ? 80 : 72,
      font: f.bold,
      color,
      opacity: word === "VEEJAM" ? 0.035 : 0.1,
      rotate: degrees(35),
    });
    y = A4[1] - 34;
  };

  // ── Header ────────────────────────────────────────────────────
  newPage();
  // Logo block
  roundRect(page, M, y - 34, 34, 34, 5, { fill: C.green });
  textCenter(initials(doc.company.name), M + 17, y - 22, 13, f.bold, C.white);
  text(doc.company.name, M + 44, y - 14, 15, f.bold, C.green);
  if (doc.company.tagline) text(doc.company.tagline, M + 44, y - 27, 8, f.regular, C.muted);
  let ly = y - 50;
  if (doc.company.kraPin) {
    text("KRA PIN: ", M, ly, 7.5, f.regular, C.muted);
    text(doc.company.kraPin, M + f.regular.widthOfTextAtSize("KRA PIN: ", 7.5), ly, 7.5, f.bold, C.body);
    ly -= 12;
  }
  const contact = [doc.company.telephone, doc.company.email].filter(Boolean).join("  ·  ");
  if (contact) {
    text(contact, M, ly, 7.5, f.regular, C.muted);
    ly -= 12;
  }
  const place = [doc.company.address, doc.company.vatRegistered ? "VAT Registered" : null]
    .filter(Boolean)
    .join("  ·  ");
  if (place) {
    text(place, M, ly, 7.5, f.regular, C.muted);
    ly -= 12;
  }

  // Title and meta box
  const titleSize = doc.title.length > 9 ? 22 : 28;
  textRight(doc.title, RIGHT, y - 22, titleSize, f.bold, C.green);
  const boxW = 175;
  const rowH = 15;
  const boxH = doc.meta.length * rowH + 12;
  const boxTop = y - 34;
  roundRect(page, RIGHT - boxW, boxTop - boxH, boxW, boxH, 5, { fill: C.metaBg, border: C.rule });
  doc.meta.forEach(([k, v], i) => {
    const yy = boxTop - 16 - i * rowH;
    const valueFont = k.endsWith("#") ? f.mono : f.bold;
    const valueSize = k.endsWith("#") ? 8 : 8.5;
    const vw = valueFont.widthOfTextAtSize(safe(v), valueSize);
    text(v, RIGHT - 10 - vw, yy, valueSize, valueFont, C.ink);
    textRight(`${k}:`, RIGHT - 14 - vw, yy, 8, f.regular, C.faint);
  });
  let my = boxTop - boxH - 8;
  if (doc.status) {
    const tone = {
      green: [C.greenBg, C.greenInk, C.greenBorder],
      amber: [C.amberBg, C.amberInk, C.amberBorder],
      red: [C.amberBg, C.red, C.amberBorder],
      grey: [C.greyBg, C.muted, C.rule],
    }[doc.status.tone] as [Color, Color, Color];
    const w = f.bold.widthOfTextAtSize(doc.status.label, 7.5) + 18;
    roundRect(page, RIGHT - w, my - 14, w, 14, 7, { fill: tone[0], border: tone[2] });
    textCenter(doc.status.label, RIGHT - w / 2, my - 10, 7.5, f.bold, tone[1]);
    my -= 22;
  }
  y = Math.min(ly, my) - 6;
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 1.4, color: C.green });
  y -= 24;

  // ── Bill to / remit to ─────────────────────────────────────────
  const half = M + WIDTH / 2 + 10;
  text(
    spaced(isDelivery ? "DELIVER TO" : doc.receipt ? "RECEIVED FROM" : "BILL TO"),
    M,
    y,
    6.5,
    f.bold,
    C.faint,
  );
  text(doc.customer.name, M, y - 14, 10, f.bold, C.ink);
  let cy = y - 27;
  for (const l of doc.customer.lines) {
    text(l, M, cy, 8, f.regular, C.muted);
    cy -= 12;
  }
  let ry = y - 27;
  if (isInvoice) {
    text(spaced("REMIT PAYMENT TO"), half, y, 6.5, f.bold, C.faint);
    text(doc.company.name, half, y - 14, 10, f.bold, C.ink);
    const remit = [
      doc.company.kraPin ? ["KRA PIN: ", doc.company.kraPin, false] : null,
      doc.company.paybill ? ["M-Pesa Paybill: ", doc.company.paybill, true] : null,
      doc.company.account ? ["Account No: ", doc.company.account, true] : null,
      doc.company.telephone ? ["Tel: ", doc.company.telephone, false] : null,
    ].filter(Boolean) as [string, string, boolean][];
    for (const [k, v, strong] of remit) {
      text(k, half, ry, 8, f.regular, C.muted);
      text(
        v,
        half + f.regular.widthOfTextAtSize(k, 8),
        ry,
        8,
        strong ? f.bold : f.regular,
        strong ? C.ink : C.muted,
      );
      ry -= 12;
    }
  }
  y = Math.min(cy, ry) - 14;

  const continuePageNoHeader = () => {
    newPage();
    y -= 10;
  };
  const ensure = (h: number) => {
    if (y - h < M + 20) continuePageNoHeader();
  };

  if (!doc.receipt) {
    // ── Lines table ───────────────────────────────────────────────
    type Col = { label: string; x: number; align: "left" | "right" | "center"; w?: number };
    const cols: Record<string, Col> = withPrices
      ? {
          sku: { label: "SKU", x: M + 8, align: "left" },
          desc: { label: "DESCRIPTION", x: M + 66, align: "left", w: 150 },
          qty: { label: "QTY", x: M + 248, align: "right" },
          price: { label: "UNIT PRICE", x: M + 322, align: "right" },
          vat: { label: "VAT %", x: M + 352, align: "center" },
          vatAmt: { label: "VAT AMT", x: M + 432, align: "right" },
          total: { label: "LINE TOTAL", x: RIGHT - 8, align: "right" },
        }
      : {
          sku: { label: "SKU", x: M + 8, align: "left" },
          desc: { label: "DESCRIPTION", x: M + 72, align: "left", w: 230 },
          qty: { label: "QTY", x: M + 360, align: "right" },
          pieces: { label: "PIECES", x: M + 430, align: "right" },
          check: { label: "CHECKED", x: RIGHT - 8, align: "right" },
        };
    const header = () => {
      page.drawRectangle({ x: M, y: y - 24, width: WIDTH, height: 24, color: C.green });
      for (const c of Object.values(cols)) {
        if (c.align === "left") text(c.label, c.x, y - 15, 7, f.bold, C.white);
        else if (c.align === "center") textCenter(c.label, c.x, y - 15, 7, f.bold, C.white);
        else textRight(c.label, c.x, y - 15, 7, f.bold, C.white);
      }
      y -= 24;
    };
    const continuePage = () => {
      newPage();
      text(`${doc.title} ${doc.number} (continued)`, M, y - 6, 9, f.bold, C.muted);
      y -= 22;
      header();
    };
    header();

    const multipleRates = new Set(doc.lines.map((l) => l.taxRate)).size > 1;
    doc.lines.forEach((l, i) => {
      const descLines = wrap(safe(l.description), f.bold, 8.5, cols.desc!.w!);
      const unitNote =
        l.unit === "PACK" ? null : l.quantity === 1 ? UNIT_LABELS[l.unit].one : UNIT_LABELS[l.unit].many;
      const rowH = Math.max(26, descLines.length * 11 + 14);
      if (y - rowH < M + FOOTER_SPACE - 40) continuePage();
      if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rowH, width: WIDTH, height: rowH, color: C.zebra });
      const base = y - 16;
      text(l.sku, cols.sku!.x, base, 7.5, f.mono, C.faint);
      descLines.forEach((d, k) => text(d, cols.desc!.x, base - k * 11, 8.5, f.bold, C.ink));
      const qty = unitNote ? `${l.quantity} ${unitNote}` : String(l.quantity);
      textRight(qty, cols.qty!.x, base, 8.5, f.regular, C.body);
      if (withPrices) {
        textRight(kes(l.unitPrice), cols.price!.x, base, 8.5, f.regular, C.body);
        textCenter(formatRate(l.taxRate), cols.vat!.x, base, 8, f.regular, C.muted);
        textRight(kes(l.taxAmount), cols.vatAmt!.x, base, 8, f.regular, C.greenInk);
        const amount = doc.pricesIncludeTax ? l.grossAmount : l.netAmount;
        textRight(kes(amount), cols.total!.x, base, 8.5, f.bold, C.ink);
        if (!toDecimal(l.discountPercent).isZero()) {
          textRight(`less ${formatRate(l.discountPercent)}`, cols.total!.x, base - 11, 7, f.regular, C.faint);
        }
      } else {
        textRight(l.pieces.toLocaleString("en-KE"), cols.pieces!.x, base, 8.5, f.regular, C.body);
        textRight("________", cols.check!.x, base, 8.5, f.regular, C.faint);
      }
      y -= rowH;
      page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: C.rule });
    });

    // ── Totals ────────────────────────────────────────────────────
    y -= 16;
    if (withPrices) {
      const linesGross = doc.lines.reduce((s, l) => s.plus(l.grossAmount), toDecimal(0));
      const rows: { k: string; v: string; style?: "total" | "due" | "rule" }[] = [];
      if (doc.pricesIncludeTax) rows.push({ k: "Inclusive Subtotal", v: kes(linesGross.toFixed(2)) });
      if (!toDecimal(doc.totals.discountTotal).isZero()) {
        rows.push({ k: "Discount", v: `- ${kes(doc.totals.discountTotal)}` });
      }
      rows.push({ k: "Taxable Amount (Ex-VAT)", v: kes(doc.totals.subtotal) });
      rows.push({
        k: multipleRates ? "VAT" : `VAT @ ${formatRate(doc.lines[0]?.taxRate ?? "16")}`,
        v: kes(doc.totals.taxTotal),
        style: "rule",
      });
      rows.push({ k: "TOTAL", v: kes(doc.totals.total), style: "total" });
      const balance = toDecimal(doc.totals.total)
        .minus(doc.totals.amountPaid)
        .minus(doc.totals.amountCredited ?? "0")
        .toFixed(2);
      if (isInvoice && !doc.draft) {
        rows.push({ k: "Amount Paid", v: kes(doc.totals.amountPaid) });
        if (!toDecimal(doc.totals.amountCredited ?? "0").isZero()) {
          rows.push({ k: "Credited", v: kes(doc.totals.amountCredited!) });
        }
        rows.push({ k: "Balance Due", v: kes(balance), style: "due" });
      }
      ensure(rows.length * 18 + 20);
      const lx = RIGHT - 215;
      for (const r of rows) {
        if (r.style === "total") {
          y -= 6;
          text(r.k, lx, y, 11, f.bold, C.green);
          textRight(r.v, RIGHT, y, 12, f.bold, C.green);
          y -= 22;
          continue;
        }
        const color = r.style === "due" ? C.red : C.body;
        const font = r.style === "due" ? f.bold : f.regular;
        text(r.k, lx, y, 8.5, font, r.style === "due" ? C.red : C.muted);
        textRight(r.v, RIGHT, y, 8.5, font, color);
        if (r.style === "rule") {
          page.drawLine({
            start: { x: lx, y: y - 8 },
            end: { x: RIGHT, y: y - 8 },
            thickness: 0.8,
            color: C.ink,
          });
          y -= 10;
        }
        y -= 16;
      }

      // ── Payment options (invoices) ───────────────────────────────
      if (isInvoice && !doc.draft && !doc.cancelled) {
        const due = toDecimal(balance).greaterThan(0) ? balance : "0.00";
        const boxH = doc.company.paybill ? 96 : 0;
        if (doc.company.paybill) {
          y -= 6;
          ensure(boxH + 10);
          roundRect(page, M, y - boxH, WIDTH, boxH, 8, { fill: C.greenBg, border: C.greenBorder });
          text(spaced("PAYMENT OPTIONS"), M + 14, y - 18, 7, f.bold, C.green);
          const cardW = (WIDTH - 28 - 20) / 3;
          const cards: [string, string, Color][] = [
            ["M-PESA PAYBILL", doc.company.paybill, C.ink],
            ["ACCOUNT NUMBER", doc.company.account ?? "—", C.ink],
            ["AMOUNT DUE", kes(due), C.red],
          ];
          cards.forEach(([label, value, color], k) => {
            const cx = M + 14 + k * (cardW + 10);
            roundRect(page, cx, y - 70, cardW, 40, 5, { fill: C.white, border: C.rule });
            textCenter(spaced(label), cx + cardW / 2, y - 43, 5.5, f.regular, C.faint);
            textCenter(value, cx + cardW / 2, y - 59, value.length > 12 ? 9 : 10.5, f.bold, color);
          });
          const q = [doc.company.telephone, doc.company.email].filter(Boolean).join("  ·  ");
          if (q) text(`For queries: ${q}`, M + 14, y - 86, 7, f.regular, C.muted);
          y -= boxH + 12;
        }
        if (doc.company.paymentInstructions) {
          const lines = wrap(safe(doc.company.paymentInstructions), f.regular, 8, WIDTH);
          ensure(lines.length * 11 + 16);
          for (const l of lines) {
            text(l, M, y, 8, f.regular, C.body);
            y -= 11;
          }
          y -= 6;
        }

        // eTIMS strip
        ensure(30);
        roundRect(page, M, y - 22, WIDTH, 22, 5, { fill: C.blueBg, border: C.blueBorder });
        const parts: [string, string][] = [
          ["eTIMS Status: ", "Not submitted"],
          ["Customer KRA PIN: ", doc.customer.kraPin ?? "N/A"],
          ["Taxable Amount: ", kes(doc.totals.subtotal)],
          ["VAT Amount: ", kes(doc.totals.taxTotal)],
        ];
        let sx = M + 12;
        parts.forEach(([k, v], idx) => {
          text(k, sx, y - 14, 7, f.bold, C.blueInk);
          sx += f.bold.widthOfTextAtSize(k, 7);
          text(v, sx, y - 14, 7, f.regular, C.blueInk);
          sx += f.regular.widthOfTextAtSize(safe(v), 7);
          if (idx < parts.length - 1) {
            text("  ·  ", sx, y - 14, 7, f.regular, C.blueInk);
            sx += f.regular.widthOfTextAtSize("  ·  ", 7);
          }
        });
        y -= 34;
      }
    } else {
      // Delivery note signatures
      ensure(70);
      y -= 30;
      const sig = (label: string, x: number) => {
        page.drawLine({ start: { x, y }, end: { x: x + 150, y }, thickness: 0.6, color: C.muted });
        text(label, x, y - 12, 7.5, f.regular, C.muted);
      };
      sig("Dispatched by", M);
      sig("Received by (name and signature)", M + 182);
      sig("Date and stamp", M + 364);
      y -= 30;
    }
  } else {
    // ── Receipt body ──────────────────────────────────────────────
    const r = doc.receipt;
    roundRect(page, M, y - 70, WIDTH, 70, 8, { fill: C.greenBg, border: C.greenBorder });
    text(spaced("AMOUNT RECEIVED"), M + 16, y - 20, 7, f.bold, C.green);
    text(kes(r.amount), M + 16, y - 46, 22, f.bold, C.green);
    const how = [r.method, r.reference].filter(Boolean).join(" · ");
    textRight(how, RIGHT - 16, y - 28, 10, f.bold, C.ink);
    textRight(`Received ${r.date}`, RIGHT - 16, y - 44, 8.5, f.regular, C.muted);
    y -= 92;
    if (r.allocations.length) {
      const cx = { inv: M + 8, date: M + 170, total: M + 380, applied: RIGHT - 8 };
      page.drawRectangle({ x: M, y: y - 24, width: WIDTH, height: 24, color: C.green });
      text("APPLIED TO INVOICE", cx.inv, y - 15, 7, f.bold, C.white);
      text("INVOICE DATE", cx.date, y - 15, 7, f.bold, C.white);
      textRight("INVOICE TOTAL", cx.total, y - 15, 7, f.bold, C.white);
      textRight("AMOUNT APPLIED", cx.applied, y - 15, 7, f.bold, C.white);
      y -= 24;
      r.allocations.forEach((a, i) => {
        ensure(26);
        if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 24, width: WIDTH, height: 24, color: C.zebra });
        text(a.number, cx.inv, y - 15, 8.5, f.mono, C.ink);
        text(a.date, cx.date, y - 15, 8.5, f.regular, C.body);
        textRight(kes(a.total), cx.total, y - 15, 8.5, f.regular, C.body);
        textRight(kes(a.applied), cx.applied, y - 15, 8.5, f.bold, C.ink);
        y -= 24;
        page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: C.rule });
      });
      y -= 16;
    }
    const lx = RIGHT - 230;
    const summary: [string, string, boolean][] = [];
    if (!toDecimal(r.unapplied).isZero())
      summary.push(["Kept as credit on your account", kes(r.unapplied), false]);
    summary.push([
      toDecimal(r.balanceAfter).lessThan(0) ? "Your account is in credit by" : "Balance on the account now",
      kes(toDecimal(r.balanceAfter).abs().toFixed(2)),
      true,
    ]);
    for (const [k, v, strong] of summary) {
      ensure(18);
      text(k, lx, y, 8.5, strong ? f.bold : f.regular, strong ? C.ink : C.muted);
      textRight(v, RIGHT, y, 8.5, strong ? f.bold : f.regular, C.ink);
      y -= 16;
    }
    y -= 10;
  }

  // Notes
  const block = (title: string, body: string | null) => {
    if (!body) return;
    const lines = wrap(safe(body), f.regular, 8, WIDTH);
    ensure(lines.length * 11 + 22);
    if (title) {
      text(spaced(title.toUpperCase()), M, y, 6.5, f.bold, C.faint);
      y -= 13;
    }
    for (const l of lines) {
      text(l, M, y, 8, f.regular, C.body);
      y -= 11;
    }
    y -= 6;
  };
  block("Notes", doc.notes);
  block("", doc.footerNote);

  // ── Footer: company, terms, signature ──────────────────────────
  const termsLines =
    doc.company.terms && !isDelivery ? wrap(safe(doc.company.terms), f.italic, 7, WIDTH - 180) : [];
  const footerH = 48 + termsLines.length * 10;
  if (y - footerH < M) continuePageNoHeader();
  const fy = Math.min(y - 10, M + footerH);
  page.drawLine({
    start: { x: M, y: fy + 10 },
    end: { x: RIGHT, y: fy + 10 },
    thickness: 0.6,
    color: C.rule,
  });
  text(doc.company.name, M, fy - 4, 7.5, f.bold, C.ink);
  if (doc.company.kraPin) {
    text(
      `  ·  KRA PIN: ${doc.company.kraPin}`,
      M + f.bold.widthOfTextAtSize(doc.company.name, 7.5),
      fy - 4,
      7,
      f.regular,
      C.faint,
    );
  }
  let ty = fy - 15;
  if (doc.company.tagline) {
    text(doc.company.tagline, M, ty, 7, f.regular, C.faint);
    ty -= 10;
  }
  const tel = [
    doc.company.telephone ? `Tel: ${doc.company.telephone}` : null,
    doc.company.email ? `Email: ${doc.company.email}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (tel) {
    text(tel, M, ty, 7, f.regular, C.faint);
    ty -= 10;
  }
  termsLines.forEach((l, k) => text(k === 0 ? `Terms: ${l}` : l, M, ty - k * 10, 7, f.italic, C.faint));

  // Signature
  page.drawLine({
    start: { x: RIGHT - 140, y: fy - 6 },
    end: { x: RIGHT, y: fy - 6 },
    thickness: 0.8,
    color: C.ink,
  });
  textRight("Authorized Signature", RIGHT, fy - 16, 7, f.regular, C.muted);
  textRight(doc.company.name.split(/\s+/)[0] ?? "", RIGHT, fy - 32, 12, f.bold, C.rule);
  textRight("Thank you for your business!", RIGHT, fy - 42, 7, f.italic, C.muted);

  // Page numbers
  const pages = pdf.getPages();
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = safe(`${doc.number}  ·  Page ${i + 1} of ${pages.length}`);
      p.drawText(label, {
        x: RIGHT - f.regular.widthOfTextAtSize(label, 7),
        y: 12,
        size: 7,
        font: f.regular,
        color: C.faint,
      });
    });
  }

  return pdf.save();
}

/** A payment receipt (RCT-), in the same design as the invoices. */
export async function loadPrintableReceipt(db: Db, id: string): Promise<Printable> {
  if (!isUuid(id)) throw new NotFoundError();
  const p = await db.payment.findUnique({
    where: { id },
    include: {
      customer: true,
      receivedBy: { select: { fullName: true } },
      allocations: {
        where: { reversedAt: null },
        orderBy: { createdAt: "asc" },
        include: { invoice: { select: { number: true, issueDate: true, total: true } } },
      },
    },
  });
  if (!p) throw new NotFoundError();
  const settings = await db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const balance = await customerBalance(db, p.customerId);
  const applied = p.allocations.reduce((s, a) => s.plus(a.amount), toDecimal(0));
  const methods = {
    CASH: "Cash",
    MPESA: "M-Pesa",
    BANK_TRANSFER: "Bank transfer",
    CHEQUE: "Cheque",
  } as const;
  const c = p.customer;
  return {
    variant: "RECEIPT",
    title: "RECEIPT",
    number: p.number,
    draft: false,
    cancelled: p.status === "REVERSED",
    stampWord: "REVERSED",
    status:
      p.status === "REVERSED" ? { label: "Reversed", tone: "grey" } : { label: "Received", tone: "green" },
    meta: [
      ["Receipt #", p.number],
      ["Date", fmtDate(p.receivedOn)],
      ["Received By", p.receivedBy.fullName],
      ["Account", c.code],
    ],
    company: {
      name: settings.name,
      tagline: settings.tagline,
      kraPin: settings.kraPin,
      telephone: phoneDisplay(settings.telephone),
      email: settings.documentEmail,
      address: [settings.physicalAddress, settings.postalAddress].filter(Boolean).join(", ") || null,
      vatRegistered: settings.vatRegistered,
      paybill: settings.mpesaPaybill,
      account: settings.mpesaAccount,
      paymentInstructions: null,
      terms: null,
    },
    customer: {
      name: c.name,
      lines: [
        c.contactPerson,
        [c.physicalAddress, c.town].filter(Boolean).join(", ") || null,
        phoneDisplay(c.phone) ? `Tel: ${phoneDisplay(c.phone)}` : null,
      ].filter((x): x is string => Boolean(x)),
      kraPin: c.kraPin,
    },
    lines: [],
    pricesIncludeTax: true,
    totals: { subtotal: "0", discountTotal: "0", taxTotal: "0", total: p.amount.toFixed(2), amountPaid: "0" },
    notes: p.status === "REVERSED" ? `Reversed: ${p.reverseReason}` : p.notes,
    footerNote: null,
    receipt: {
      method: methods[p.method],
      reference: p.reference,
      date: fmtDate(p.receivedOn),
      amount: p.amount.toFixed(2),
      allocations: p.allocations.map((a) => ({
        number: a.invoice.number ?? "",
        date: fmtDate(a.invoice.issueDate),
        total: a.invoice.total.toFixed(2),
        applied: a.amount.toFixed(2),
      })),
      unapplied: p.status === "REVERSED" ? "0.00" : p.amount.minus(applied).toFixed(2),
      balanceAfter: balance.balance,
    },
  };
}
