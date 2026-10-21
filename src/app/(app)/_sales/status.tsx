import { Badge } from "@/components/ui/badge";
import type { SalesDocumentStatus } from "@/generated/prisma/enums";
import { STATUS_LABELS } from "@/server/modules/sales/schemas";

const VARIANT: Record<SalesDocumentStatus, "success" | "secondary" | "warning" | "outline" | "default"> = {
  DRAFT: "warning",
  SENT: "outline",
  ACCEPTED: "success",
  DECLINED: "secondary",
  CONVERTED: "secondary",
  CONFIRMED: "default",
  INVOICED: "success",
  POSTED: "success",
  CANCELLED: "secondary",
};

export function SalesStatusBadge({ status }: { status: SalesDocumentStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

const DELIVERY_VARIANT = {
  PREPARED: "warning",
  DISPATCHED: "default",
  DELIVERED: "success",
  CANCELLED: "secondary",
} as const;
const DELIVERY_LABEL = {
  PREPARED: "Prepared",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export function DeliveryStatusBadge({ status }: { status: keyof typeof DELIVERY_VARIANT }) {
  return <Badge variant={DELIVERY_VARIANT[status]}>{DELIVERY_LABEL[status]}</Badge>;
}
