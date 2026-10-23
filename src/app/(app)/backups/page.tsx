import { formatDateTime } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Backup & recovery" };

const DAY = 86_400_000;

function age(d: Date | undefined): string {
  if (!d) return "never";
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** True when there is no run, or the last one is more than `days` old. */
function overdue(d: Date | undefined, days: number): boolean {
  return !d || Date.now() - d.getTime() > days * DAY;
}

function Code({ children }: { children: string }) {
  return <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">{children}</pre>;
}

export default async function BackupsPage() {
  const user = await pageUser("backups.view");
  if (!user) return <NoAccess what="backups" />;
  const runs = await getDb().backupRun.findMany({ orderBy: { takenAt: "desc" }, take: 30 });
  const lastBackup = runs.find((r) => r.kind === "backup");
  const lastDrill = runs.find((r) => r.kind === "restore-drill");
  const backupOverdue = overdue(lastBackup?.takenAt, 7);
  const drillOverdue = overdue(lastDrill?.takenAt, 31);

  return (
    <Page>
      <PageHeader
        title="Backup & recovery"
        description="Encrypted copies of the whole database, taken from your computer, and proof that they can be restored."
      />

      <div className="vj-stagger grid gap-3 sm:grid-cols-2">
        <div className="bg-card grid gap-1 rounded-lg border p-4">
          <div className="text-muted-foreground text-sm">Last backup</div>
          <div className="text-xl font-semibold">{age(lastBackup?.takenAt)}</div>
          {backupOverdue ? (
            <Badge variant="warning" className="w-fit">
              Take one this week
            </Badge>
          ) : (
            <div className="text-muted-foreground text-xs">
              {lastBackup!.tables} tables, {lastBackup!.rows.toLocaleString("en-KE")} rows
            </div>
          )}
        </div>
        <div className="bg-card grid gap-1 rounded-lg border p-4">
          <div className="text-muted-foreground text-sm">Last restore drill</div>
          <div className="text-xl font-semibold">{age(lastDrill?.takenAt)}</div>
          {drillOverdue ? (
            <Badge variant="warning" className="w-fit">
              Test a restore this month
            </Badge>
          ) : (
            <div className="text-muted-foreground text-xs">Every table matched the backup exactly.</div>
          )}
        </div>
      </div>

      <Section
        title="Take a backup"
        description="In PowerShell, in the project folder. Weekly at least, and before any big change."
      >
        <Code>{`npm run backup\n# or straight to a USB drive or synced folder:\nnpm run backup -- --out "E:\\VeeJam backups"`}</Code>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>
            It needs <code>BACKUP_PASSPHRASE</code> in <code>.env.local</code>. Keep the passphrase in a
            password manager too — a backup can&apos;t be opened without it.
          </li>
          <li>
            The file holds customer details and every figure; it is encrypted, but still keep copies only
            where you trust.
          </li>
          <li>
            Keep at least one copy off this computer (USB drive in another place, or personal cloud storage).
          </li>
          <li>
            Supabase also keeps its own daily backups on paid plans; these files are your independent copy.
          </li>
        </ul>
      </Section>

      <Section
        title="Test a restore (the drill)"
        description="Once a month: restore into an empty database and let the script check every row."
      >
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          <li>
            Make an empty database: a new free Supabase project called <em>veejam-drill</em>, or a local
            PostgreSQL database.
          </li>
          <li>
            Run the restore with its connection string. It creates the tables, loads the backup and compares
            every table.
          </li>
        </ol>
        <Code>{`npm run backup:restore -- --file backups\\veejam-backup-YYYYMMDD-HHMMSS.vjb --to "postgresql://…/veejam_drill" --migrate`}</Code>
        <p className="text-muted-foreground text-sm">
          In a real emergency, restore the same way into a new Supabase project, check it, then put its
          connection strings in <code>.env.local</code> and in Vercel. The script refuses to restore over the
          database the app is using.
        </p>
      </Section>

      <Section title="History">
        <Table minWidth={640}>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>What</TH>
              <TH>File</TH>
              <TH numeric>Rows</TH>
              <TH>By</TH>
            </tr>
          </THead>
          <TBody>
            {runs.length === 0 && <EmptyRow colSpan={5}>No backups recorded yet.</EmptyRow>}
            {runs.map((r) => (
              <tr key={r.id}>
                <TD className="whitespace-nowrap">{formatDateTime(r.takenAt)}</TD>
                <TD>
                  {r.kind === "backup" ? (
                    <Badge variant="secondary">Backup</Badge>
                  ) : (
                    <Badge variant="success">Restore verified</Badge>
                  )}
                </TD>
                <TD className="font-mono text-xs break-all">{r.fileName}</TD>
                <TD numeric>{r.rows.toLocaleString("en-KE")}</TD>
                <TD className="text-xs break-all">{r.takenBy}</TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Section>
    </Page>
  );
}
