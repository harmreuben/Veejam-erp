import { randomUUID } from "node:crypto";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { todayInNairobi } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { editorData } from "@/server/modules/sales/queries";

import { BatchForm } from "./batch-form";

export const metadata = { title: "Batch of invoices" };

export default async function BatchInvoicesPage() {
  const user = await pageUser("invoices.post");
  if (!user) return <NoAccess what="posting invoices" />;
  const data = await editorData(getDb(), toActor(user));
  return (
    <Page wide>
      <PageHeader
        title="Batch of invoices"
        back={{ href: "/invoices", label: "Invoices" }}
        description="Enter several customers' invoices, for example a day's route, and post them all at once. Each invoice is posted on its own: if one can't be (stock or credit limit), it's kept as a draft and the others still go through."
      />
      {data.customers.length === 0 || data.products.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Add at least one customer and one product with a price first.
        </p>
      ) : (
        <BatchForm
          data={{
            ...data,
            products: data.products.map((p) => ({ ...p, taxCategory: String(p.taxCategory) })),
          }}
          today={todayInNairobi()}
          initialKey={randomUUID()}
        />
      )}
    </Page>
  );
}
