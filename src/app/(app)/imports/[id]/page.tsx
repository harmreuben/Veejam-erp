import { notFound } from "next/navigation";

import { formatDateTime, StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { IMPORT_COLUMNS, IMPORT_KIND_LABELS } from "@/server/modules/imports/definitions";
import { getImport } from "@/server/modules/imports/service";

import { ReviewButtons } from "../forms";

export const metadata = { title: "Review import" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("imports.run");
  if (!user) return <NoAccess what="imports" />;
  const { id } = await params;
  const job = await getImport(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const columns = IMPORT_COLUMNS[job.kind].map((c) => c.name);
  const creates = job.rows.filter((r) => r.action === "CREATE").length;
  const updates = job.rows.filter((r) => r.action === "UPDATE").length;
  const summary = job.summary as { created: number; updated: number; unchanged: number } | null;
  // Show the error rows first, so problems are visible without scrolling.
  const rows = [...job.rows].sort(
    (a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || a.rowNumber - b.rowNumber,
  );

  return (
    <Page wide>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {job.fileName} <StatusBadge status={job.status} />
          </span>
        }
        back={{ href: "/imports", label: "Imports" }}
        description={`${IMPORT_KIND_LABELS[job.kind]} · uploaded ${formatDateTime(job.createdAt)} by ${job.createdBy.fullName}`}
      />

      {job.status === "VALIDATED" && job.errorRows > 0 && (
        <div role="alert" className="bg-destructive/10 text-destructive rounded-md px-4 py-3 text-sm">
          <strong>
            {job.errorRows} of {job.totalRows} rows have problems.
          </strong>{" "}
          Nothing has been saved. Fix them in the spreadsheet (the row numbers match Excel), then upload it
          again.
        </div>
      )}
      {job.status === "VALIDATED" && job.errorRows === 0 && (
        <div className="bg-success-soft text-success rounded-md px-4 py-3 text-sm">
          All {job.totalRows} rows passed: <strong>{creates} new</strong> and{" "}
          <strong>{updates} updates</strong> to existing records. Nothing is saved until you confirm. If
          anything has changed by then, all rows are checked again and nothing is saved unless every row still
          passes.
        </div>
      )}
      {job.status === "COMMITTED" && summary && (
        <div role="status" className="bg-success-soft text-success rounded-md px-4 py-3 text-sm">
          Imported {formatDateTime(job.committedAt)} by {job.committedBy?.fullName}: {summary.created}{" "}
          created, {summary.updated} updated, {summary.unchanged} unchanged.
        </div>
      )}

      {job.status === "CANCELLED" && (
        <div role="status" className="bg-muted text-muted-foreground rounded-md px-4 py-3 text-sm">
          This import was cancelled. Nothing from this file was saved.
        </div>
      )}

      {job.status === "VALIDATED" && <ReviewButtons id={job.id} canCommit={job.errorRows === 0} />}

      <Table minWidth={Math.max(900, columns.length * 130)}>
        <THead>
          <tr>
            <TH>Row</TH>
            <TH>Result</TH>
            {columns.map((c) => (
              <TH key={c}>{c}</TH>
            ))}
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => {
            const data = r.data as Record<string, string>;
            return (
              <tr key={r.id.toString()} className={r.errors.length ? "bg-destructive/5" : undefined}>
                <TD className="text-muted-foreground">{r.rowNumber}</TD>
                <TD className="min-w-[16rem]">
                  {r.errors.length ? (
                    <ul className="text-destructive grid gap-0.5 text-xs">
                      {r.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    <Badge variant={r.action === "CREATE" ? "success" : "secondary"}>
                      {r.action === "CREATE" ? "New" : "Update"}
                    </Badge>
                  )}
                </TD>
                {columns.map((c) => (
                  <TD key={c} className="max-w-[16rem] truncate text-xs">
                    {data[c] ?? ""}
                  </TD>
                ))}
              </tr>
            );
          })}
        </TBody>
      </Table>
    </Page>
  );
}
