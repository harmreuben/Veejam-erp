# Security

## In place (Phases 1–5a)

| Control                                                                                                                                                                                | Where                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Environment validated at startup; invalid config fails fast with a clear message                                                                                                       | `src/config/env.ts`                                         |
| Secrets can't reach browser code (`server-only` guard; only `NEXT_PUBLIC_` Supabase URL/anon key are public)                                                                           | `src/config/env.ts`                                         |
| Configuration status shown as booleans, never values (tested)                                                                                                                          | `getConfigChecks()`                                         |
| `.env*` ignored by Git except the empty `.env.example`                                                                                                                                 | `.gitignore`                                                |
| Security headers: `nosniff`, `X-Frame-Options: DENY`, strict referrer, restricted permissions; `X-Powered-By` removed (tested)                                                         | `next.config.ts`                                            |
| Health endpoint exposes no configuration (tested)                                                                                                                                      | `src/app/api/health/route.ts`                               |
| App pages marked `noindex`                                                                                                                                                             | `src/app/layout.tsx`                                        |
| Decimal-safe money arithmetic                                                                                                                                                          | `src/lib/money.ts`                                          |
| Sign-in through Supabase Auth; passwords never stored by the app; public sign-up turned off in Supabase                                                                                | `src/app/(auth)/login`                                      |
| Every request: verified token **and** an active ERP user with a role; deactivation effective on the next click, plus a Supabase ban (tested)                                           | `src/server/auth/session.ts`                                |
| Role permissions checked on the server in every service function; pages show "no access" instead of hidden data (tested)                                                               | `src/server/auth/permissions.ts`                            |
| Session cookies HTTP-only, SameSite=Lax, Secure in production, 12-hour lifetime (tested)                                                                                               | `src/server/auth/cookie-options.ts`                         |
| Same generic message for wrong email or wrong password; failed sign-ins audited                                                                                                        | `src/app/(auth)/login/actions.ts`                           |
| Redirect after sign-in limited to this site's own pages (tested)                                                                                                                       | `safeNextPath()`                                            |
| Owners can't be changed by admins; nobody changes their own role; never zero active owners, with a row lock against simultaneous changes (tested)                                      | `src/server/modules/users/service.ts`                       |
| Password change requires the current password                                                                                                                                          | `src/app/(app)/account`                                     |
| Append-only audit log enforced by a database trigger; passwords, tokens and keys redacted before writing (tested)                                                                      | migration + `src/server/audit/audit.ts`                     |
| Row-level security on every table blocks Supabase's Data API (tested)                                                                                                                  | `prisma/migrations/…_init`                                  |
| Edit conflicts detected: two people saving settings at once can't silently overwrite each other (tested)                                                                               | `company_settings.version`                                  |
| Database connection always encrypted (TLS); server certificate verified against Supabase's CA when `certs/supabase-ca.crt` is present (tested)                                         | `src/server/db/connection.ts`                               |
| Phase 3 roles: only owners/admins change prices, post adjustments and post counts; sales can't see cost prices or set credit; storekeepers count and transfer (tested)                 | `src/server/auth/permissions.ts`                            |
| Stock can't go negative (database check + row locks); simultaneous postings can't oversell (tested with 8 parallel attempts)                                                           | `inventory/stock.ts` + migration                            |
| Stock ledger is append-only (database trigger, tested)                                                                                                                                 | `…_catalogue_customers_inventory` migration                 |
| Double-submitted stock forms post once (idempotency keys, tested)                                                                                                                      | `inventory/documents.ts`                                    |
| CSV imports: size/row limits, header check, every row validated with the form rules, re-validated at commit, all-or-nothing (tested)                                                   | `imports/service.ts`                                        |
| Posted invoices can't be changed or deleted, nor their lines (database trigger, tested); prices, VAT and totals always worked out on the server, never taken from the browser (tested) | `…_sales_documents` migration + `sales/pricing.ts`          |
| Invoice numbers have no gaps (numbered inside the posting transaction); double-clicked posts post once (row lock, tested)                                                              | `sales/service.ts`                                          |
| Discounts, credit-limit overrides and tax rates need an owner or administrator; overrides need a reason and are audited (tested)                                                       | `sales/service.ts`, `permissions.ts`                        |
| Confirmed orders' stock can't be oversold by other invoices or transfers (reservations under the same row locks, tested)                                                               | `inventory/stock.ts`                                        |
| Share links: 256-bit random token shown once, only its SHA-256 stored, 30-day expiry, revocable, same answer for unknown/expired/revoked, `no-store` and `noindex` headers (tested)    | `sales/extras.ts`, `/d/[token]`                             |
| PDFs need a signed-in user with `sales.view`, except through a valid share link                                                                                                        | `/documents/[id]/pdf`, `/deliveries/[id]/pdf`               |
| Journal is append-only and every entry must balance, checked by the database at commit (tested); receivables can't be touched by manual journals; closed periods refuse postings       | `…_payments_accounting` migration + `accounting/journal.ts` |
| Payments: same form posts once, an M-Pesa code can't be recorded twice, allocations can't exceed what was paid or owed; only accountants and above can reverse, with a reason (tested) | `payments/service.ts`                                       |
| Credit notes can't credit more than was sold; posted credit notes are immutable like invoices (tested)                                                                                 | `sales/credit-notes.ts`                                     |
| Server actions reject cross-site requests (Next.js checks the Origin header); inputs validated with Zod on the server                                                                  | Next.js + service schemas                                   |

## Planned

| Phase | Control                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2+    | Append-only audit log for invoices, postings, stock adjustments, payments, price changes, imports, settings.                                                 |
| 3+    | Zod validation on every input; Prisma parameterised queries only (no string-built SQL); React output escaping (no `dangerouslySetInnerHTML` with user data). |
| 6–7   | Webhook HMAC-SHA256 on raw body with constant-time compare; owner allow-list; idempotency on event IDs; expiring, single-use, version-bound confirmations.   |
| 8     | Rate limiting on sign-in, webhook, share-link and API routes; Content-Security-Policy; dependency audit; backup and restore drill.                           |

## Secret handling

- Real secrets live only in `.env.local` (your PC) and Vercel environment variables.
- Logs never contain tokens, app secrets, full phone numbers in bulk exports, or payment credentials.
- If a secret is ever committed or shared, rotate it immediately at its source (Supabase or Meta), then update `.env.local` and Vercel.

## Known items

- `npm audit` reports high-severity advisories in `braces`/`micromatch`, pulled in by `eslint-config-next`'s lint tooling. This is a development-only dependency that never runs in the deployed app. The suggested `--force` fix downgrades Next's ESLint config to v14 and is not applied. Re-check when `eslint-config-next` updates.
