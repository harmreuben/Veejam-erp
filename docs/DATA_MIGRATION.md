# Legacy data migration

Source: nine CSV exports from VeeJam's previous system, dated 2026-10-21. Keep them in `legacy-data/` in the project folder; that folder is ignored by Git because it contains customer phone numbers.

The import is built in Phases 2–3, when the database and the import tools exist. This document records what the exports contain, what is wrong with them, and the decisions the owner must make first. **Nothing is imported until those decisions are answered.**

## What the exports contain

| File               | Rows | Covers                                                                                |
| ------------------ | ---- | ------------------------------------------------------------------------------------- |
| invoices           | 86   | 7 Jul – 5 Oct 2026 · totals KES 981,468.40 · paid 808,945.00 · outstanding 172,523.40 |
| invoice-line-items | 275  | Lines for all 86 invoices                                                             |
| payments           | 99   | KES 994,682.50 · Cash 94, M-Pesa 4, Bank transfer 1                                   |
| customers          | 44   | Names, phones, types, a few credit limits                                             |
| products-inventory | 12   | WRG-001 … WRG-012, prices, stock, reorder levels                                      |
| stock-movements    | 288  | 1 Jun – 5 Oct 2026, sales and reversals only                                          |
| commission-records | 47   | KES 21,605 pending commission                                                         |
| etims-queue        | 27   | Invoices waiting for KRA eTIMS submission                                             |
| audit-log          | 15   | Invoice edits and deletions                                                           |

All timestamps are UTC. They are shown in Nairobi time (UTC+3) after import.

## Problems found

Every figure below was produced by reconciling the files against each other.

### 1. Stock quantities can't be trusted

- 22 invoices dated 15 Aug – 12 Sep (KES 275,635) never reduced stock. If they had, Big G would stand at **−410**, which is impossible.
- 20 invoices from June and early July reduced stock but are missing from the invoice export. They include VJL-MRDQZD2C-MXT (391 units, no payment record) and VJL-1A1B2D-PQR (300 Big G).
- Working backwards from today's figures, nearly every SKU started at about 1,000 units. That looks like a placeholder, not a stock count.
- The old system has no goods-received records, so purchases were never captured.

**Plan:** do not import `stock_quantity`. Do a physical count on the cutover day and enter it as the opening balance. Keep the old movements as read-only history.

### 2. Two invoices added VAT on top of the price

84 invoices treat prices as **VAT-inclusive**: the total equals the subtotal × 1.16. Two invoices added 16% on top instead:

| Invoice                   | Customer         | Lines total | Invoice total | Overcharge if inclusive is correct |
| ------------------------- | ---------------- | ----------- | ------------- | ---------------------------------- |
| VJL-MUV7OFLC-KZ4 (5 Oct)  | Abdi Wholesalers | 68,540.00   | 79,506.40     | 10,966.40                          |
| VJL-MTY15V4S-A2A (12 Sep) | Martin Carni     | 4,950.00    | 5,742.00      | 792.00                             |

Neither invoice is paid, so the correct amount can still be fixed before it is collected.

### 3. Payments that don't match their invoices

- **Toimoiund, VJL-MRSSCE63-UJV (total 10,350):** six payments add up to **26,500**. Five of them are 4,500 each, entered within 3 minutes on 12 Sep. The invoice itself records only 8,500 paid. Some entries look like repeated clicks.
- **9 payments (KES 167,737.50) point to invoices that aren't in the export:**
  - VJL-MR4GDJNF-GA7, Johnrace, 57,420: the invoice was deleted as a "Duplicate". Its replacement, VJL-MRAH0DJP-HKE for 48,600, also has a full payment of 48,600 recorded.
  - VJL-MRBMYBUM-ALI, Johnrace, 24,750: the invoice was deleted as a "Wrong order", but the payment stayed.
  - VJL-1A1B2D-PQR, Johnrace, 51,000 bank transfer: the audit log shows this invoice was cut to 49,500 and changed from Paid to Pending. It was never deleted, but it's missing from the export.
  - VJL-1A1B2C/E/F: test invoices (one marked "Trial"), each with a cash payment recorded.
  - Three June invoices: Tg Wholesale 7,250, Soweto Supermakets 20,114.40, Coast Distributors Ltd 403.10.

**Plan:** import only payments that match a migrated invoice. Put every other payment in a review list for the owner, and post nothing from that list automatically.

### 4. Customers are duplicated

The 44 records are about 30 real customers.

- **Spelling or spacing duplicates:** Abdi Wholesalers / Abdi wholesalers; GiftMart / Giftmart; Joy Enterprise ×2; Mwana ×2; Sarah ×2; Tg Wholesale ×2 / T.G Wholesale; Martin Carni ×2 (with different phones); Toimoiund / Toimound Makina market ×2.
- **Possibly the same customer:** Julio / Julio Makina ×3 / Julio shop ×2.
- **Placeholder phone numbers:** "0700", "07" or "07000" on most records. Only six have a full number.
- **Probably demo data, never invoiced:** Nakumatt Supermarket, Tuskys Supermarket, Coast Distributors Ltd, James Kiosk (0712345678), Mama Njeri Shop (0798765432). Nakumatt and Tuskys are chains that have closed.
- **Missing details:** no customer has a KRA PIN.

**Plan:** the owner approves a merge list before import. The new system rejects placeholder phone numbers and asks for the real number the next time each customer orders.

### 5. Product data needs confirming

- Every cost price is 0, so profit and cost of goods sold can't be calculated until real costs are entered.
- Two SKU codes were reused for different products. In June, WRG-002 was called "PK 10's Spearmint" and WRG-007 was "Orbit 10's Peppermint".
- Three SKUs appear in June stock movements but not in the product list: WRG-DM-002, WRG-DM-003 and WRG-MC-002.
- The meaning of `pack_size` and `units_per_case` is unclear. For example, Big G has a pack size of 50 and a case of 30, and invoices sell 30 at a time. These need confirming against real cartons.
- Names to tidy: "Boublemint" (probably Doublemint), and backticks in place of apostrophes.

### 6. eTIMS, commissions and edited paid invoices

- **eTIMS:** every invoice charges 16% VAT, yet all 86 are "Not Submitted", and 27 sit in an eTIMS queue. eTIMS isn't in the current build plan. The owner should confirm VeeJam's VAT and eTIMS obligations with their accountant before go-live.
- **Commissions:** 47 records worth KES 21,605 are "Pending", and all of them show the invoice as Unpaid, even for invoices that were paid. The new ERP spec doesn't include commissions yet.
- **Edited paid invoices:** the audit log shows paid invoices being edited and deleted. The new system blocks this and requires credit notes. The old log will be imported as read-only history.

## Outstanding balances as exported (before any fixes)

| Customer (as in export) | Balance (KES)                            |
| ----------------------- | ---------------------------------------- |
| Abdi Wholesalers        | 79,506.40 (includes the VAT problem)     |
| Shikoh Kawangware       | 14,720.00                                |
| Julio Makina            | 12,960.00                                |
| Lasty                   | 11,900.00                                |
| Mwana                   | 11,430.00                                |
| Abdi wholesalers        | 10,800.00                                |
| Toimound Makina market  | 7,875.00                                 |
| Muthaura                | 7,110.00                                 |
| Tg Wholesale            | 7,050.00                                 |
| Martin Carni            | 5,742.00 (includes the VAT problem)      |
| Toimoiund               | 1,850.00 (but see the overpayment above) |
| Sarah                   | 1,580.00                                 |
| **Total**               | **172,523.40**                           |

## Decisions needed from the owner

1. **Cutover date:** the day the old system stops being used and the physical stock count happens.
2. **VAT on the two invoices:** were VJL-MUV7OFLC-KZ4 and VJL-MTY15V4S-A2A meant to be VAT-inclusive (68,540 and 4,950)?
3. **Toimoiund:** how much did they actually pay on VJL-MRSSCE63-UJV?
4. **Johnrace:** which payments were real money (57,420; 24,750; 51,000; 48,600)? Was anything refunded?
5. **Missing invoices:** should VJL-1A1B2D-PQR, VJL-MRDQZD2C-MXT and the June invoices be re-exported, or treated as history only?
6. **Customer merges:** approve the merge list, including whether the Julio records are one customer or two.
7. **Demo records:** may Nakumatt, Tuskys, Coast Distributors, James Kiosk and Mama Njeri Shop be deleted?
8. **Products:** cost prices, and the real units-per-pack and packs-per-carton for each SKU.
9. **Commissions:** who earns them, at what rate, and should they be added to the new system?
10. **eTIMS:** is VeeJam VAT-registered and required to use eTIMS? If so, it needs adding to the build plan.

## Running the import

1. Put the nine CSV files, plus the price list export (`price-lists-….csv`, used for prices when present), in `legacy-data/` (not in Git).
2. `npm run legacy:import` — **check only**. Writes `legacy-data/import-report.md`: every customer (with the old names merged into it), product, price and historical invoice, the totals before and after, and every problem found. Nothing is saved.
3. Read the report with the owner. Change any decision in `src/server/modules/legacy/decisions.ts` (merges, test records, corrections) and run step 2 again.
4. `npm run legacy:import -- --commit` — imports everything in one transaction, as the first active owner (or `--by email`). Running it again creates nothing twice.

What it creates:

- **Customers:** 22 (from 44 old records), each with its old spellings kept as "old names" so searches still find them. Placeholder phones are left blank. Wholesalers get the new Wholesale price list. Credit limit 0 (cash only) until the owner sets limits.
- **Products:** the 12 WRG- SKUs. The old "pack size" becomes pieces per packet and "units per case" becomes packets per carton. Old invoices sold by the packet.
- **Prices:** retail per packet on Standard prices; wholesale per packet and per carton on Wholesale prices. Existing prices are never overwritten.
- **Historical invoices:** all 86, with their original VJL- numbers, dates, lines, discounts and amounts paid. Read-only (the database refuses changes), marked "Old system", and they take **no** stock out. They count towards what each customer owes, so customers who still owe on old invoices need a payment (Phase 5) or an owner's override before a new invoice can be posted.
- **Opening stock:** from `inventory-report-….csv` when present: one opening-balance stock adjustment (ADJ-) in the main warehouse, in packets, posted once. Products that already have stock in the new system are skipped. Confirm the figures with a stock count.
- **Not imported:** the old stock movement history, commissions, the eTIMS queue, the old audit log, and payments against deleted, test or missing invoices (listed in the report).

Imported totals: invoiced KES 969,710.00, paid KES 808,945.00, outstanding **KES 160,765.00** (the old system showed 172,523.40; the difference is the two VAT-on-top invoices).

## Status (after Phase 3)

- The nine files can be stored in the database unchanged (`npm run legacy:stage`).
- Customers, products/prices and suppliers can be imported from CSV (Admin → Imports), with every row checked and reviewed before anything is saved. The importer refuses the old system's typical problems: placeholder phones, duplicate names, duplicate SKUs.
- **Still waiting on the owner's answers** (the 10 questions above) before the old invoices, payments and balances are brought across. Customers and products can be loaded now if the owner confirms the merge list and pack sizes.
- Opening stock: use a stock count on cut-over day (Inventory → Stock counts).
- Phase 4 (selling) uses prices that **include** VAT, like the old system, but works VAT out correctly. The two old invoices that added VAT on top (Abdi, Martin Carni) show the problem the new system avoids.

## How the import will work (Phases 2–3)

1. Load all nine files into **staging tables**, unchanged, for reference.
2. Validate them and generate an exceptions report covering every problem above.
3. Apply the owner's decisions: the merge map, corrected totals, and accepted or rejected payments.
4. Import customers and products, then legacy invoices. These are marked _historical_: read-only, original `VJL-` numbers kept, VAT-inclusive, and no stock movements created.
5. Import matched payments. Opening receivable balances per customer must equal the agreed outstanding totals.
6. Enter the opening stock from the physical count.
7. Run reconciliation checks. Invoice totals, payments and balances must match the agreed figures to the cent before sign-off.
8. Start new numbering (`INV-000001` …) from the cutover date.
