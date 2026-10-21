# Security

## In place (Phases 1–2)

| Control                                                                                                                                           | Where                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Environment validated at startup; invalid config fails fast with a clear message                                                                  | `src/config/env.ts`                     |
| Secrets can't reach browser code (`server-only` guard; only `NEXT_PUBLIC_` Supabase URL/anon key are public)                                      | `src/config/env.ts`                     |
| Configuration status shown as booleans, never values (tested)                                                                                     | `getConfigChecks()`                     |
| `.env*` ignored by Git except the empty `.env.example`                                                                                            | `.gitignore`                            |
| Security headers: `nosniff`, `X-Frame-Options: DENY`, strict referrer, restricted permissions; `X-Powered-By` removed (tested)                    | `next.config.ts`                        |
| Health endpoint exposes no configuration (tested)                                                                                                 | `src/app/api/health/route.ts`           |
| App pages marked `noindex`                                                                                                                        | `src/app/layout.tsx`                    |
| Decimal-safe money arithmetic                                                                                                                     | `src/lib/money.ts`                      |
| Sign-in through Supabase Auth; passwords never stored by the app; public sign-up turned off in Supabase                                           | `src/app/(auth)/login`                  |
| Every request: verified token **and** an active ERP user with a role; deactivation effective on the next click, plus a Supabase ban (tested)      | `src/server/auth/session.ts`            |
| Role permissions checked on the server in every service function; pages show "no access" instead of hidden data (tested)                          | `src/server/auth/permissions.ts`        |
| Session cookies HTTP-only, SameSite=Lax, Secure in production, 12-hour lifetime (tested)                                                          | `src/server/auth/cookie-options.ts`     |
| Same generic message for wrong email or wrong password; failed sign-ins audited                                                                   | `src/app/(auth)/login/actions.ts`       |
| Redirect after sign-in limited to this site's own pages (tested)                                                                                  | `safeNextPath()`                        |
| Owners can't be changed by admins; nobody changes their own role; never zero active owners, with a row lock against simultaneous changes (tested) | `src/server/modules/users/service.ts`   |
| Password change requires the current password                                                                                                     | `src/app/(app)/account`                 |
| Append-only audit log enforced by a database trigger; passwords, tokens and keys redacted before writing (tested)                                 | migration + `src/server/audit/audit.ts` |
| Row-level security on every table blocks Supabase's Data API (tested)                                                                             | `prisma/migrations/…_init`              |
| Edit conflicts detected: two people saving settings at once can't silently overwrite each other (tested)                                          | `company_settings.version`              |
| Server actions reject cross-site requests (Next.js checks the Origin header); inputs validated with Zod on the server                             | Next.js + service schemas               |

## Planned

| Phase | Control                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2+    | Append-only audit log for invoices, postings, stock adjustments, payments, price changes, imports, settings.                                                 |
| 3+    | Zod validation on every input; Prisma parameterised queries only (no string-built SQL); React output escaping (no `dangerouslySetInnerHTML` with user data). |
| 4     | Invoice share links: random token stored hashed, expiry, revocable.                                                                                          |
| 6–7   | Webhook HMAC-SHA256 on raw body with constant-time compare; owner allow-list; idempotency on event IDs; expiring, single-use, version-bound confirmations.   |
| 8     | Rate limiting on sign-in, webhook and API routes; Content-Security-Policy; dependency audit; backup and restore drill.                                       |

## Secret handling

- Real secrets live only in `.env.local` (your PC) and Vercel environment variables.
- Logs never contain tokens, app secrets, full phone numbers in bulk exports, or payment credentials.
- If a secret is ever committed or shared, rotate it immediately at its source (Supabase or Meta), then update `.env.local` and Vercel.

## Known items

- `npm audit` reports high-severity advisories in `braces`/`micromatch`, pulled in by `eslint-config-next`'s lint tooling. This is a development-only dependency that never runs in the deployed app. The suggested `--force` fix downgrades Next's ESLint config to v14 and is not applied. Re-check when `eslint-config-next` updates.
