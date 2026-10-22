import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getPriceGrid } from "@/server/modules/pricing/service";

import { PriceGrid, PriceListSettingsForm } from "../forms";

export const metadata = { title: "Price list" };

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("catalogue.view");
  if (!user) return <NoAccess what="price lists" />;
  const { id } = await params;
  const { list, rows, isDefault } = await getPriceGrid(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const canManage = hasPermission(user, "pricing.manage");

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {list.name} <StatusBadge status={list.status} />{" "}
            {isDefault && <Badge variant="secondary">Default</Badge>}
          </span>
        }
        back={{ href: "/price-lists", label: "Price lists" }}
        description={`${list.code} · Prices ${list.pricesIncludeTax ? "include" : "exclude"} VAT`}
      />
      <Section
        title="Prices"
        description="Amounts in KES. Changes are saved together and recorded in the audit log."
      >
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No active products yet.{" "}
            <Link href="/products/new" className="text-primary hover:underline">
              Add a product
            </Link>{" "}
            first.
          </p>
        ) : (
          <PriceGrid listId={list.id} rows={rows} canEdit={canManage} />
        )}
      </Section>
      {canManage && (
        <Section title="Settings">
          <PriceListSettingsForm list={list} isDefault={isDefault} />
        </Section>
      )}
    </Page>
  );
}
