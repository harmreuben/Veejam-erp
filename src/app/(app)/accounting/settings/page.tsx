import Link from "next/link";

import { Page, PageHeader, Section } from "@/components/page";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { accountingStatus } from "@/server/modules/accounting/service";

import { CloseBooksForm } from "../forms";

export const metadata = { title: "Closing the books" };

export default async function AccountingSettingsPage() {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  const db = getDb();
  const status = await accountingStatus(db);
  const canClose = hasPermission(user, "accounting.close");
  return (
    <Page>
      <PageHeader title="Closing the books" />
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
      <p className="text-muted-foreground text-sm">
        The accounts themselves, with their balances, are under{" "}
        <Link href="/accounting/accounts" className="text-link hover:underline">
          Chart of accounts
        </Link>
        .
      </p>
    </Page>
  );
}
