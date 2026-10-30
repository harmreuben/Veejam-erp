import Link from "next/link";

import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import type { AccountType } from "@/generated/prisma/enums";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ACCOUNT_TYPE_LABELS, trialBalance } from "@/server/modules/accounting/service";

import { NewAccountForm } from "../forms";

export const metadata = { title: "Chart of accounts" };

const ORDER: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const PLURAL: Record<AccountType, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expenses",
};

/** Every account, grouped by type, with today's balance; each opens its ledger. */
export default async function ChartOfAccountsPage() {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  const tb = await trialBalance(getDb(), toActor(user));
  const canAdd = hasPermission(user, "accounting.close");
  return (
    <Page wide>
      <PageHeader
        title="Chart of accounts"
        description="Every account in the books and what it holds today, shown in its normal direction (assets and expenses as debits, the rest as credits). Open an account to see every entry in it."
      />
      {ORDER.map((type) => {
        const rows = tb.rows.filter((r) => r.type === type);
        if (!rows.length) return null;
        const total = rows.reduce((s, r) => s.plus(r.balance), toDecimal(0)).toFixed(2);
        return (
          <Section key={type} title={PLURAL[type]}>
            <Table minWidth={640}>
              <THead>
                <tr>
                  <TH className="w-24">Code</TH>
                  <TH>Account</TH>
                  <TH>Posted to</TH>
                  <TH numeric>Balance</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/50">
                    <TD className="font-mono">{a.code}</TD>
                    <TD className="min-w-56">
                      <Link href={`/accounting/accounts/${a.id}`} className="text-link hover:underline">
                        {a.name}
                      </Link>
                      {a.status !== "ACTIVE" && (
                        <Badge variant="secondary" className="ml-2">
                          Inactive
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {a.systemKey ? "Automatic" : "Manual entries"}
                    </TD>
                    <TD numeric>
                      <Money value={a.balance} />
                    </TD>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <TD colSpan={3}>Total {ACCOUNT_TYPE_LABELS[type].toLowerCase()} accounts</TD>
                  <TD numeric>
                    <Money value={total} />
                  </TD>
                </tr>
              </TBody>
            </Table>
          </Section>
        );
      })}
      {canAdd && (
        <Section title="Add an account" description="For expenses or other accounts you post to by hand.">
          <NewAccountForm />
        </Section>
      )}
    </Page>
  );
}
