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

## Getting started with stock (Phase 3)

1. **Products.** Add each SKU under Products (or import them under Admin → Imports). Check the pieces-per-pack and packs-per-carton against a real carton. Every other quantity depends on them.
2. **Prices.** Enter prices per piece, pack and/or carton on the default price list (Price lists → Standard prices). Create more lists (e.g. Wholesale) and assign them to customers if some customers pay different prices.
3. **Opening stock on cut-over day.** Inventory → Stock counts → Start count for each warehouse. Count the shelves in cartons, packs and loose pieces, save, then an owner or administrator posts the count. Every counted product is set to exactly what was counted. Don't type in the old system's stock figures; they were wrong (see DATA_MIGRATION.md).
4. **After that,** stock changes only through:
   - **Adjustments** (owner/admin): damaged, expired, lost/stolen, samples, found, corrections. Each reason only allows the sensible direction; corrections must be explained.
   - **Transfers**: between warehouses, e.g. loading a delivery van.
   - **Counts**: periodic re-counts; differences are recorded as count gains/losses.
   - **Invoices and returns** (from Phases 4–5).

Nothing posted can be edited or deleted. A mistake is corrected by another adjustment, so the history always shows what happened and who did it.

## Customers (Phase 3)

- Every customer gets an account number (CUS-000001…).
- Phone numbers are stored in one form (`2547…`), so the same customer can be matched from M-Pesa and WhatsApp later. Placeholders like "0700" are refused: leave the phone blank if it isn't known.
- Adding a customer whose name matches an existing one (ignoring case, spaces and punctuation) asks you to confirm it's a different business. This stops the duplicates the old system had.
- Sales staff can add and edit customers, but only an owner, administrator or accountant can give credit or payment terms.

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
