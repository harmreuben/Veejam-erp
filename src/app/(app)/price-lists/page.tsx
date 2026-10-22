import Link from "next/link";

import { StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listPriceLists } from "@/server/modules/pricing/service";

import { NewPriceListForm } from "./forms";

export const metadata = { title: "Price lists" };

export default async function PriceListsPage() {
  const user = await pageUser("catalogue.view");
  if (!user) return <NoAccess what="price lists" />;
  const lists = await listPriceLists(getDb(), toActor(user));
  const canManage = hasPermission(user, "pricing.manage");

  return (
    <Page>
      <PageHeader
        title="Price lists"
        description="Each customer is charged from their own price list, or from the default list if they have none. Every price change is recorded with who made it."
      />
      <Table minWidth={560}>
        <THead>
          <tr>
            <TH>Price list</TH>
            <TH>Tax</TH>
            <TH numeric>Prices</TH>
            <TH numeric>Customers</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {lists.map((l) => (
            <tr key={l.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/price-lists/${l.id}`} className="font-medium hover:underline">
                  {l.name}
                </Link>{" "}
                {l.isDefault && <Badge variant="secondary">Default</Badge>}
                <div className="text-muted-foreground text-xs">{l.code}</div>
              </TD>
              <TD>{l.pricesIncludeTax ? "VAT inclusive" : "VAT exclusive"}</TD>
              <TD numeric>{l._count.items}</TD>
              <TD numeric>{l._count.customers}</TD>
              <TD>
                <StatusBadge status={l.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
      {canManage && (
        <Section title="New price list" description="For example a wholesale list for large buyers.">
          <NewPriceListForm />
        </Section>
      )}
    </Page>
  );
}
