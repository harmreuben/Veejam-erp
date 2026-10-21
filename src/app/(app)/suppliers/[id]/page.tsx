import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getSupplier } from "@/server/modules/suppliers/service";

import { updateSupplierAction } from "../actions";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("suppliers.view");
  if (!user) return <NoAccess what="suppliers" />;
  const { id } = await params;
  const s = await getSupplier(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <Page>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.name} <StatusBadge status={s.status} />
          </span>
        }
        back={{ href: "/suppliers", label: "Suppliers" }}
        description={s.code}
      />
      <SupplierForm
        action={updateSupplierAction}
        values={s}
        canEdit={hasPermission(user.role, "suppliers.manage")}
      />
    </Page>
  );
}
