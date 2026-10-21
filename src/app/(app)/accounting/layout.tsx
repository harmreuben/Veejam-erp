import type { ReactNode } from "react";

import { NoAccess } from "@/components/no-access";
import { Tabs } from "@/components/tabs";
import { pageUser } from "@/server/auth/guard";

export default async function AccountingLayout({ children }: { children: ReactNode }) {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  return (
    <>
      <div className="pt-6">
        <Tabs
          label="Accounting"
          items={[
            { href: "/accounting", label: "Trial balance", exact: true },
            { href: "/accounting/journal", label: "Journal" },
            { href: "/accounting/settings", label: "Accounts and closing" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
