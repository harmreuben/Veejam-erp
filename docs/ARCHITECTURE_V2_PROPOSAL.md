# VeeJam v2: two-user business and funds tracker (proposal)

Status: **approved 31 Oct 2026** with these decisions:

- **Remove** quotations, sales orders, deliveries, purchase orders, goods received and
  supplier bills (screens and code). Their database tables and records stay
  untouched, for history. Stock comes in through a new **Stock purchase** screen
  (§3.1).
- **Windows:** the installed PWA from Edge. No separate installer.
- **Two-step sign-in:** required for both users.
- **Demo data:** a separate demo site and database only.
Supersedes the 29-screen enterprise scope (see DESIGN_HANDOVER_REPORT.md).

## 1. What already exists (inspection, 31 Oct 2026)

The current app (Next.js 16, Prisma 7, Supabase Postgres and Auth, Vercel) already
has the hard parts the directive needs. All of it is tested: 106 unit, 209 database
and 67 browser tests.

| Directive need | Today |
|---|---|
| One backend, one Postgres database | Yes: Supabase Postgres, one schema, migrations. |
| Web + installable Android | Yes: PWA with manifest, icons and install prompt (installs on Android and on Windows via Edge/Chrome). |
| Double-entry books | Yes: append-only journal (database triggers refuse edits and deletes; every entry must balance). |
| Cash / M-Pesa / Bank accounts | Yes: accounts 1000, 1010, 1020. Every customer and supplier payment already posts to one of them by method. |
| Owner capital / drawings | Accounts exist (3100, 3200), but only reachable by a manual journal entry. |
| Opening balances | Customers' old balances only (account 3000). No opening balance for Cash, M-Pesa or Bank. |
| Expenses | Expense accounts exist (6000–6900); only reachable by a manual journal entry. **No Expenses screen.** |
| Transfers between accounts | **None.** |
| Reconciliation adjustments | **None.** |
| Inventory and cost of goods sold | Yes: weighted-average cost; stock bought goes to Inventory, and its cost moves to COGS only when sold, so purchases are never counted twice. |
| Sales, invoices, payments, credit notes | Yes, with per-invoice balances, statements and ageing. |
| Profit and loss, trial balance | Yes (reports). |
| Users | Five roles with per-person duties: more than two people need. |
| Audit log | Yes: every change, with who, when and why. |
| Backups | Yes: encrypted backup and verified restore. |
| WhatsApp | Yes: Meta Cloud API, owner number only, confirmation before money or stock changes, mock provider. |
| Offline | Only an "offline" page. **No IndexedDB, no cached data.** |
| Windows desktop | Only as an installed PWA. |

## 2. Principles

1. **One source of truth.** Every Cash, M-Pesa and Bank balance is the sum of its
   journal lines. No balance is stored, so none can be silently changed; a mistake
   is corrected by a new, dated, explained entry.
2. **Each money event is one typed record** (capital, withdrawal, expense,
   transfer, opening balance, adjustment, collection, supplier payment) that
   always names its account and posts its own journal entry in the same
   transaction.
3. **Cash position and accounting profit are shown apart**, never added together.
4. **Nothing financial or stock-changing is posted offline.** Offline means
   reading a snapshot and keeping drafts.
5. **Keep working code; fold, don't delete.** Existing modules are grouped under
   the 13 sections. Nothing tested is thrown away unless you choose so.

## 3. Navigation: the 13 sections

| Section | Contains (existing unless marked new) |
|---|---|
| 1. Dashboard | New period switch (day, week, month) and the cash-versus-profit panels (§5) |
| 2. Products | Products, price lists |
| 3. Inventory | Stock levels, movements, adjustments, counts, warehouses |
| 4. Customers | Customers, statements, who owes what |
| 5. Suppliers | Suppliers, **stock purchases (new)**, supplier payments, what's owed |
| 6. Sales | Sales summary (by day, customer and product), credit notes, sales returns |
| 7. Invoices | Invoices, batch invoicing, A4 preview |
| 8. Payments | Customer payments and receipts |
| 9. Expenses | **New** |
| 10. Business Funds | **New**: the three accounts, transfers, capital, withdrawals, opening balances, reconciliation |
| 11. Financial Reports | Profit and loss, sales, VAT, stock value, trial balance, chart of accounts, journal, closing the books |
| 12. WhatsApp Assistant | Simulator, message log, settings |
| 13. Settings | Company, tax rates, the two users and their security, audit log, backups, imports |

### 3.1 Stock purchase (replaces purchase orders, goods received and bills)

One form under Suppliers: supplier, date, the supplier's invoice number, lines
(product, quantity, unit, cost), and **paid now from Cash / M-Pesa / Bank** or
**on credit**. One transaction reuses the tested postings:

- stock in at cost (weighted average): Dr Inventory, Cr Goods received not yet billed;
- the supplier's bill: Dr Goods received not yet billed (and VAT recoverable), Cr Payables;
- if paid now, the supplier payment: Dr Payables, Cr the chosen account.

The net effect is Dr Inventory, Cr Cash/M-Pesa/Bank (or Payables). It is never
an expense: the cost reaches profit only as COGS when the stock is sold.

## 4. Money model

### 4.1 Classifications and their journal entries

| Classification | Debit | Credit | Revenue? | Expense? |
|---|---|---|---|---|
| Owner capital contribution | Cash / M-Pesa / Bank | 3100 Owner's capital | No | No |
| Owner withdrawal | 3200 Owner's drawings | Cash / M-Pesa / Bank | No | No |
| Customer collection | Cash / M-Pesa / Bank | 1100 Receivables | No (the sale was revenue) | No |
| Supplier payment | 2000 Payables | Cash / M-Pesa / Bank | No | No (stock is an asset) |
| Operating expense | 6xxx expense | Cash / M-Pesa / Bank | No | Yes |
| Account transfer | To-account | From-account | No | No |
| Sales revenue | 1100 Receivables | 4000 Sales, VAT | Yes | No |
| Cost of goods sold | 5000 COGS | 1200 Inventory | No | Yes (at sale) |
| Opening balance | Cash / M-Pesa / Bank | 3000 Opening balances | No | No |
| Reconciliation adjustment | Account or 6950 | 6950 or account | No | Yes/No, shown separately |

New accounts: **6950 Reconciliation differences** (expense) and **6500 Business
expenses** categories as needed. All others exist.

### 4.2 New table: `fund_transactions`

One row per money event that isn't a customer payment or supplier payment (those
already have their own tables): `kind` (CAPITAL, WITHDRAWAL, EXPENSE, TRANSFER,
OPENING, ADJUSTMENT), date, amount (> 0), `account` (CASH, MPESA, BANK),
`to_account` (transfers only, must differ), expense category, payee, reference
(e.g. M-Pesa code, unique per account), note (required for withdrawals and
adjustments), receipt photo (optional), who, when, idempotency key, and its
journal entry. Mistakes are **reversed** (a mirror entry), never edited, the same
way payments work today. Closed periods refuse new entries dated inside them.

### 4.3 Reconciliation

For each account: enter the actual balance (counted cash, the M-Pesa statement or
the bank statement) on a date. The app shows the book balance on that date and
the difference. Posting the difference creates an ADJUSTMENT with a required
reason. Each reconciliation is kept: date, statement balance, book balance,
difference and who did it.

### 4.4 Profit

- Revenue = sales − returns (excluding VAT)
- Gross profit = revenue − COGS
- Net profit = gross profit − operating expenses (6xxx, incl. stock losses and reconciliation differences)

Capital, withdrawals, transfers, collections and supplier payments never touch
profit. Stock purchases enter Inventory and reach profit only as COGS when sold.

## 5. Dashboard

A period switch (Today / This week / This month, plus a custom range), two clearly
headed panels, and a footnote explaining the difference:

- **Cash position (now):** Cash, M-Pesa and Bank balances, and their combined
  total; money collected in the period; owner contributions and withdrawals in the
  period; outstanding customer balances (marked "owed to us, not cash").
- **Profit (for the period):** total sales, COGS, gross profit, operating
  expenses, net profit, inventory value at cost.

Every figure links to the list it comes from. Each is covered by a database test
that checks it against the journal and the trial balance.

## 6. Users and security

- **Exactly two accounts:** Venus Wanjiru (Owner) and Reuben Maina (Administrator).
  The service refuses a third active user. The staff-management screens (add
  staff, roles table, per-person duties) are hidden, and their code stays
  dormant. No public sign-up (already none).
- **Both can run all operations.** Owner-only: WhatsApp commands (Venus's number)
  and transferring ownership.
- **Account security:** existing password reset and sign-out; **add two-step
  sign-in (TOTP authenticator app, via Supabase MFA)**, required for both users;
  a list of signed-in devices with "sign out everywhere". Every action stays in
  the audit log.

## 7. Platforms and offline

- **Web:** as today.
- **Android:** the installed PWA (as today).
- **Windows:** the same PWA installed from Edge ("Install VeeJam"): a Start-menu
  app in its own window, updating itself (decided).
- **Offline (controlled):**
  - A read-only snapshot in IndexedDB, refreshed on each online visit: products
    and prices, customers and balances, stock levels, today's figures, and the
    three account balances. Shown with an "Offline: as of HH:MM" banner.
  - Drafts saved locally: new invoice, expense, payment received. They are
    marked "Not posted", and when back online each is sent to the server, which
    validates stock, prices and dates and posts it or returns it as a draft. The
    existing idempotency keys stop double posting.
  - Nothing is ever posted or counted from the device alone.

## 8. Demonstration data

No invented Wrigley SKUs, prices, suppliers, transactions or balances in the real
database. For trying the app, a **separate demo environment** (its own database,
a red "DEMO DATA, not VeeJam's books" banner on every page) seeded with clearly
fictional items ("Demo Mint Gum 10s", "Demo Shop A"). It can never be pointed at
the real database: the seed refuses unless the database name contains "demo".

## 9. Build order (each step: tests, patch, then your check)

1. Navigation consolidation into the 13 sections; remove the six modules; Stock
   purchase screen; two-user limit; hide staff screens.
2. Business Funds: `fund_transactions`, opening balances, transfers, capital,
   withdrawals, reconciliation, account balances.
3. Expenses screen (categories, receipt photo, reversal).
4. Dashboard v2 (periods, cash vs profit) and the profit report checked against the journal.
5. Two-step sign-in and device sessions.
6. WhatsApp: add read commands (balances, expenses today) and confirmed expense/transfer commands.
7. Offline snapshot and drafts (IndexedDB).
8. Windows install (PWA), plus optional Tauri.
9. Security and functional test pass; a restore drill from backup; then and only
   then a production-readiness statement.

## Scope change (31 Oct 2026)

The owner decided **not to build Expenses or Business Funds**, and to stop after
step 1. The menu has 11 sections; Payments stays as it is (customer payments and
receipts, applied to invoices, posted to Cash, M-Pesa or Bank). Sections 4.2,
4.3, 5 (cash panel), and build steps 2–9 below are **not planned**. Expenses can
still be recorded as manual journal entries under Financial Reports → Accounts
& ledger.

## Progress

- **Step 1: done (31 Oct 2026).** 13-section menu (Expenses and Business Funds
  shown as "Soon"); quotations, sales orders, deliveries, purchase orders, goods
  received and supplier-bill screens and code removed (tables and records kept;
  old links to bills open their stock purchase); Stock purchase screen; Sales
  overview; at most two active users, enforced in the user service under a lock;
  staff-duties and roles screens removed. Tests: 106 unit, 206 database, 64
  browser; viewport scan of 28 pages at 390, 1024 and 1440 px.

## 10. Not doing

Multi-branch, payroll, HR, CRM pipelines, approval workflows, more user roles,
SMS or email sending, and any customer-facing WhatsApp bot.
