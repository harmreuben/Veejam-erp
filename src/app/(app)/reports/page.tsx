import Link from "next/link";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await pageUser("reports.view");
  if (!user) return <NoAccess what="reports" />;
  const reports = [
    {
      href: "/reports/sales",
      title: "Sales",
      text: "By day, month, customer or product, less credit notes.",
    },
    {
      href: "/reports/collections",
      title: "Money received",
      text: "Payments by day and method: cash, M-Pesa, bank, cheque.",
    },
    { href: "/payments/balances", title: "Customer balances", text: "Who owes what and how overdue it is." },
    {
      href: "/reports/vat",
      title: "VAT",
      text: "Output VAT by month and rate, for preparing the VAT return.",
    },
    { href: "/reports/profit", title: "Profit and loss", text: "Income less expenses from the ledger." },
    ...(hasPermission(user, "catalogue.costs")
      ? [{ href: "/reports/stock", title: "Stock value", text: "Stock on hand at cost price." }]
      : []),
    {
      href: "/accounting",
      title: "Trial balance",
      text: "Every account's balance; the ledger behind these reports.",
    },
  ];
  return (
    <Page>
      <PageHeader
        title="Reports"
        description="Management reports from posted documents and the ledger. Every report can be downloaded as CSV for Excel. They are not tax filings."
      />
      <ul className="vj-stagger grid gap-3 sm:grid-cols-2">
        {reports.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="bg-card hover:border-primary/50 vj-lift grid h-full gap-1 rounded-lg border p-4"
            >
              <span className="font-medium">{r.title}</span>
              <span className="text-muted-foreground text-sm">{r.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
