import type { ReactNode } from "react";

import { NoAccess } from "@/components/no-access";
import { Tabs } from "@/components/tabs";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";

export default async function WhatsAppLayout({ children }: { children: ReactNode }) {
  const user = await pageUser("whatsapp.view");
  if (!user) return <NoAccess what="WhatsApp commands" />;
  const owner = hasPermission(user, "whatsapp.use");
  return (
    <>
      <div className="pt-6">
        <Tabs
          label="WhatsApp"
          items={[
            ...(owner ? [{ href: "/whatsapp", label: "Simulator", exact: true }] : []),
            { href: "/whatsapp/log", label: "Message log" },
            ...(owner ? [{ href: "/whatsapp/number", label: "Your number" }] : []),
          ]}
        />
      </div>
      {children}
    </>
  );
}
