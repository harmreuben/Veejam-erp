import { formatDateTime } from "@/components/format";
import { addDays, toDbDate, todayInNairobi } from "@/lib/dates";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { getServerEnv } from "@/config/env";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";

import { NumberForm } from "./number-form";

export const metadata = { title: "WhatsApp settings" };

export default async function NumberPage() {
  const user = await pageUser("whatsapp.use");
  if (!user) return <NoAccess what="WhatsApp settings" />;
  const env = getServerEnv();
  const db = getDb();
  const weekAgo = toDbDate(addDays(todayInNairobi(), -6));
  const [me, inbound, outbound, last] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { whatsappNumber: true } }),
    db.whatsAppMessage.count({ where: { direction: "IN", createdAt: { gte: weekAgo } } }),
    db.whatsAppMessage.count({ where: { direction: "OUT", createdAt: { gte: weekAgo } } }),
    db.whatsAppMessage.findFirst({ where: { direction: "IN" }, orderBy: { createdAt: "desc" } }),
  ]);
  const live = env.WHATSAPP_PROVIDER === "meta";
  const set = (v: unknown) => (v ? "Set" : "Not set");
  const configured = env.VEEJAM_OWNER_WHATSAPP_NUMBER;

  return (
    <Page>
      <PageHeader
        title="WhatsApp settings"
        description="WhatsApp is connected through Meta's official WhatsApp Business Cloud API. Commands are accepted only from an active owner's linked number; for real messages it must also be the number set in VEEJAM_OWNER_WHATSAPP_NUMBER."
      />
      <NumberForm current={me.whatsappNumber} />
      <div className="vj-stagger grid gap-3 sm:grid-cols-3">
        <div className="bg-card grid gap-1 rounded-lg border p-4">
          <div className="text-muted-foreground text-sm">Connection</div>
          <div className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden
              className={
                live ? "bg-whatsapp-bright size-2.5 rounded-full" : "bg-warning-fill size-2.5 rounded-full"
              }
            />
            {live ? "Meta Cloud API (live)" : "Test mode (simulated)"}
          </div>
          <div className="text-muted-foreground text-xs">
            {live
              ? "Real messages are sent and received."
              : "Only the simulator works; nothing reaches WhatsApp."}
          </div>
        </div>
        <div className="bg-card grid gap-1 rounded-lg border p-4">
          <div className="text-muted-foreground text-sm">Messages, last 7 days</div>
          <div className="font-mono text-xl font-semibold">
            {inbound} in · {outbound} out
          </div>
          <div className="text-muted-foreground text-xs">
            Simulated and real together; see the message log.
          </div>
        </div>
        <div className="bg-card grid gap-1 rounded-lg border p-4">
          <div className="text-muted-foreground text-sm">Last command received</div>
          <div className="font-semibold">{last ? formatDateTime(last.createdAt) : "None yet"}</div>
        </div>
      </div>
      <Section
        title="Server settings"
        description="Set on the server (Vercel environment variables), never in the app. Values are never shown here, only whether they are set."
      >
        <DetailList
          items={[
            { label: "Your linked number", value: me.whatsappNumber ?? "None yet" },
            { label: "Provider (WHATSAPP_PROVIDER)", value: live ? "meta" : "mock" },
            {
              label: "Owner number",
              value: configured
                ? `ends in ${configured.slice(-3)}`
                : "Not set — only the simulator will work",
            },
            { label: "Access token", value: set(env.META_WHATSAPP_TOKEN) },
            { label: "Phone number ID", value: set(env.META_WHATSAPP_PHONE_NUMBER_ID) },
            { label: "Business account ID", value: set(env.META_WHATSAPP_BUSINESS_ACCOUNT_ID) },
            { label: "Webhook verify token", value: set(env.META_WHATSAPP_VERIFY_TOKEN) },
            {
              label: "Webhook signing secret",
              value: env.META_APP_SECRET ? "Set" : "Not set — the webhook refuses every call",
            },
            { label: "Webhook address", value: <code className="break-all">{`${env.APP_BASE_URL}/api/whatsapp/webhook`}</code> },
          ]}
        />
      </Section>
      <Section title="Safety rules (always on)">
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>
            Only an active owner&apos;s linked number can run commands; every other number is ignored and
            logged.
          </li>
          <li>
            Anything that changes money or stock waits for you to reply with a confirmation before it happens.
          </li>
          <li>Every message, in and out, is kept in the message log.</li>
          <li>WhatsApp is the only messaging channel: no SMS or email is sent.</li>
        </ul>
      </Section>
    </Page>
  );
}
