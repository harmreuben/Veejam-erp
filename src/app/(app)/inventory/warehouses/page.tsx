import { StatusBadge } from "@/components/format";
import { Page, PageHeader, Section } from "@/components/page";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listWarehouses } from "@/server/modules/inventory/queries";

import { WarehouseForm } from "./warehouse-form";

export const metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
  const user = await requireUser();
  const warehouses = await listWarehouses(getDb(), toActor(user));
  const canManage = hasPermission(user, "warehouses.manage");

  return (
    <Page>
      <PageHeader
        title="Warehouses"
        description="Anywhere stock is kept: the main store, a second store, or a delivery vehicle."
      />
      <Table minWidth={560}>
        <THead>
          <tr>
            <TH>Warehouse</TH>
            <TH>Location</TH>
            <TH numeric>Products in stock</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {warehouses.map((w) => (
            <tr key={w.id}>
              <TD>
                <span className="font-medium">{w.name}</span>
                <div className="text-muted-foreground text-xs">{w.code}</div>
              </TD>
              <TD>{w.location ?? "—"}</TD>
              <TD numeric>{w.productsInStock}</TD>
              <TD>
                <StatusBadge status={w.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
      {canManage && (
        <>
          <Section title="Add a warehouse">
            <WarehouseForm />
          </Section>
          {warehouses.map((w) => (
            <Section key={w.id} title={`Edit ${w.name}`}>
              <WarehouseForm warehouse={w} />
            </Section>
          ))}
        </>
      )}
    </Page>
  );
}
