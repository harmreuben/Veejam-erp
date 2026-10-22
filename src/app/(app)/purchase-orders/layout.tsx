import type { ReactNode } from "react";

import { PurchasingTabs } from "../_purchasing/ui";

export default function PurchaseOrdersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PurchasingTabs />
      {children}
    </>
  );
}
