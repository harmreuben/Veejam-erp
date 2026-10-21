import Link from "next/link";

import { formatDateTime, StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { IMPORT_COLUMNS, IMPORT_KIND_LABELS } from "@/server/modules/imports/definitions";
import { listImports } from "@/server/modules/imports/service";

import { UploadForm } from "./forms";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const user = await pageUser("imports.run");
  if (!user) return <NoAccess what="imports" />;
  const jobs = await listImports(getDb(), toActor(user));
  const kinds = Object.entries(IMPORT_KIND_LABELS).map(([value, label]) => ({ value, label }));

  return (
    <Page>
      <PageHeader
        title="Imports"
        description="Load customers, products and prices, or suppliers from a spreadsheet. Every row is checked with the same rules as the forms, and you review it before anything is saved."
      />
      <Section title="Upload a file">
        <UploadForm kinds={kinds} />
      </Section>

      <Section
        title="Templates"
        description="Download a template, fill it in Excel, then save as CSV. Column names must match."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {kinds.map((k) => (
            <details key={k.value} className="bg-card rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">{k.label}</summary>
              <a
                href={`/imports/template/${k.value.toLowerCase()}`}
                className="text-primary mt-3 inline-block hover:underline"
                download
              >
                Download template (.csv)
              </a>
              <ul className="mt-3 grid gap-1.5">
                {IMPORT_COLUMNS[k.value as keyof typeof IMPORT_COLUMNS].map((c) => (
                  <li key={c.name}>
                    <code className="text-foreground">{c.name}</code>
                    {c.required && <span className="text-destructive"> *</span>}
                    <span className="text-muted-foreground"> — {c.help}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Section>

      <Section title="Recent imports">
        <Table minWidth={640}>
          <THead>
            <tr>
              <TH>File</TH>
              <TH>Type</TH>
              <TH>Uploaded</TH>
              <TH numeric>Rows</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {jobs.length === 0 && <EmptyRow colSpan={5}>No imports yet.</EmptyRow>}
            {jobs.map((j) => (
              <tr key={j.id} className="hover:bg-muted/50">
                <TD>
                  <Link href={`/imports/${j.id}`} className="text-primary font-medium hover:underline">
                    {j.fileName}
                  </Link>
                </TD>
                <TD>{IMPORT_KIND_LABELS[j.kind]}</TD>
                <TD className="whitespace-nowrap">
                  {formatDateTime(j.createdAt)}
                  <div className="text-muted-foreground text-xs">{j.createdBy.fullName}</div>
                </TD>
                <TD numeric>
                  {j.totalRows}
                  {j.errorRows > 0 && (
                    <div className="text-destructive text-xs">{j.errorRows} with errors</div>
                  )}
                </TD>
                <TD>
                  <StatusBadge status={j.status} />
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Section>
    </Page>
  );
}
