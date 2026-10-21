# Testing

## Three levels

| Command            | What it tests                                                                                         | Needs                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm test`         | Unit tests: pure rules (permissions, money, validation, redirects)                                    | Nothing                                                   |
| `npm run test:db`  | Integration tests: services against a real Postgres built from `prisma/migrations`                    | Local Postgres, `TEST_DATABASE_URL`                       |
| `npm run test:e2e` | Browser tests: production build, real database, sign-in through a **test stand-in** for Supabase Auth | Local Postgres, `E2E_DATABASE_URL`, Playwright's Chromium |

`npm run check` = typecheck + lint + unit tests. Run it before every commit.

The test databases are **wiped on every run**. A safety check refuses any database whose name doesn't contain `test`, or that matches `DATABASE_URL`/`DIRECT_URL` in `.env.local`.

## Installing PostgreSQL on Windows (for test:db and test:e2e)

```powershell
winget install PostgreSQL.PostgreSQL.17
```

During setup, choose a password for the `postgres` user (the template assumes `postgres`; change the URLs if you pick another). Then create the two test databases:

```powershell
$env:PGPASSWORD = "postgres"
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres veejam_test
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres veejam_e2e_test
Remove-Item Env:PGPASSWORD
```

Copy `TEST_DATABASE_URL` and `E2E_DATABASE_URL` from `.env.example` into `.env.local`.

## What the browser tests do and don't prove

The browser tests sign in through `tests/e2e/support/mock-supabase-auth.mjs`, a **test-only** stand-in for Supabase Auth that implements the endpoints this app calls. Passing tests prove the app's own sign-in, session, role and deactivation logic. They do **not** prove the connection to your real Supabase project. Check that by hand after setup:

1. Sign in as the owner. You should see Setup status.
2. Add a staff user, then sign in as them in a private window.
3. Deactivate them. Their next click should return them to sign-in with "This account has been deactivated".

## Current coverage (Phase 2)

| File                                  | Checks                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit/money.test.ts`                  | Decimal-safe arithmetic, rounding, KES formatting                                                                                                                                           |
| `unit/env.test.ts`                    | Configuration validation; status never leaks secret values                                                                                                                                  |
| `unit/company.test.ts`                | Company profile validation                                                                                                                                                                  |
| `unit/health-route.test.ts`           | Health endpoint                                                                                                                                                                             |
| `unit/permissions.test.ts`            | Role → permission matrix; rules for managing users                                                                                                                                          |
| `unit/session.test.ts`                | Session states (anonymous, no access, deactivated, user); public paths; redirect safety after sign-in                                                                                       |
| `unit/audit.test.ts`                  | Secrets redacted from audit records; change diffs                                                                                                                                           |
| `unit/settings-schema.test.ts`        | KRA PIN, currency, payment terms; legacy CSV parsing                                                                                                                                        |
| `integration/schema.test.ts`          | Migrations match the Prisma schema column by column; enums; RLS on every table; audit log append-only; single settings row                                                                  |
| `integration/settings.test.ts`        | Update + audit of changed fields only; edit conflicts; role restrictions; server validation; seed is re-runnable                                                                            |
| `integration/users.test.ts`           | Granting access; role changes; admin vs owner limits; never zero owners (including two owners acting at the same moment); deactivation; adding staff with rollback; passwords never audited |
| `integration/legacy-staging.test.ts`  | Rows stored unchanged with spreadsheet row numbers; re-staging is a no-op; bad files rejected                                                                                               |
| `e2e/smoke.spec.ts` (desktop + phone) | Health and security headers; sign-in redirect and return; company details from the database; HTTP-only session cookie                                                                       |
| `e2e/auth.spec.ts`                    | Wrong password; account without access; open-redirect blocked; sales role limits                                                                                                            |
| `e2e/settings.spec.ts`                | Save and reload; server-side field errors; two people editing at once                                                                                                                       |
| `e2e/users.spec.ts`                   | Add user → sign in → change password → role change → deactivate (signed out on next click) → reactivate                                                                                     |

## Required tests by later phases

Invoice, discount and tax calculations · unit/pack/carton conversions · stock availability · concurrent sales (no overselling) · duplicate webhook delivery · unauthorised WhatsApp sender · invalid webhook signature · expired confirmation · duplicate invoice posting · partial payments · payment allocation · balanced journal entries · PDF access permissions.
