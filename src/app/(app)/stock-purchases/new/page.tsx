import { randomUUID } from "node:crypto";

import Link from "next/link";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { todayInNairobi } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { stockPurchaseFormData } from "@/server/modules/purchasing/stock-purchase";

import { StockPurchaseForm } from "../../_purchasing/stock-purchase-form";

export const metadata = { title: "Record a stock purchase" };

export default async function NewStockPurchasePage() {
  const user = await pageUser("goods.receive");
  if (!user || !hasPermission(user, "bills.manage") || !hasPermission(user, "catalogue.costs"))
    return <NoAccess what="recording stock purchases" />;
  const data = await stockPurchaseFormData(getDb(), toActor(user));
  return (
    <Page>
      <PageHeader
        title="Record a stock purchase"
        back={{ href: "/stock-purchases", label: "Stock purchases" }}
        description={
          <>
            What you bought from a supplier, from their invoice or receipt. A new supplier?{" "}
            <Link href="/suppliers/new" className="text-link hover:underline">
              Add them first
            </Link>
            .
          </>
        }
      />
      {data.suppliers.length === 0 || data.products.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Add {data.suppliers.length === 0 ? "a supplier" : ""}
          {data.suppliers.length === 0 && data.products.length === 0 ? " and " : ""}
          {data.products.length === 0 ? "the products" : ""} first.
        </p>
      ) : (
        <StockPurchaseForm idempotencyKey={randomUUID()} today={todayInNairobi()} {...data} />
      )}
    </Page>
  );
}
