# VeeJam Limited ERP

Distribution, invoicing, inventory and accounting system for **VeeJam Limited**, a Wrigley products distributor in Kenya. The business owner can also query and operate the ERP over the official WhatsApp Business Cloud API.

> **Status: Phases 1–6 and 8 done.** Selling, purchasing (orders, goods received at cost, supplier bills and payments), weighted-average stock cost with cost of goods sold, payments and double-entry accounting, WhatsApp owner commands with a built-in simulator, a dashboard and reports, an audit log viewer, security hardening and encrypted backups. The ERP installs as an app on phones and PCs. Still to come: the live Meta WhatsApp connection (7) and production go-live (9). See [Build plan](#build-plan).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui · Lucide · Recharts · Zod · decimal.js · Prisma + Supabase Postgres (Phase 2) · Supabase Auth (Phase 2) · Vitest · Playwright · Vercel.

## Requirements (Windows)

| Tool    | Version         | Check in PowerShell |
| ------- | --------------- | ------------------- |
| Node.js | 22 LTS (≥ 20.9) | `node -v`           |
| npm     | 10+             | `npm -v`            |
| Git     | any recent      | `git --version`     |
| VS Code | latest          | `code --version`    |

Install anything missing:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Microsoft.VisualStudioCode
```

Close and reopen PowerShell after installing so the new commands are found.

If PowerShell says **"running scripts is disabled on this system"** when you run `npm`, allow local scripts for your user once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## First-time setup

```powershell
# 1. Go to the project folder (adjust the path to where you extracted it)
cd C:\Projects\veejam-erp

# 2. Install dependencies (exact versions from package-lock.json)
npm ci

# 3. Create your local environment file, then fill it in (docs/DEPLOYMENT.md)
Copy-Item .env.example .env.local

# 4. Install the browser used by end-to-end tests (one time)
npx playwright install chromium

# 5. Open in VS Code (accept the recommended extensions prompt)
code .
```

## Everyday commands

| Command                                                   | What it does                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                                             | Start the app at http://localhost:3000                                 |
| `npm run check`                                           | Type check + lint + unit tests (run before every commit)               |
| `npm run typecheck`                                       | TypeScript strict checks only                                          |
| `npm run lint`                                            | ESLint                                                                 |
| `npm test`                                                | Unit and integration tests (Vitest)                                    |
| `npm run test:e2e`                                        | End-to-end browser tests (Playwright; builds the app)                  |
| `npm run format`                                          | Format all files with Prettier                                         |
| `npm run build`                                           | Production build                                                       |
| `npm run test:db`                                         | Database integration tests (needs local Postgres, see docs/TESTING.md) |
| `npm run db:migrate`                                      | Apply new database migrations                                          |
| `npm run db:status` / `db:drift`                          | Check migrations are applied and match the schema                      |
| `npm run db:seed`                                         | Create company settings and numbering if missing (safe to repeat)      |
| `npm run user:grant -- --email … --name "…" --role OWNER` | Give a Supabase account ERP access (first owner)                       |
| `npm run legacy:stage`                                    | Store the old system's CSV exports for the Phase 3 import              |
| `npm run backup`                                          | Encrypted backup of the whole database (needs BACKUP_PASSPHRASE)       |
| `npm run backup:restore -- --file … --to … --migrate`     | Restore a backup into an empty database and verify it (the drill)      |
| `npm run audit:deps`                                      | Check production dependencies for known vulnerabilities                |

Health check while the app runs: http://localhost:3000/api/health

## Project layout

```
src/
  app/                 Routes (pages + API route handlers)
  components/ui/       shadcn/ui primitives
  components/layout/   App shell (sidebar)
  config/              Validated env, company profile defaults, module registry
  lib/                 Pure helpers (money arithmetic, class names)
  server/              Server-only code
    db/                Prisma client (Phase 2)
    auth/              Session + role checks (Phase 2)
    audit/             Audit log writer
    whatsapp/          Provider abstraction, parser, webhook (Phases 6–7)
    modules/<module>/  service.ts, repository.ts, schemas.ts per business module
prisma/                Schema, migrations, seed (Phase 2)
tests/unit|integration|e2e
docs/                  Architecture, schema, workflows, security, deployment, testing
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [ERP workflows](docs/ERP_WORKFLOWS.md)
- [WhatsApp setup](docs/WHATSAPP_SETUP.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Legacy data migration](docs/DATA_MIGRATION.md)

## Build plan

| Phase | Scope                                                   | Status |
| ----- | ------------------------------------------------------- | ------ |
| 1     | Foundation, tooling, docs, env template                 | Done   |
| 2     | Supabase, Prisma schema, migrations, auth, roles, seed  | Done   |
| 3     | Customers, products/SKUs, imports, pricing, inventory   | Done   |
| 4     | Quotations, sales orders, invoices, PDFs, stock posting | Done   |
| 5     | Payments, receipts, double-entry accounting; purchasing | Done   |
| 6     | WhatsApp mock provider, command parser, confirmations   | Done   |
| 7     | Meta Cloud API on a test number with verified webhook   |        |
| 8     | Reports, audit tools, security hardening, backups       | Done   |
| 9     | Production deployment and full workflow test            |        |

## Ground rules

- No secrets in Git. Real values live only in `.env.local` (local) and Vercel environment settings (production).
- Money is never calculated with JavaScript `number`; use `src/lib/money.ts`.
- Totals are always recalculated on the server; client or WhatsApp totals are ignored.
- Product data is never invented. The catalogue is loaded from verified supplier data via import.
