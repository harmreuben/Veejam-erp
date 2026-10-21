import type { ReactNode } from "react";

import { Tabs } from "@/components/tabs";

export default function CreditNotesLayout({ children }: { children: ReactNode }) {
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
