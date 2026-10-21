# ERP workflows

> Phase 1: agreed workflow design. Each section is filled in with exact screens and rules as its phase is built.

## Sales cycle

```
Customer → Quotation → Sales order → Stock reservation → Invoice → Payment → Receipt → Delivery → Reconciliation
```

Authorised users choose, per transaction type, which steps are mandatory. Typical configurations:

| Transaction type        | Steps                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| Cash sale at counter    | Invoice (posted) → Payment → Receipt → Delivery                      |
| Credit sale to retailer | Sales order → Reservation → Invoice → Delivery → Payment later       |
| Large wholesale order   | Quotation → Sales order → Reservation → Invoice → Delivery → Payment |

## Units, packs and cartons

Each SKU defines `unitsPerPack` and `packsPerCarton`. Stock is held in pieces. Example (illustrative numbers only, not real product data): if a pack holds 10 pieces and a carton holds 20 packs, selling 2 cartons deducts 2 × 20 × 10 = 400 pieces. Conversion happens once, on the server; fractional pieces are rejected.

## Document life cycle

| Status                          | Editable                                                    | Affects stock                    | Affects ledger |
| ------------------------------- | ----------------------------------------------------------- | -------------------------------- | -------------- |
| Draft                           | Yes                                                         | No (reservation only for orders) | No             |
| Posted                          | No                                                          | Yes                              | Yes            |
| Partially paid / Paid / Overdue | No (derived from allocations and due date)                  | —                                | —              |
| Cancelled                       | No — done by a reversing document, with reason and approver | Reversed                         | Reversed       |

## Payments

Payments are recorded by an authorised user after verification (e.g. checking the M-Pesa statement). A WhatsApp message saying "customer paid" is never treated as proof. One payment may be split across several invoices; overpayments stay as unallocated customer credit. Automatic M-Pesa reconciliation is a future integration and is not claimed until built and tested.

## Accounting postings (outline, finalised in Phase 5)

| Event                        | Debit                       | Credit                                 |
| ---------------------------- | --------------------------- | -------------------------------------- |
| Invoice posted               | Accounts receivable (gross) | Sales revenue (net), VAT payable (tax) |
| Stock issued on invoice      | Cost of goods sold          | Inventory                              |
| Payment received             | Cash / Bank / M-Pesa        | Accounts receivable                    |
| Credit note                  | Sales returns, VAT payable  | Accounts receivable                    |
| Returned stock               | Inventory                   | Cost of goods sold                     |
| Goods received from supplier | Inventory, VAT input        | Accounts payable                       |

Tax rates are configuration, not code. Rates must be confirmed against current KRA requirements before production use; reports are management reports, not tax filings.

## WhatsApp owner commands (Phase 6)

Read-only commands answer immediately: `STOCK`, `PRICE`, `PRODUCT SEARCH`, `CUSTOMER SEARCH`, `CUSTOMER BALANCE`, `SALES TODAY`, `SALES MONTH`, `LOW STOCK`, `INVOICE <no>`, `STATEMENT <customer>`.

Commands that change data follow: identify owner → parse → validate → fetch authoritative data → create draft → send summary → wait for explicit confirmation → revalidate → commit in one transaction → reply with reference → audit. Confirmations expire and are bound to the owner, the action and the draft version.
