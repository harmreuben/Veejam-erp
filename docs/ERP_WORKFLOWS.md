# ERP workflows

> Agreed workflow design. Each section is filled in with exact screens and rules as its phase is built (Phases 3–4 so far).

## People, roles and duties

**Admin → Users & roles** lists everyone with access. Each person has a **role** (Owner, Administrator, Accountant, Sales, Storekeeper) that sets their starting duties. Click a name (or **Duties**) to tick or untick individual duties, for example let one salesperson give discounts, or stop another from recording payments. People marked **Customised** differ from their role.

- Changes apply on the person's next click; everyone can see their own duties under **Your account**.
- After signing in, everyone lands on the **Dashboard**: the business dashboard for owners, admins and accountants, and a personal **My sales** dashboard for sales staff. Storekeepers start on Stock levels. Clicking the company name at the top of the menu goes back there.
- **Opening or reloading the app always starts on the start page** (dashboard, My sales, or Stock levels), never on the last page someone was on. The same goes for bookmarks and links pasted from elsewhere. Moving around inside the app, Back and Forward, PDFs, CSV downloads, customer share links and password-reset links work as usual.
- **Light / Dark / System** at the bottom of the menu sets the colours on that device (System follows the phone or computer's own setting). The choice is remembered per device.
- **My sales** shows only that person's work: invoices they wrote (VAT-inclusive, less credit notes on them) today and this month against last month, money they recorded, open quotations and orders, a 30-day chart, their customers' overdue invoices to follow up, and their top customers and products. No costs, profit or company totals. Owners and admins see it as a second tab. It comes with the _See their own sales dashboard_ duty.
- Owners always have every duty. Admins can change anyone except owners; nobody can change their own.
- Running WhatsApp commands and managing users come only with a role (Owner, or Administrator for users).
- Some duties need another: ticking _Post invoices_ also ticks _Prepare draft invoices_; unticking _See quotations, orders, invoices…_ unticks everything that depends on it.
- Changing someone's role starts them again from that role's duties.
- Every change is in the audit log (who, what was added and removed).

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

Any step can be skipped: a counter sale is just **Invoices → New invoice → Post invoice**.

**Invoices post as soon as they're written.** For anyone who may post invoices (sales, accountants, admins, owners), **Post invoice** on the new-invoice form saves it, gives it the next INV- number, takes the stock out and posts it to the accounts in one step. **Invoice and post…** on a quotation or confirmed order does the same. If posting is stopped (not enough stock, prices changed), nothing is lost: the invoice is kept as a draft and the page says why, so it can be fixed and posted. A customer's credit limit never stops an invoice (see below). **Save as draft** is still there for invoices that aren't ready. Submitting the same form twice posts once.

**Batch of invoices** (Invoices → Batch of invoices): enter several customers' invoices on one page, for example a day's route, all taken from one warehouse, and post them together. Each shows its price and warns when stock left after the invoices above it won't cover it. They post one after the other; any that can't post are kept as drafts with the reason, and any that couldn't be saved (no customer, no price) stay on the page to fix. Up to 40 at a time; sending the same batch twice posts nothing twice.

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

Posting happens in one transaction: lock the draft, re-price, check stock (minus other orders' reservations), note the credit position, give the next number, set today's date and the due date (customer's payment terms), take the stock out, and freeze the company and customer details for reprints. A failed posting uses no number, so invoice numbers have no gaps. Clicking Post twice posts once. Mistakes on a posted invoice are corrected with a credit note (Phase 5).

**Credit limits warn, they never block.** Invoices are posted whatever the customer owes. When an invoice takes a customer over their limit, the draft and the post dialog say so beforehand, and the posted invoice records it ("Credit limit: Posted over the credit limit…", with who posted it), as does the audit log (filter by _Invoice posted_).

- Credit limit above 0: a warning when what the customer owes plus this invoice goes over the limit.
- Credit limit 0 = **cash only**: a warning when the customer still owes on earlier invoices.

**Delivery notes** (DN-000001…): made from a posted invoice, no prices, signature lines. Prepared → Dispatched (vehicle, driver) → Delivered (received by). Storekeepers and sales staff can do this.

**PDFs and share links.** Every document has a PDF. A share link lets a customer open one posted invoice or quotation without an account: the link is random, shown once, expires after 30 days and can be revoked. Unknown, expired and revoked links all show the same "no longer valid" message.

**Who can do what**

|                                          | Owner/Admin | Accountant | Sales | Storekeeper |
| ---------------------------------------- | ----------- | ---------- | ----- | ----------- |
| See quotes, orders, invoices, deliveries | ✓           | ✓          | ✓     | ✓           |
| Quotations, sales orders                 | ✓           |            | ✓     |             |
| Draft and post invoices                  | ✓           | ✓          | ✓     |             |
| Discounts, tax rates                     | ✓           |            |       |             |
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
- Cheques post straight to Bank.

## Deleting invoices and payments (owners and admins)

Mistakes are normally corrected with a credit note (invoices) or **Reverse** (payments). Owners and admins can also **Delete…**. That button can't be given to anyone else under Duties.

- **Deleting an invoice** undoes everything it did, dated today: stock comes back at what it cost (untick "The goods are back in stock" if they were delivered and aren't coming back: then they stay sold); sales, VAT and cost of sales are reversed in the accounts (an old-system invoice's opening balance comes off); money paid on it becomes credit on the customer's account; its delivery note, share links and the sales order it came from are cancelled. Drafts can be deleted too. An invoice with credit notes can't be deleted.
- **Deleting a payment** reverses it (the invoices it paid become unpaid again) and its M-Pesa code or cheque number can be entered again correctly. Already reversed payments can be deleted to tidy the list.
- Deleted items vanish from lists, balances, statements and reports, but are kept: Invoices → Status **Deleted**, Payments → Show **Deleted**, each with who deleted it, when and why. Invoice numbers stay with the deleted invoice, so there are no gaps. The database freezes them and refuses ever to erase them; the audit log keeps a copy of what was deleted.

## Buying stock (Phase 5b)

1. **Purchase orders** (PO-): choose the supplier, products, units and the cost per unit **excluding VAT**. Save as a draft, download the PDF to send, then **Mark as ordered**. Owners, admins and accountants.
2. **Goods received** (GRN-): when the delivery arrives, open the order → **Receive goods** and enter what actually arrived (part deliveries are fine; the order shows _Partly received_ until everything is in). Storekeepers can do this and never see costs. Owners, admins and accountants can also receive without an order. The stock goes in straight away **at the order's cost**, and the value is posted: Dr Inventory, Cr _Goods received, not yet billed_.
3. **Supplier bills** (BILL-): when the supplier's invoice comes, enter its number and tick the deliveries it covers. Change the amounts if the invoice differs; the difference goes to _Purchase price differences_. VAT goes to _VAT recoverable_. Bills can also have expense lines (transport, rent…). The same supplier invoice number can't be entered twice. A bill can be cancelled while unpaid (a reversing entry is posted).
4. **Supplier payments** (SPAY-): pay one or several bills, oldest first or chosen amounts; overpayments stay as credit with the supplier. Reversal needs a reason.
5. **Suppliers → statement** and **Supplier payments → What we owe** show balances and how overdue they are.

Orders that won't be delivered in full can be **closed**; an order with nothing received can be **cancelled**.

## Stock cost

Every product carries a **weighted-average cost per piece**, across all warehouses. Goods received at cost raise or lower the average; sales, write-offs and count losses take stock out at the average and post **cost of goods sold** (or _Stock gains and losses_); credit notes that return stock bring it back at the cost it was sold at. Transfers move stock without changing its value. Selling the last pieces takes all the remaining value, so nothing is left behind from rounding.

**Opening stock:** the old system had no cost prices, so stock already on hand is worth nothing until you set it. Reports → **Stock value** → **Change** on each product → enter the cost per piece and tick _This is opening stock_ (posts Dr Inventory, Cr Opening balances). Do this **before** receiving new deliveries of that product, otherwise its average mixes new stock with stock at no cost (the app warns when that happens). Owners and admins only.

## Accounting postings

| Event                   | Debit                                                                       | Credit                                 |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Invoice posted          | Accounts receivable (gross)                                                 | Sales revenue (net), VAT payable (tax) |
| Stock issued on invoice | Cost of goods sold                                                          | Inventory                              |
| Payment received        | Cash / Bank / M-Pesa                                                        | Accounts receivable                    |
| Credit note             | Sales returns, VAT payable                                                  | Accounts receivable                    |
| Returned stock          | Inventory                                                                   | Cost of goods sold                     |
| Goods received          | Inventory                                                                   | Goods received, not yet billed         |
| Supplier bill           | Goods received not yet billed, expenses, VAT recoverable, price differences | Accounts payable                       |
| Supplier payment        | Accounts payable                                                            | Cash / Bank / M-Pesa                   |
| Write-off / count loss  | Stock gains and losses                                                      | Inventory                              |
| Opening stock cost set  | Inventory                                                                   | Opening balances                       |
| Old-system balances     | Accounts receivable                                                         | Opening balances                       |
| Payment reversed        | Accounts receivable                                                         | Cash / Bank / M-Pesa                   |

Tax rates are configuration, not code. Rates must be confirmed against current KRA requirements before production use; reports are management reports, not tax filings.

## WhatsApp owner commands (Phase 6)

Only an **active owner** whose WhatsApp number is linked (WhatsApp commands → Your number) can run commands, and for real messages the number must also be `VEEJAM_OWNER_WHATSAPP_NUMBER`. Anyone else gets one polite refusal a day and nothing else; every message in and out is in the message log. Until the Meta Cloud API is connected (Phase 7), use the **simulator** on the WhatsApp commands page — it goes through exactly the same code.

**Look things up** (answered straight away): `SALES TODAY | YESTERDAY | WEEK | MONTH`, `PAYMENTS TODAY | WEEK | MONTH`, `STOCK <product>`, `LOW STOCK`, `PRICE <product>`, `PRODUCT <search>`, `CUSTOMER <search>`, `BALANCE <customer>`, `STATEMENT <customer>`, `OWED`, `INVOICE <number>`, `HELP`. Customers can be named by code (`CUS-000004`) or name; if a name matches several, the reply lists them instead of guessing.

**Make changes** (always confirmed):

- `PAY <customer> <amount> <CASH|MPESA|BANK|CHEQUE> [code]` — e.g. `PAY CUS-000004 3000 MPESA SJK3H7QW2P`. Applied to the oldest invoices first.
- `SELL <customer>: <qty> <ctn|pk|pc> <product>, …` — e.g. `SELL Mama Pima: 2 ctn Big G, 5 pk Doublemint`. A draft invoice is saved straight away (visible in the ERP); it is posted only on confirmation. Missing stock and credit-limit problems are warned about up front.

The reply summarises exactly what will happen and ends with **YES 482913** (a one-time code). Nothing changes until the owner replies with that code. The code works once, expires after 5 minutes, and three wrong codes cancel the request; `NO` cancels; a new request replaces an older one. On YES the ERP checks again — if the customer's balance changed or the draft was edited meanwhile, nothing is done and the reply says why. Every confirmed change is audited.

## Reports (Phase 8)

Dashboard (sales today and this month, money received, what customers owe and how much is overdue, low stock, stock at cost, a 30-day chart, top customers and products) and Reports: sales by day/month/customer/product, money received by method, VAT by month and rate, profit and loss from the ledger, and stock value. Every report downloads as CSV. Profit includes cost of goods sold at weighted-average cost; products whose opening stock has no cost yet are flagged. Owners, admins and accountants only.

## Backups (Phase 8)

`npm run backup` writes an encrypted file of every table (AES-256-GCM, key from `BACKUP_PASSPHRASE`). Take one weekly and keep a copy off the computer. Once a month run the **restore drill**: `npm run backup:restore -- --file … --to "<empty database>" --migrate` restores into a throwaway database and checks every table matches the backup exactly. The Backup & recovery page shows when each was last done and warns when overdue.
