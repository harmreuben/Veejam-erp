import { FilterBar, param } from "@/components/filters";
import { formatDateTime } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { confirmationLog, messageLog } from "@/server/whatsapp/service";

import { MessageText } from "../message-text";

export const metadata = { title: "WhatsApp message log" };

const STATUS_VARIANT = {
  PROCESSED: "success",
  SENT: "success",
  SIMULATED: "secondary",
  RECEIVED: "secondary",
  REFUSED: "warning",
  FAILED: "destructive",
} as const;

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("whatsapp.view");
  if (!user) return <NoAccess what="the WhatsApp log" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const status = param(sp.status) ?? "ALL";
  const db = getDb();
  const actor = toActor(user);
  const [{ rows }, confirmations] = await Promise.all([
    messageLog(db, actor, { q, status: status === "ALL" ? undefined : status }),
    confirmationLog(db, actor),
  ]);

  return (
    <Page wide>
      <PageHeader
        title="Message log"
        description="Every WhatsApp message in and out, including refused ones. Newest first; the last 100 that match."
      />
      <FilterBar
        q={q}
        placeholder="Number, text or command"
        selects={[
          {
            name: "status",
            label: "Status",
            value: status,
            options: [
              { value: "ALL", label: "All" },
              ...Object.keys(STATUS_VARIANT).map((s) => ({
                value: s,
                label: s[0] + s.slice(1).toLowerCase(),
              })),
            ],
          },
        ]}
      />
      <Table minWidth={820}>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Direction</TH>
            <TH>Number</TH>
            <TH>Message</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No messages.</EmptyRow>}
          {rows.map((m) => (
            <tr key={m.id} className="align-top">
              <TD className="whitespace-nowrap">{formatDateTime(m.createdAt)}</TD>
              <TD>{m.direction === "IN" ? "In" : "Out"}</TD>
              <TD className="font-mono text-xs">
                {m.waNumber}
                {m.user && <div className="text-muted-foreground font-sans">{m.user.fullName}</div>}
              </TD>
              <TD className="max-w-[48ch]">
                {m.command && <div className="text-muted-foreground text-xs font-medium">{m.command}</div>}
                <MessageText body={m.body.length > 400 ? `${m.body.slice(0, 400)}…` : m.body} />
                {m.error && <div className="text-destructive mt-1 text-xs">{m.error}</div>}
              </TD>
              <TD>
                <Badge variant={STATUS_VARIANT[m.status]}>
                  {m.status[0] + m.status.slice(1).toLowerCase()}
                </Badge>
                {m.simulated && <div className="text-muted-foreground mt-1 text-xs">simulated</div>}
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>

      <Section title="Confirmations" description="Changes requested on WhatsApp and what happened to them.">
        <Table minWidth={760}>
          <THead>
            <tr>
              <TH>Requested</TH>
              <TH>By</TH>
              <TH>Request</TH>
              <TH>Outcome</TH>
            </tr>
          </THead>
          <TBody>
            {confirmations.length === 0 && <EmptyRow colSpan={4}>None yet.</EmptyRow>}
            {confirmations.map((c) => (
              <tr key={c.id} className="align-top">
                <TD className="whitespace-nowrap">{formatDateTime(c.createdAt)}</TD>
                <TD>{c.user.fullName}</TD>
                <TD className="max-w-[50ch]">
                  <MessageText body={c.summary} />
                </TD>
                <TD>
                  <Badge
                    variant={
                      c.status === "CONFIRMED"
                        ? "success"
                        : c.status === "FAILED"
                          ? "destructive"
                          : c.status === "PENDING"
                            ? "warning"
                            : "secondary"
                    }
                  >
                    {c.status[0] + c.status.slice(1).toLowerCase()}
                  </Badge>
                  {c.resultRef && <div className="mt-1 font-mono text-xs">{c.resultRef}</div>}
                  {c.error && <div className="text-muted-foreground mt-1 text-xs">{c.error}</div>}
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Section>
    </Page>
  );
}
