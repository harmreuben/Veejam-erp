import type { StockMovementType } from "@/generated/prisma/enums";

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  ADJUSTMENT_IN: "Adjustment in",
  ADJUSTMENT_OUT: "Adjustment out",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  COUNT_GAIN: "Count gain",
  COUNT_LOSS: "Count loss",
  SALE: "Sale",
  RETURN_IN: "Return",
};

/** Where a ledger row's source document lives in the app. */
export function sourceHref(sourceType: string, sourceId: string): string | null {
  switch (sourceType) {
    case "StockAdjustment":
      return `/inventory/adjustments/${sourceId}`;
    case "StockTransfer":
      return `/inventory/transfers/${sourceId}`;
    case "StockCount":
      return `/inventory/counts/${sourceId}`;
    case "Invoice":
      return `/invoices/${sourceId}`;
    case "CreditNote":
      return `/credit-notes/${sourceId}`;
    default:
      return null;
  }
}
