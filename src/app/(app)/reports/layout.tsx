import type { ReactNode } from "react";

import { NoAccess } from "@/components/no-access";
import { Tabs } from "@/components/tabs";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";

export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const user = await pageUser("reports.view");
  if (!user) return <NoAccess what="reports" />;
  return (
    <>
      <div className="pt-6">
        <Tabs
          label="Reports"
          items={[
            { href: "/reports", label: "All reports", exact: true },
            { href: "/reports/sales", label: "Sales" },
            { href: "/reports/collections", label: "Money received" },
            { href: "/reports/vat", label: "VAT" },
            { href: "/reports/profit", label: "Profit and loss" },
            ...(hasPermission(user, "catalogue.costs")
              ? [{ href: "/reports/stock", label: "Stock value" }]
              : []),
          ]}
        />
      </div>
      {children}
    </>
  );
}
