import type { ReactNode } from "react";

import { NoAccess } from "@/components/no-access";
import { Tabs } from "@/components/tabs";
import { pageUser } from "@/server/auth/guard";

export default async function PaymentsLayout({ children }: { children: ReactNode }) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="payments" />;
  return (
    <>
      <div className="pt-6">
        <Tabs
          label="Payments"
          items={[
            { href: "/payments", label: "Payments", exact: true },
            { href: "/payments/balances", label: "Customer balances" },
            { href: "/credit-notes", label: "Credit notes" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
