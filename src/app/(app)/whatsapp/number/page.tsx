import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { getServerEnv } from "@/config/env";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";

import { NumberForm } from "./number-form";

export const metadata = { title: "Your WhatsApp number" };

export default async function NumberPage() {
  const user = await pageUser("whatsapp.use");
  if (!user) return <NoAccess what="WhatsApp settings" />;
  const env = getServerEnv();
  const me = await getDb().user.findUniqueOrThrow({
    where: { id: user.id },
    select: { whatsappNumber: true },
  });
  const configured = env.VEEJAM_OWNER_WHATSAPP_NUMBER;

  return (
    <Page>
      <PageHeader
        title="Your WhatsApp number"
        description="Commands are accepted only from an active owner's linked number. For real messages it must also be the number set in VEEJAM_OWNER_WHATSAPP_NUMBER."
      />
      <NumberForm current={me.whatsappNumber} />
      <Section title="How it is set up">
        <DetailList
          items={[
            { label: "Your linked number", value: me.whatsappNumber ?? "None yet" },
            {
              label: "Provider",
              value: env.WHATSAPP_PROVIDER === "mock" ? "Mock (simulated)" : "Meta Cloud API",
            },
            {
              label: "Owner number in .env.local",
              value: configured
                ? `ends in ${configured.slice(-3)}`
                : "Not set — only the simulator will work",
            },
            {
              label: "Webhook signing secret",
              value: env.META_APP_SECRET ? "Set" : "Not set — the webhook refuses every call",
            },
            { label: "Webhook address", value: <code>{`${env.APP_BASE_URL}/api/whatsapp/webhook`}</code> },
          ]}
        />
      </Section>
    </Page>
  );
}
