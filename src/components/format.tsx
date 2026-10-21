import { Badge } from "@/components/ui/badge";
import { formatKES } from "@/lib/money";
import { formatQuantity, type PackSizes } from "@/lib/units";

const nairobi = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Nairobi",
});
const nairobiDate = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" });

export const formatDateTime = (d: Date | null | undefined) => (d ? nairobi.format(d) : "—");
export const formatDate = (d: Date | null | undefined) => (d ? nairobiDate.format(d) : "—");

export function Money({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{formatKES(value)}</span>;
}

export function Qty({ pieces, sizes }: { pieces: number; sizes: PackSizes }) {
  return <span className="tabular-nums">{formatQuantity(pieces, sizes)}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "success" | "secondary" | "warning" | "outline" }> = {
    ACTIVE: { label: "Active", variant: "success" },
    INACTIVE: { label: "Inactive", variant: "secondary" },
    DRAFT: { label: "Open", variant: "warning" },
    POSTED: { label: "Posted", variant: "success" },
    CANCELLED: { label: "Cancelled", variant: "secondary" },
    VALIDATED: { label: "Waiting for review", variant: "warning" },
    COMMITTED: { label: "Imported", variant: "success" },
  };
  const s = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
