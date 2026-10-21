# Security

## In place (Phase 1)

| Control                                                                                                                        | Where                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Environment validated at startup; invalid config fails fast with a clear message                                               | `src/config/env.ts`           |
| Secrets can't reach browser code (`server-only` guard; only `NEXT_PUBLIC_` Supabase URL/anon key are public)                   | `src/config/env.ts`           |
| Configuration status shown as booleans, never values (tested)                                                                  | `getConfigChecks()`           |
| `.env*` ignored by Git except the empty `.env.example`                                                                         | `.gitignore`                  |
| Security headers: `nosniff`, `X-Frame-Options: DENY`, strict referrer, restricted permissions; `X-Powered-By` removed (tested) | `next.config.ts`              |
| Health endpoint exposes no configuration (tested)                                                                              | `src/app/api/health/route.ts` |
| App pages marked `noindex`                                                                                                     | `src/app/layout.tsx`          |
| Decimal-safe money arithmetic                                                                                                  | `src/lib/money.ts`            |

## Planned

| Phase | Control                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | Supabase Auth sessions in secure, HTTP-only cookies; `proxy.ts` redirects signed-out users; every server action/route re-checks the session and permission (the proxy is not trusted alone). Roles: Owner, Admin, Accountant, Sales, Storekeeper. Session revocation. |
| 2+    | Append-only audit log for invoices, postings, stock adjustments, payments, price changes, imports, settings.                                                                                                                                                          |
| 3+    | Zod validation on every input; Prisma parameterised queries only (no string-built SQL); React output escaping (no `dangerouslySetInnerHTML` with user data).                                                                                                          |
| 4     | Invoice share links: random token stored hashed, expiry, revocable.                                                                                                                                                                                                   |
| 6–7   | Webhook HMAC-SHA256 on raw body with constant-time compare; owner allow-list; idempotency on event IDs; expiring, single-use, version-bound confirmations.                                                                                                            |
| 8     | Rate limiting on sign-in, webhook and API routes; Content-Security-Policy; dependency audit; backup and restore drill.                                                                                                                                                |

## Secret handling

- Real secrets live only in `.env.local` (your PC) and Vercel environment variables.
- Logs never contain tokens, app secrets, full phone numbers in bulk exports, or payment credentials.
- If a secret is ever committed or shared, rotate it immediately at its source (Supabase or Meta), then update `.env.local` and Vercel.

## Known items

- `npm audit` reports high-severity advisories in `braces`/`micromatch`, pulled in by `eslint-config-next`'s lint tooling. This is a development-only dependency that never runs in the deployed app. The suggested `--force` fix downgrades Next's ESLint config to v14 and is not applied. Re-check when `eslint-config-next` updates.
