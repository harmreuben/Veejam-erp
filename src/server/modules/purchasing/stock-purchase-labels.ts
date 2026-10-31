/** Shared with the browser form (no server-only imports here). */
export const PAID_FROM = ["CREDIT", "CASH", "MPESA", "BANK"] as const;
export type PaidFrom = (typeof PAID_FROM)[number];
export const PAID_FROM_LABELS: Record<PaidFrom, string> = {
  CREDIT: "Not paid yet (owed to the supplier)",
  CASH: "Paid now from Cash",
  MPESA: "Paid now from M-Pesa",
  BANK: "Paid now from Bank",
};
