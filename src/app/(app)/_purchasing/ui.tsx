import { Tabs } from "@/components/tabs";
import { Badge } from "@/components/ui/badge";

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

/** The Suppliers section: suppliers, what was bought, what was paid, what's owed. */
export function SupplierTabs() {
  return (
    <div className="pt-6">
      <Tabs
        label="Suppliers"
        items={[
          { href: "/suppliers", label: "Suppliers" },
          { href: "/stock-purchases", label: "Stock purchases" },
          { href: "/supplier-payments", label: "Supplier payments", exact: true },
          { href: "/supplier-payments/owed", label: "What we owe" },
        ]}
      />
    </div>
  );
}
