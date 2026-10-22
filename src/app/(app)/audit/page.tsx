import Link from "next/link";
import { Download } from "lucide-react";

import { param, selectClass } from "@/components/filters";
import { formatDateTime } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { listAudit } from "@/server/audit/queries";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Audit log" };

const label = (a: string) => a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, " ");

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <pre className="bg-muted max-h-64 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("audit.view");
  if (!user) return <NoAccess what="the audit log" />;
  const sp = await searchParams;
  const filter = {
    q: param(sp.q),
    action: param(sp.action) || undefined,
    from: param(sp.from),
    to: param(sp.to),
    before: param(sp.before),
  };
  const { rows, next, actions } = await listAudit(getDb(), toActor(user), filter);
  const qs = (extra: Record<string, string | undefined>) =>
    new URLSearchParams(
      Object.entries({ ...filter, ...extra }).filter((e): e is [string, string] => !!e[1]),
    ).toString();

  return (
    <Page wide>
      <PageHeader
        title="Audit log"
        description="Every sign-in, change, posting, payment, export and WhatsApp command, newest first. Entries can't be edited or deleted — the database refuses."
        actions={
          <Button asChild variant="ghost">
            <a href={`/audit/csv?${qs({ before: undefined })}`}>
              <Download aria-hidden /> Download CSV
            </a>
          </Button>
        }
      />
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-[14rem] flex-1 gap-1">
          <span className="text-muted-foreground text-xs">Search</span>
          <Input name="q" type="search" defaultValue={filter.q} placeholder="Who, summary, or a record id" />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Action</span>
          <select name="action" defaultValue={filter.action ?? ""} className={selectClass}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">From</span>
          <Input type="date" name="from" defaultValue={filter.from} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">To</span>
          <Input type="date" name="to" defaultValue={filter.to} />
        </label>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>

      <Table minWidth={900}>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Who</TH>
            <TH>Action</TH>
            <TH>What happened</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={4}>Nothing matches.</EmptyRow>}
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <TD className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</TD>
              <TD className="max-w-[22ch] break-words">
                {r.actorLabel}
                {r.ipAddress && <div className="text-muted-foreground font-mono text-xs">{r.ipAddress}</div>}
              </TD>
              <TD className="whitespace-nowrap">{label(r.action)}</TD>
              <TD className="max-w-[60ch]">
                {r.summary ??
                  (r.entityType === "Session" ? "" : `${r.entityType}${r.entityId ? ` ${r.entityId}` : ""}`)}
                {(r.before !== null || r.after !== null || r.metadata !== null) && (
                  <details className="mt-1">
                    <summary className="text-muted-foreground cursor-pointer text-xs">Details</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {r.before !== null && (
                        <div>
                          <div className="text-muted-foreground text-xs">Before</div>
                          <Json value={r.before} />
                        </div>
                      )}
                      {r.after !== null && (
                        <div>
                          <div className="text-muted-foreground text-xs">After</div>
                          <Json value={r.after} />
                        </div>
                      )}
                      {r.metadata !== null && (
                        <div>
                          <div className="text-muted-foreground text-xs">Other</div>
                          <Json value={r.metadata} />
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
      {next && (
        <Link
          href={`/audit?${qs({ before: next })}`}
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          Older entries →
        </Link>
      )}
    </Page>
  );
}
