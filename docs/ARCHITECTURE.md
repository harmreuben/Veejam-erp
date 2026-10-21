# Architecture

## Shape: a modular monolith

One Next.js application, one Postgres database, deployed as one unit on Vercel. Inside it, each business area is a module with its own folder and a strict layering rule. This keeps deployment simple for a single-company ERP while keeping the code organised enough to grow.

```
           Browser (dashboard)                 Meta WhatsApp Cloud
                  │                                    │  webhook (HTTPS, signed)
                  ▼                                    ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ Next.js app (Vercel)                                         │
   │                                                              │
   │  src/app/…            pages, server actions, route handlers  │  ← thin: auth check,
   │      │                                                       │    parse with Zod,
   │      ▼                                                       │    call a service
   │  src/server/modules/<module>/service.ts   business rules     │  ← all decisions here
   │      │                                                       │
   │      ▼                                                       │
   │  src/server/modules/<module>/repository.ts  Prisma queries   │  ← only DB access here
   │      │                                                       │
   └──────┼───────────────────────────────────────────────────────┘
          ▼
   Supabase Postgres (data)       Supabase Auth (users, sessions)
```

### Layer rules

| Layer                                  | May import                                                | Must not                                        |
| -------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `app/` (routes, pages, server actions) | services, `config`, `lib`, UI                             | query Prisma directly; contain business rules   |
| `server/modules/*/service.ts`          | own repository, other modules' **services**, `lib`, audit | read `Request`/cookies; render UI               |
| `server/modules/*/repository.ts`       | Prisma client                                             | call other repositories; contain business rules |
| `lib/`                                 | nothing app-specific                                      | import `server/` or Prisma                      |
| `components/`                          | `lib`, UI                                                 | import `server/`                                |

Both the web dashboard and the WhatsApp command handler call the **same services**. A WhatsApp order and a dashboard order go through identical validation, pricing, stock checks and accounting postings.

### Modules

| Folder (`src/server/modules/`) | Responsibility                                                             | Phase |
| ------------------------------ | -------------------------------------------------------------------------- | ----- |
| `settings`                     | Company profile, document numbering, workflow switches                     | 2     |
| `catalogue`                    | Products (SKUs), pack sizes, cost prices                                   | 3     |
| `pricing`                      | Price lists, prices per unit, price resolution for documents               | 3     |
| `customers`                    | Customers, credit limits and terms (statements in Phase 4)                 | 3     |
| `suppliers`                    | Supplier master (purchase orders and goods received in Phase 5)            | 3 / 5 |
| `inventory`                    | Warehouses, stock ledger, adjustments, transfers, counts                   | 3     |
| `imports`                      | CSV upload → validate → review → commit for customers, products, suppliers | 3     |
| `quotations`                   | Quotes                                                                     | 4     |
| `sales-orders`                 | Orders, reservations, backorders                                           | 4     |
| `invoicing`                    | Draft → posted invoices, PDFs, secure share links                          | 4     |
| `delivery`                     | Dispatch and delivery notes                                                | 4     |
| `payments`                     | Payments, allocations, receipts, reversals                                 | 5     |
| `returns`                      | Sales returns, credit notes                                                | 5     |
| `accounting`                   | Chart of accounts, journal, ledger, posting rules, periods                 | 5     |
| `tax`                          | Configurable tax codes and rates                                           | 5     |
| `reports`                      | Dashboard metrics, financial statements, exports                           | 8     |
| `server/whatsapp`              | Provider interface, mock + Meta providers, parser, confirmations           | 6–7   |
| `server/audit`                 | Append-only audit log                                                      | 2+    |
| `server/auth`                  | Session lookup, role/permission checks                                     | 2     |

## Key decisions

**Money.** All amounts use `decimal.js` (app) and Postgres `NUMERIC(18,2)` (database). JavaScript `number` is never used for money. Rounding: half-up to 2 decimals, applied per line then on totals — to be confirmed with the accountant.

**Quantities.** Stock is stored in the smallest sellable unit (pieces) as an integer. Packs and cartons are conversions defined per SKU (`unitsPerPack`, `packsPerCarton`). A sale of "2 cartons" is converted to pieces exactly once, on the server.

**One door for stock.** `applyStockChanges()` in `server/modules/inventory/stock.ts` is the only code that changes stock. Adjustments, transfers, counts and (from Phase 4) invoices and receipts all go through it, so the locking, the no-negative rule and the ledger are written once.

**Stock ledger, not a stock counter.** Every movement is an immutable row (source document, warehouse, quantity, user, time). On-hand quantity is derived from (and cached alongside) the ledger. Corrections are new movements, never edits.

**Documents have two lives.** Drafts can be edited freely. Posting (invoice, receipt, credit note) is a single database transaction that assigns the number, writes stock movements and journal entries, and writes the audit record. Posted documents are corrected only by reversing documents.

**Idempotency.** Every external input that can cause a write (WhatsApp webhook events, form submissions that post documents) carries an idempotency key stored with a unique constraint, so retries cannot double-post.

**Concurrency.** Stock reservation and invoice posting lock the affected stock rows (`SELECT … FOR UPDATE` via Prisma interactive transactions) so two simultaneous sales cannot oversell.

**Configuration.** Environment variables are validated by `src/config/env.ts`. Company details live in the `company_settings` table (seeded from `src/config/company.ts`) and are edited on Settings → Company settings.

**Rendering.** Cache Components are **turned off** (`next.config.ts`). Every page is per-user and shows live financial data, so every page renders on each request. Nothing financial is ever served from a build-time or shared cache. Revisit only for public, non-financial pages.

**Authentication.** Supabase Auth holds the passwords; the app never stores them. On every request:

1. `src/proxy.ts` refreshes the session cookie and sends signed-out visitors to `/login`. This is a first filter only.
2. `requireUser()` (`src/server/auth/session.ts`) verifies the token with `getClaims()`, then looks up the `users` row. A Supabase account alone isn't enough: it must be linked to an **active** ERP user with a role. Deactivation therefore takes effect on the next click.
3. Every service function receives the actor and calls `authorize(actor, permission)` before doing anything (`src/server/auth/permissions.ts`).

Session cookies are HTTP-only, `SameSite=Lax`, `Secure` in production, and last 12 hours.

**No Docker, no extra services.** Supabase provides Postgres and Auth; Vercel hosts the app and webhook endpoint.

## Request flow example (Phase 4+): posting an invoice

1. Route/server action verifies the session and the `invoice.post` permission.
2. Input parsed with Zod (only the invoice ID and idempotency key — no totals).
3. `invoicing.service.post()` opens a transaction: locks the draft, recalculates every line from catalogue prices and tax codes, checks stock and the customer's credit limit, assigns the next invoice number, writes stock movements, writes balanced journal lines, writes the audit row, commits.
4. Response returns the posted invoice; the PDF is generated on demand from posted data.
