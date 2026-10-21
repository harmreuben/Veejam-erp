# Testing

## Tools

- **Vitest** — unit and integration tests in `tests/unit` and `tests/integration`.
- **Playwright** — end-to-end browser tests in `tests/e2e`, run against a production build on port 3100, on a desktop and a mobile viewport.

## Commands (PowerShell)

```powershell
npm run check        # typecheck + lint + unit tests — run before every commit
npm test             # unit/integration tests once
npm run test:watch   # rerun tests as files change
npx playwright install chromium   # one time, downloads the test browser
npm run test:e2e     # builds the app, starts it, runs browser tests
npx playwright show-report        # open the last e2e HTML report
```

If you already have Chromium installed and cannot download Playwright's browser, point tests at it:

```powershell
$env:PW_CHROMIUM_PATH = "C:\path\to\chrome.exe"; npm run test:e2e
```

## Current coverage (Phase 1)

| File                              | Checks                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/money.test.ts`        | Float errors avoided, half-up rounding, line amounts, percentages, summing, invalid input, KES formatting                                 |
| `tests/unit/env.test.ts`          | Safe defaults, empty strings, Meta settings required together, provider allow-list, owner number format, status never leaks secret values |
| `tests/unit/company.test.ts`      | VeeJam details, validation of edits, Kenyan phone formats                                                                                 |
| `tests/unit/health-route.test.ts` | Health endpoint response, no caching, no config exposure                                                                                  |
| `tests/e2e/foundation.spec.ts`    | Status page content, unbuilt modules are not links, health + security headers (desktop and mobile)                                        |

## Required tests by later phases

Invoice, discount and tax calculations · unit/pack/carton conversions · stock availability · concurrent sales (no overselling) · duplicate webhook delivery · unauthorised WhatsApp sender · invalid webhook signature · expired confirmation · duplicate invoice posting · partial payments · payment allocation · balanced journal entries · audit record creation · PDF access permissions.

Integration tests that touch the database (Phase 2+) run against a separate test database, never production.
