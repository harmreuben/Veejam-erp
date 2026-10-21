# ERP workflows

> Agreed workflow design. Each section is filled in with exact screens and rules as its phase is built (Phases 3–4 so far).

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
   - **Invoices** (Phase 4) and returns (Phase 5).

Nothing posted can be edited or deleted. A mistake is corrected by another adjustment, so the history always shows what happened and who did it.

## Customers (Phase 3)

- Every customer gets an account number (CUS-000001…).
- Phone numbers are stored in one form (`2547…`), so the same customer can be matched from M-Pesa and WhatsApp later. Placeholders like "0700" are refused: leave the phone blank if it isn't known.
- Adding a customer whose name matches an existing one (ignoring case, spaces and punctuation) asks you to confirm it's a different business. This stops the duplicates the old system had.
- Sales staff can add and edit customers, but only an owner, administrator or accountant can give credit or payment terms.

## Selling (Phase 4)

```
Quotation ──► Sales order ──confirm──► stock reserved ──► Invoice (draft) ──post──► INV-number, stock out ──► Delivery note
     └───────────────────────────────────────────────► Invoice (draft)   (a quote can skip the order)
```

Any step can be skipped: a counter sale is just **Invoices → New invoice → Post**.

**Prices.** Lines are priced on the server from the customer's price list, falling back to the default list. Nobody types a price. Prices on the Standard list include VAT (the old system's habit). Each line shows the unit sold (carton/pack/piece) and the pieces it takes from stock.

- A quotation's prices are kept when it is converted, while it is still valid (its "valid until" date).
- A confirmed order's prices are kept on its invoice.
- Otherwise, every save and the posting itself re-price the draft. If a price or tax rate changed since the draft was saved, posting stops, the draft is updated, and you check it and post again. Nobody posts a total they haven't seen.

**Discounts** (percentage per line) can only be given by an owner or administrator. Sales staff can keep a discount already on a draft, but not add or raise one.

**VAT.** Settings → Tax rates holds the rate for each tax category (standard 16%, zero-rated 0%, exempt 0%). Each product has a category. Inclusive prices: VAT = gross × 16 ÷ 116, rounded to the cent per line. A rate change reaches drafts on their next save; posted invoices keep their rate. **Confirm the rates with the accountant.**

**Quotations:** Draft → Sent → Accepted/Declined → Converted (or Cancelled). Editable until accepted. Numbers QUO-000001…

**Sales orders:** Draft → Confirmed → Invoiced (or Cancelled). Confirming **reserves** the stock in the chosen warehouse: other invoices and transfers can only use what's left over. Adjustments and counts still record what physically happened. Cancelling a confirmed order releases its reservation. Numbers SO-000001…

**Invoices:**

| Status | Number      | Editable                         | Stock     |
| ------ | ----------- | -------------------------------- | --------- |
| Draft  | none        | yes (or cancel)                  | untouched |
| Posted | INV-000001… | **never** (the database refuses) | taken out |

Posting happens in one transaction: lock the draft, re-price, check stock (minus other orders' reservations) and credit, give the next number, set today's date and the due date (customer's payment terms), take the stock out, and freeze the company and customer details for reprints. A failed posting uses no number, so invoice numbers have no gaps. Clicking Post twice posts once. Mistakes on a posted invoice are corrected with a credit note (Phase 5).

**Credit check at posting** (all posted invoices count as unpaid until payments arrive in Phase 5):

- Credit limit above 0: what the customer owes plus this invoice must stay within the limit.
- Credit limit 0 = **cash only**: the customer may not owe anything on earlier invoices.
- An owner or administrator can post anyway by giving a reason; the reason and who gave it are kept on the invoice and in the audit log.

**Delivery notes** (DN-000001…): made from a posted invoice, no prices, signature lines. Prepared → Dispatched (vehicle, driver) → Delivered (received by). Storekeepers and sales staff can do this.

**PDFs and share links.** Every document has a PDF. A share link lets a customer open one posted invoice or quotation without an account: the link is random, shown once, expires after 30 days and can be revoked. Unknown, expired and revoked links all show the same "no longer valid" message.

**Who can do what**

|                                          | Owner/Admin | Accountant | Sales | Storekeeper |
| ---------------------------------------- | ----------- | ---------- | ----- | ----------- |
| See quotes, orders, invoices, deliveries | ✓           | ✓          | ✓     | ✓           |
| Quotations, sales orders                 | ✓           |            | ✓     |             |
| Draft and post invoices                  | ✓           | ✓          | ✓     |             |
| Discounts, credit override, tax rates    | ✓           |            |       |             |
| Delivery notes                           | ✓           |            | ✓     | ✓           |
| Share links                              | ✓           | ✓          | ✓     |             |

**Not in Phase 4:** payments and receipts, credit notes and returns, accounting entries, part-deliveries and backorders (an order is invoiced in full), and KRA eTIMS. If VeeJam must issue eTIMS invoices, that needs adding to the plan (DATA_MIGRATION.md question 10).

## Units, packs and cartons

Each SKU defines `unitsPerPack` and `packsPerCarton`. Stock is held in pieces. Example (illustrative numbers only, not real product data): if a pack holds 10 pieces and a carton holds 20 packs, selling 2 cartons deducts 2 × 20 × 10 = 400 pieces. Conversion happens once, on the server; fractional pieces are rejected.

## Document life cycle

| Status                          | Editable                                                    | Affects stock                    | Affects ledger |
| ------------------------------- | ----------------------------------------------------------- | -------------------------------- | -------------- |
| Draft                           | Yes                                                         | No (reservation only for orders) | No             |
| Posted                          | No                                                          | Yes                              | Yes            |
| Partially paid / Paid / Overdue | No (derived from allocations and due date)                  | —                                | —              |
| Cancelled                       | No — done by a reversing document, with reason and approver | Reversed                         | Reversed       |

## Payments (Phase 5a)

Payments are recorded by an authorised user after verification (e.g. checking the M-Pesa statement). A WhatsApp message saying "customer paid" is never treated as proof. Automatic M-Pesa reconciliation is a future integration and is not claimed until built and tested.

1. **Payments & receipts → Record payment** (or **Record payment** on an invoice or customer). Choose the customer, amount, date, method and reference. M-Pesa codes are 10 letters/digits and can never be used twice; cheque numbers are required.
2. The payment goes to the oldest invoices first, or choose amounts per invoice. Anything left over stays as **credit on the account**, which can later be applied to another invoice from the payment or credit note page.
3. A receipt (RCT-) is numbered straight away and can be printed or downloaded as a PDF.
4. Sales staff can record payments; only accountants, admins and owners can **reverse** one (with a reason). Reversal reopens the invoices and posts a reversing journal entry — nothing is deleted.

## Credit notes (Phase 5a)

On a posted invoice, **Credit note…**: choose quantities per line (never more than was sold, less anything already credited), give a reason, and tick **put them back into stock** if the goods came back undamaged. The credit note (CN-) uses the invoice's own prices and VAT. It first reduces what the invoice still owes; any remainder becomes credit on the account.

## Statements and balances

- **Customer → Statement**: every invoice, payment and credit note with a running balance, for any date range. Old-system invoices show their original payments as "Paid in old system".
- **Customer balances**: what everyone owes, split by how overdue it is (current, 1–30, 31–60, 61–90, over 90 days past the due date).

## Accounting (Phase 5a)

- **Start the books** (owner/admin, once): posts each customer's balance from the old system (Dr receivables, Cr opening balances) and journals any invoices posted before accounting existed.
- **Trial balance**, account ledgers and the **journal** are under Accounting & ledger. Manual journal entries are for rent, wages, owner's capital and the like; they must balance and can't use Accounts receivable (that only moves through invoices, payments and credit notes).
- **Close the books** up to a date: nothing can be posted on or before it afterwards.
- Cheques post straight to Bank. Cost of goods sold and inventory value are not posted yet; they need cost prices from purchasing (Phase 5b).

## Accounting postings

| Event                        | Debit                       | Credit                                 |
| ---------------------------- | --------------------------- | -------------------------------------- |
| Invoice posted               | Accounts receivable (gross) | Sales revenue (net), VAT payable (tax) |
| Stock issued on invoice (5b) | Cost of goods sold          | Inventory                              |
| Payment received             | Cash / Bank / M-Pesa        | Accounts receivable                    |
| Credit note                  | Sales returns, VAT payable  | Accounts receivable                    |
| Returned stock (5b)          | Inventory                   | Cost of goods sold                     |
| Goods received (5b)          | Inventory, VAT input        | Accounts payable                       |
| Old-system balances          | Accounts receivable         | Opening balances                       |
| Payment reversed             | Accounts receivable         | Cash / Bank / M-Pesa                   |

Tax rates are configuration, not code. Rates must be confirmed against current KRA requirements before production use; reports are management reports, not tax filings.

## WhatsApp owner commands (Phase 6)

Read-only commands answer immediately: `STOCK`, `PRICE`, `PRODUCT SEARCH`, `CUSTOMER SEARCH`, `CUSTOMER BALANCE`, `SALES TODAY`, `SALES MONTH`, `LOW STOCK`, `INVOICE <no>`, `STATEMENT <customer>`.

Commands that change data follow: identify owner → parse → validate → fetch authoritative data → create draft → send summary → wait for explicit confirmation → revalidate → commit in one transaction → reply with reference → audit. Confirmations expire and are bound to the owner, the action and the draft version.
