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

| Folder (`src/server/modules/`) | Responsibility                                                    | Phase |
| ------------------------------ | ----------------------------------------------------------------- | ----- |
| `settings`                     | Company profile, document numbering, workflow switches            | 2     |
| `catalogue`                    | Products, SKUs, unit/pack/carton conversions, imports             | 3     |
| `customers`                    | Customers, credit limits, statements                              | 3     |
| `suppliers`                    | Suppliers, purchase orders, goods received                        | 3     |
| `inventory`                    | Warehouses, stock ledger, transfers, adjustments, counts, batches | 3     |
| `quotations`                   | Quotes                                                            | 4     |
| `sales-orders`                 | Orders, reservations, backorders                                  | 4     |
| `invoicing`                    | Draft → posted invoices, PDFs, secure share links                 | 4     |
| `delivery`                     | Dispatch and delivery notes                                       | 4     |
| `payments`                     | Payments, allocations, receipts, reversals                        | 5     |
| `returns`                      | Sales returns, credit notes                                       | 5     |
| `accounting`                   | Chart of accounts, journal, ledger, posting rules, periods        | 5     |
| `tax`                          | Configurable tax codes and rates                                  | 5     |
| `reports`                      | Dashboard metrics, financial statements, exports                  | 8     |
| `server/whatsapp`              | Provider interface, mock + Meta providers, parser, confirmations  | 6–7   |
| `server/audit`                 | Append-only audit log                                             | 2+    |
| `server/auth`                  | Session lookup, role/permission checks                            | 2     |

## Key decisions

**Money.** All amounts use `decimal.js` (app) and Postgres `NUMERIC(18,2)` (database). JavaScript `number` is never used for money. Rounding: half-up to 2 decimals, applied per line then on totals — to be confirmed with the accountant.

**Quantities.** Stock is stored in the smallest sellable unit (pieces) as an integer. Packs and cartons are conversions defined per SKU (`unitsPerPack`, `packsPerCarton`). A sale of "2 cartons" is converted to pieces exactly once, on the server.

**Stock ledger, not a stock counter.** Every movement is an immutable row (source document, warehouse, quantity, user, time). On-hand quantity is derived from (and cached alongside) the ledger. Corrections are new movements, never edits.

**Documents have two lives.** Drafts can be edited freely. Posting (invoice, receipt, credit note) is a single database transaction that assigns the number, writes stock movements and journal entries, and writes the audit record. Posted documents are corrected only by reversing documents.

**Idempotency.** Every external input that can cause a write (WhatsApp webhook events, form submissions that post documents) carries an idempotency key stored with a unique constraint, so retries cannot double-post.

**Concurrency.** Stock reservation and invoice posting lock the affected stock rows (`SELECT … FOR UPDATE` via Prisma interactive transactions) so two simultaneous sales cannot oversell.

**Configuration.** Environment variables are validated at startup by `src/config/env.ts`. Company details start in `src/config/company.ts` and move to the `CompanySettings` table in Phase 2, editable from the Settings page.

**Rendering.** Next.js 16 with Cache Components enabled. Pages that show live business data read it at request time; nothing financial is served from a build-time cache.

**No Docker, no extra services.** Supabase provides Postgres and Auth; Vercel hosts the app and webhook endpoint.

## Request flow example (Phase 4+): posting an invoice

1. Route/server action verifies the session and the `invoice.post` permission.
2. Input parsed with Zod (only the invoice ID and idempotency key — no totals).
3. `invoicing.service.post()` opens a transaction: locks the draft, recalculates every line from catalogue prices and tax codes, checks stock and the customer's credit limit, assigns the next invoice number, writes stock movements, writes balanced journal lines, writes the audit row, commits.
4. Response returns the posted invoice; the PDF is generated on demand from posted data.
