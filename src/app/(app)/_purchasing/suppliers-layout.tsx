import type { ReactNode } from "react";

import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";

import { SupplierTabs } from "./ui";

/** Shared by the Suppliers section's pages. */
export async function SuppliersSection({ children }: { children: ReactNode }) {
  const user = await pageUser("suppliers.view");
  if (!user) return <NoAccess what="suppliers" />;
  return (
    <>
      <SupplierTabs />
      {children}
    </>
  );
}
