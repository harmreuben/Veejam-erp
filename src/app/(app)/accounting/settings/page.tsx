import { Page, PageHeader, Section } from "@/components/page";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ACCOUNT_TYPE_LABELS, accountingStatus, listAccounts } from "@/server/modules/accounting/service";

import { CloseBooksForm, NewAccountForm } from "../forms";

export const metadata = { title: "Accounts and closing" };

export default async function AccountingSettingsPage() {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  const db = getDb();
  const [accounts, status] = await Promise.all([listAccounts(db, toActor(user)), accountingStatus(db)]);
  const canClose = hasPermission(user.role, "accounting.close");
  return (
    <Page>
      <PageHeader title="Accounts and closing" />
      <Section
        title="Closing the books"
        description="Once a month is checked (VAT filed, bank reconciled), close it: nothing can then be posted on or before that date. Leave blank to reopen."
      >
        {canClose ? (
          <CloseBooksForm current={status.booksClosedUntil} />
        ) : (
          <p className="text-sm">
            {status.booksClosedUntil ? `Closed up to ${status.booksClosedUntil}.` : "Not closed."} Only an
            owner or administrator can change this.
          </p>
        )}
      </Section>
      <Section
        title="Chart of accounts"
        description="Accounts marked automatic are posted to by the system and can't be removed."
      >
        <Table minWidth={560}>
          <THead>
            <tr>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Posted to</TH>
            </tr>
          </THead>
          <TBody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <TD className="font-mono">{a.code}</TD>
                <TD>{a.name}</TD>
                <TD>{ACCOUNT_TYPE_LABELS[a.type]}</TD>
                <TD className="text-muted-foreground">{a.systemKey ? "Automatic" : "Manual entries"}</TD>
              </tr>
            ))}
          </TBody>
        </Table>
        {canClose && <NewAccountForm />}
      </Section>
    </Page>
  );
}
