import type { ReactNode } from "react";

import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";

import { PayablesTabs } from "../_purchasing/ui";

export default async function PayablesLayout({ children }: { children: ReactNode }) {
  const user = await pageUser("payables.view");
  if (!user) return <NoAccess what="supplier bills and payments" />;
  return (
    <>
      <PayablesTabs />
      {children}
    </>
  );
}
