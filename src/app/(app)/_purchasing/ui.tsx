import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { Tabs } from "@/components/tabs";
import { Badge } from "@/components/ui/badge";
import { PO_STATUS_LABELS } from "@/server/modules/purchasing/schemas";

const PO_VARIANT: Record<PurchaseOrderStatus, "success" | "secondary" | "warning" | "outline" | "default"> = {
  DRAFT: "warning",
  ORDERED: "default",
  PARTLY_RECEIVED: "outline",
  RECEIVED: "success",
  CLOSED: "secondary",
  CANCELLED: "secondary",
};

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge variant={PO_VARIANT[status]}>{PO_STATUS_LABELS[status]}</Badge>;
}

export type BillState = "UNPAID" | "PART_PAID" | "PAID" | "OVERDUE" | "CANCELLED";
const BILL: Record<
  BillState,
  { label: string; variant: "success" | "secondary" | "warning" | "outline" | "destructive" }
> = {
  UNPAID: { label: "Unpaid", variant: "outline" },
  PART_PAID: { label: "Part paid", variant: "warning" },
  PAID: { label: "Paid", variant: "success" },
  OVERDUE: { label: "Overdue", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
};

export function BillStateBadge({ state }: { state: BillState }) {
  return <Badge variant={BILL[state].variant}>{BILL[state].label}</Badge>;
}

export function PurchasingTabs() {
  return (
    <div className="pt-6">
      <Tabs
        label="Purchasing"
        items={[
          { href: "/purchase-orders", label: "Purchase orders" },
          { href: "/goods-received", label: "Goods received" },
        ]}
      />
    </div>
  );
}

export function PayablesTabs() {
  return (
    <div className="pt-6">
      <Tabs
        label="Payables"
        items={[
          { href: "/supplier-bills", label: "Supplier bills" },
          { href: "/supplier-payments", label: "Supplier payments", exact: true },
          { href: "/supplier-payments/owed", label: "What we owe" },
        ]}
      />
    </div>
  );
}
