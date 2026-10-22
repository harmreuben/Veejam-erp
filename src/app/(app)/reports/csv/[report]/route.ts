import { csvResponse, type CsvCell } from "@/lib/csv";
import { hasPermission } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AppError, ValidationError } from "@/server/errors";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { agedReceivables } from "@/server/modules/payments/service";
import {
  collectionsReport,
  profitAndLoss,
  readRange,
  salesReport,
  SALES_GROUPS,
  stockValuation,
  vatReport,
  type SalesGroup,
} from "@/server/modules/reports/service";

/** GET /reports/csv/:report?from=&to= → the report as CSV for Excel. Same permissions as the page. */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const session = await getSession();
  if (session.kind !== "user") return new Response("Sign in first", { status: 401 });
  const user = session.user;
  if (!hasPermission(user.role, "reports.view")) return new Response("Not allowed", { status: 403 });
  const actor = { id: user.id, email: user.email, role: user.role };
  const sp = new URL(req.url).searchParams;
  const db = getDb();
  const report = (await params).report;

  try {
    const range = readRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
    const span = `${range.from}_to_${range.to}`;
    let rows: CsvCell[][];
    let name: string;
    switch (report) {
      case "sales": {
        const g = sp.get("group");
        const group: SalesGroup = g && g in SALES_GROUPS ? (g as SalesGroup) : "day";
        const r = await salesReport(db, actor, range, group);
        rows = [
          [
            SALES_GROUPS[group],
            group === "customer" ? "Code" : group === "product" ? "SKU" : "",
            "Invoices",
            ...(group === "product" ? ["Pieces (net)"] : []),
            "Sales excl. VAT",
            "VAT",
            "Invoiced incl. VAT",
            "Credit notes incl. VAT",
            "Net incl. VAT",
          ],
          ...r.rows.map((x) => [
            x.label,
            x.sub ?? "",
            x.documents,
            ...(group === "product" ? [x.pieces] : []),
            x.net,
            x.vat,
            x.gross,
            x.returnsGross,
            x.netGross,
          ]),
        ];
        name = `sales-by-${group}-${span}.csv`;
        break;
      }
      case "collections": {
        const r = await collectionsReport(db, actor, range);
        rows = [
          ["Date", ...Object.values(METHOD_LABELS), "Total", "Payments"],
          ...r.rows.map((x) => [
            x.day,
            x.byMethod.CASH,
            x.byMethod.MPESA,
            x.byMethod.BANK_TRANSFER,
            x.byMethod.CHEQUE,
            x.total,
            x.count,
          ]),
          [
            "Total",
            r.methodTotals.CASH,
            r.methodTotals.MPESA,
            r.methodTotals.BANK_TRANSFER,
            r.methodTotals.CHEQUE,
            r.total,
            r.count,
          ],
        ];
        name = `money-received-${span}.csv`;
        break;
      }
      case "vat": {
        const r = await vatReport(db, actor, range);
        rows = [
          [
            "Month",
            "Tax category",
            "Rate %",
            "Sales excl. VAT",
            "Output VAT",
            "Returns excl. VAT",
            "VAT on returns",
            "Net output VAT",
          ],
          ...r.rows.map((x) => [
            x.month,
            x.category,
            x.rate,
            x.salesNet,
            x.salesVat,
            x.returnsNet,
            x.returnsVat,
            x.netVat,
          ]),
          [
            "Total",
            "",
            "",
            r.totals.salesNet,
            r.totals.salesVat,
            r.totals.returnsNet,
            r.totals.returnsVat,
            r.totals.netVat,
          ],
        ];
        name = `vat-${span}.csv`;
        break;
      }
      case "profit": {
        const r = await profitAndLoss(db, actor, range);
        rows = [
          ["Section", "Account", "Name", "Amount"],
          ...r.income.map((x) => ["Income", x.code, x.name, x.amount]),
          ["Income", "", "Total income", r.totalIncome],
          ...r.expenses.map((x) => ["Expenses", x.code, x.name, x.amount]),
          ["Expenses", "", "Total expenses", r.totalExpenses],
          ["Result", "", "Income less expenses", r.result],
        ];
        name = `profit-and-loss-${span}.csv`;
        break;
      }
      case "stock": {
        const r = await stockValuation(db, actor);
        rows = [
          ["SKU", "Product", "Brand", "Pieces on hand", "Average cost per piece", "Value at cost"],
          ...r.rows.map((x) => [x.sku, x.name, x.brand, x.pieces, x.averageCost ?? "", x.value ?? ""]),
          ["", "Total", "", "", "", r.total],
        ];
        name = `stock-value-${range.to}.csv`;
        break;
      }
      case "receivables": {
        const r = await agedReceivables(db, actor);
        rows = [
          [
            "Code",
            "Customer",
            "Phone",
            ...r.buckets,
            "Owed on invoices",
            "Credit not applied",
            "Net balance",
          ],
          ...r.rows.map((x) => [x.code, x.name, x.phone ?? "", ...x.buckets, x.owed, x.credit, x.net]),
          ["", "Total", "", ...r.totals, r.total, "", ""],
        ];
        name = `customer-balances-${r.asOf}.csv`;
        break;
      }
      default:
        return new Response("Not found", { status: 404 });
    }
    return csvResponse(rows, name);
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(Object.values(error.fieldErrors).flat().join(" "), { status: 400 });
    }
    if (error instanceof AppError) return new Response(error.message, { status: 403 });
    throw error;
  }
}
