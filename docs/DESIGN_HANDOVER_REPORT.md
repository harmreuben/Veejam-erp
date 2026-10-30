# Design handover: integration report (October 2026)

Integration of `veejam-erp---enterprise-distribution-&-financial-ui.zip` into the
VeeJam ERP, following the "Claude engineering execution handover".

## 1. The archive

- Received as a chat attachment (2.69 MB, 60 files) and unpacked into a
  separate inspection folder. Paths were checked before extraction; nothing was
  unpacked over the project.
- **What it is:** a Google AI Studio export: a Vite + React 19 single-page
  mock-up. One `App.tsx` switches between 29 screens; every data screen
  reads a hard-coded `src/data/mockData.ts`. There is no database, server,
  authentication or saving.
- Its `package.json` does not install as shipped (`npm install` fails with
  ERESOLVE: vite 8 vs esbuild 0.25). It builds with `--legacy-peer-deps`, which
  was done in isolation only, to screenshot the design.

## 2. What was taken from it

The **visual design**, rebuilt inside the existing Next.js app:

- Palette: navy `#142B4A`, blue `#2463A6`, teal `#16A6A1`, background
  `#F5F7FA`, borders `#E3E8EF`, success/warning/danger fills, WhatsApp greens.
- Typography: Inter for text, JetBrains Mono for money and numeric columns
  (self-hosted with `@fontsource`, no Google Fonts request).
- Shell: navy sidebar grouped into sections with icons; the current page in blue;
  breadcrumbs above every page title.
- Tables: uppercase header band, monospaced right-aligned figures.
- The A4 tax-invoice layout (navy title badge, line table, totals, payment box).

## 3. What was left out, and why

| Excluded                                                                  | Reason                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/mockData.ts` and all figures on the screens                     | Invented business data: revenue figures, real Kenyan retailers (Naivas, Quickmart, Carrefour, Chandarana) with made-up KRA PINs and invoices, a bank account number, SWIFT code, M-Pesa paybill and VAT number that are not VeeJam's. The handover forbids inventing business data. |
| `wanjiru_venus_profile_*.jpg`                                             | An AI-generated face presented as the Managing Director, a real person.                                                                                                                                                                                                             |
| `wrigley_products_display_*.jpg`                                          | AI-generated packaging with garbled trademarks ("WDIGLEY'S").                                                                                                                                                                                                                       |
| `veejam_distribution_depot_*.jpg`                                         | Not used by any screen we kept.                                                                                                                                                                                                                                                     |
| The 29 `*Screen.tsx` files, `App.tsx`, `Sidebar.tsx`, `TopNav.tsx`        | They are bound to the mock data and a single-page screen switcher; the app already has real, database-backed pages for these, which the handover requires us to keep. Their layouts were used as the design reference.                                                              |
| Desktop/Tablet/Mobile switcher, "Design Tokens" panel, "Screen #N" labels | Design-tool controls, not app features.                                                                                                                                                                                                                                             |
| "eTIMS Online" badge                                                      | eTIMS is not integrated yet; the badge would be false.                                                                                                                                                                                                                              |
| Customer-facing WhatsApp bot conversations                                | The handover allows only the owner's number to run commands; the desk stays owner-only.                                                                                                                                                                                             |
| `@google/genai`, `express`, `dotenv`, `GEMINI_API_KEY`, `vite.config.ts`  | AI Studio scaffolding, unused by the design.                                                                                                                                                                                                                                        |

## 4. Changes to the project

**Dependencies:** added `@fontsource-variable/inter`,
`@fontsource-variable/jetbrains-mono`; removed `@fontsource-variable/public-sans`.
Nothing else changed. No database or schema changes in this work.

**Styling** (`src/app/globals.css`): new light and dark token sets. Handover
hexes are used for surfaces and fills. For text, deeper shades of the same hues
keep small text at 4.5:1 or better: the handover's secondary text `#748094` is
only 3.99:1 on white, so muted text is `#5F6B7E`. Links are `text-link` (blue);
main buttons are navy. A4 `@page` and print rules.

**Shared components:** `Page` (handover wrapper: `px-4 sm:px-6 lg:px-8`,
`max-w-[1600px]` for lists and reports; a minmax grid so wide tables scroll
instead of widening the page), `PageHeader` with `Breadcrumbs`, `Table` (header
band, contained scroll box, empty states that stay in view on phones), sidebar
and nav link. The green VJ logo is kept on its own tile, as chosen by the owner.

## 5. The 29 screens

| #   | Screen                  | Route                                              | Status                                                                                       |
| --- | ----------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Main ERP dashboard      | `/dashboard`                                       | Existing, restyled                                                                           |
| 2   | Product catalogue       | `/products`                                        | Existing, restyled                                                                           |
| 3   | Product details         | `/products/[id]`                                   | Existing, restyled                                                                           |
| 4   | Customer management     | `/customers`                                       | Existing, restyled                                                                           |
| 5   | Customer profile        | `/customers/[id]`                                  | Existing, restyled                                                                           |
| 6   | Supplier management     | `/suppliers`                                       | Existing, restyled                                                                           |
| 7   | Inventory overview      | `/inventory`                                       | Existing, restyled                                                                           |
| 8   | Warehouse management    | `/inventory/warehouses`                            | Existing, restyled                                                                           |
| 9   | Stock movement          | `/inventory/movements` (+ transfers)               | Existing, restyled                                                                           |
| 10  | Quotations              | `/quotations`                                      | Existing, restyled                                                                           |
| 11  | Sales orders            | `/sales-orders`                                    | Existing, restyled                                                                           |
| 12  | Invoice listing         | `/invoices`                                        | Existing, restyled                                                                           |
| 13  | Invoice creation        | `/invoices/new`, `/invoices/batch`                 | Existing, restyled                                                                           |
| 14  | Invoice preview (A4)    | `/documents/[id]/preview`                          | **New**: from the same data as the PDF; prints A4 without menus; fits phones                 |
| 15  | Payment management      | `/payments`                                        | Existing, restyled                                                                           |
| 16  | Payment receipts        | `/payments`, `/payments/[id]`                      | Existing; **added** a receipt PDF link on every row                                          |
| 17  | Credit notes            | `/credit-notes`                                    | Existing (incl. owner/admin edit and delete)                                                 |
| 18  | Sales returns           | `/sales-returns`                                   | **New**: credit notes whose goods came back into stock                                       |
| 19  | General ledger          | `/accounting/journal`, `/accounting/accounts/[id]` | Existing, restyled                                                                           |
| 20  | Chart of accounts       | `/accounting/accounts`                             | **New page**: grouped by type, with balances                                                 |
| 21  | Trial balance           | `/accounting`                                      | Existing, restyled                                                                           |
| 22  | Profit and loss         | `/reports/profit`                                  | Existing, restyled                                                                           |
| 23  | Financial reports       | `/reports`                                         | Existing, restyled                                                                           |
| 24  | WhatsApp assistant desk | `/whatsapp`, `/whatsapp/log`                       | Existing (owner-only simulator and log)                                                      |
| 25  | WhatsApp settings       | `/whatsapp/number`                                 | **Expanded**: connection, activity, set/not-set server settings (never values), safety rules |
| 26  | User management         | `/settings/users`                                  | Existing, moved onto the shared page frame                                                   |
| 27  | Roles and permissions   | `/settings/roles`                                  | **New**: read-only matrix from the rules the app enforces                                    |
| 28  | Audit logs              | `/audit`                                           | Existing, restyled                                                                           |
| 29  | Company settings        | `/settings/company`                                | Existing, moved onto the shared page frame                                                   |

Every screen is in the menu or one click from a list. No placeholder pages.

## 6. Verification

- `npm run check` (TypeScript, ESLint, unit tests): passes, 106 tests.
- `npm run test:db` (database integration): 209 tests pass, including the new
  sales-returns test.
- Playwright (desktop + Pixel 7): 67 pass, including `screens.spec.ts`, which
  opens all 29 screens and checks that the A4 preview prints without menus,
  plus a test that every menu link opens a page.
- `next build`: compiles.
- Viewport scan of 38 pages at 390, 1024 and 1440 px: no sideways page scroll
  (wide tables scroll inside their own box).

## 7. Outstanding

- **eTIMS reference** (`KRA-ETIMS-VEEJAM-0112`): there is no field for it yet.
  It belongs with the eTIMS integration (needs KRA OSCU approval) and a schema
  change, so it was not added silently.
- **Company details** from the handover are entered by the owner in Company
  settings, not stored in code or Git.
- **Managing Director:** her user account name should be set to Venus Wanjiru
  under Users & roles.
- **Live WhatsApp** needs the Meta account values set in Vercel; until then the
  app runs in test mode.
- The sidebar sections are not collapsible (the mock-up's chevrons); not needed
  at the current number of pages.

## 8. Running it locally

```powershell
cd C:\Projects\veejam-erp2
npm install
npm run dev
```
