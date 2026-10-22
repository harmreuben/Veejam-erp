import Link from "next/link";

import { formatDateTime } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { getServerEnv } from "@/config/env";
import { cn } from "@/lib/utils";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { conversation } from "@/server/whatsapp/service";

import { MessageText } from "./message-text";
import { SimulatorForm } from "./simulator-form";

export const metadata = { title: "WhatsApp simulator" };

export default async function SimulatorPage() {
  const user = await pageUser("whatsapp.use");
  if (!user) return <NoAccess what="the WhatsApp simulator" />;
  const env = getServerEnv();
  const db = getDb();
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { whatsappNumber: true } });
  const messages = me.whatsappNumber ? await conversation(db, toActor(user), me.whatsappNumber) : [];
  const mock = env.WHATSAPP_PROVIDER === "mock";

  return (
    <Page>
      <PageHeader
        title="WhatsApp commands"
        description="Ask the ERP for figures and record payments or sales from WhatsApp. Changes always need a reply of YES with a one-time code."
      />

      {mock ? (
        <p className="bg-warning/10 border-warning/40 rounded-md border p-3 text-sm">
          <strong>Simulated.</strong> Messages typed here are handled exactly like real WhatsApp messages and
          can change real data once confirmed, but no WhatsApp message is sent. Real messages arrive once the
          Meta Cloud API is connected (Phase 7).
        </p>
      ) : (
        <p className="bg-muted rounded-md p-3 text-sm">
          The simulator is only available with the mock provider. Real messages are shown in the message log.
        </p>
      )}

      {!me.whatsappNumber ? (
        <div className="bg-card grid gap-2 rounded-lg border p-5 text-sm">
          <p className="font-medium">Link your WhatsApp number first.</p>
          <p className="text-muted-foreground">
            Commands are accepted only from an owner&apos;s linked number.{" "}
            <Link href="/whatsapp/number" className="text-primary underline-offset-4 hover:underline">
              Link your number
            </Link>
          </p>
        </div>
      ) : (
        <section aria-label="Conversation" className="bg-card overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm">
            <span>
              Your number <span className="font-mono">{me.whatsappNumber}</span> ↔ VeeJam ERP
            </span>
            {mock && <Badge variant="secondary">Mock provider</Badge>}
          </div>
          {/* column-reverse keeps the newest message in view without any script */}
          <div className="flex max-h-[60vh] flex-col-reverse overflow-y-auto bg-[color-mix(in_oklab,var(--muted)_60%,transparent)]">
            <ol className="grid gap-3 p-4">
              {messages.length === 0 && (
                <li className="text-muted-foreground text-center text-sm">No messages yet. Try HELP.</li>
              )}
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
                    m.direction === "IN"
                      ? "bg-primary text-primary-foreground justify-self-end"
                      : "bg-card justify-self-start border",
                  )}
                >
                  <MessageText body={m.body} />
                  <div
                    className={cn(
                      "mt-1 text-right text-[11px]",
                      m.direction === "IN" ? "text-primary-foreground/75" : "text-muted-foreground",
                    )}
                  >
                    {formatDateTime(m.createdAt)}
                    {m.status === "REFUSED" && " · refused"}
                    {m.status === "FAILED" && " · failed"}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {mock && <SimulatorForm />}
        </section>
      )}
    </Page>
  );
}
