import type { ReactNode } from "react";

import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";

import { InventoryTabs } from "./tabs";

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const user = await pageUser("inventory.view");
  if (!user) return <NoAccess what="inventory" />;
  return (
    <>
      <div className="pt-6">
        <InventoryTabs />
      </div>
      {children}
    </>
  );
}
