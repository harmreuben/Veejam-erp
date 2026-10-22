import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { todayInNairobi } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { SUBLEDGER_ACCOUNTS } from "@/server/modules/accounting/journal";

import { JournalForm } from "../../forms";

export const metadata = { title: "New journal entry" };

export default async function NewJournalPage() {
  const user = await pageUser("accounting.journal");
  if (!user) return <NoAccess what="journal entries" />;
  const accounts = await getDb().account.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ systemKey: null }, { systemKey: { notIn: [...SUBLEDGER_ACCOUNTS] } }],
    },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  return (
    <Page wide>
      <PageHeader
        title="New journal entry"
        back={{ href: "/accounting/journal", label: "Journal" }}
        description="For expenses, owner's money in or out, bank charges and corrections. Debits must equal credits. Customer balances only change through invoices, payments and credit notes."
      />
      <JournalForm accounts={accounts} today={todayInNairobi()} />
    </Page>
  );
}
