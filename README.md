# VeeJam Limited ERP

Distribution, invoicing, inventory and accounting system for **VeeJam Limited**, a Wrigley products distributor in Kenya. The business owner can also query and operate the ERP over the official WhatsApp Business Cloud API.

> **Status: Phase 1 of 9 complete — project foundation.** No business module is live yet. See [Build plan](#build-plan).

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

# 3. Create your local environment file
Copy-Item .env.example .env.local

# 4. Install the browser used by end-to-end tests (one time)
npx playwright install chromium

# 5. Open in VS Code (accept the recommended extensions prompt)
code .
```

## Everyday commands

| Command             | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Start the app at http://localhost:3000                   |
| `npm run check`     | Type check + lint + unit tests (run before every commit) |
| `npm run typecheck` | TypeScript strict checks only                            |
| `npm run lint`      | ESLint                                                   |
| `npm test`          | Unit and integration tests (Vitest)                      |
| `npm run test:e2e`  | End-to-end browser tests (Playwright; builds the app)    |
| `npm run format`    | Format all files with Prettier                           |
| `npm run build`     | Production build                                         |

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

## Build plan

| Phase | Scope                                                   | Status |
| ----- | ------------------------------------------------------- | ------ |
| 1     | Foundation, tooling, docs, env template                 | Done   |
| 2     | Supabase, Prisma schema, migrations, auth, roles, seed  | Next   |
| 3     | Customers, products/SKUs, imports, pricing, inventory   |        |
| 4     | Quotations, sales orders, invoices, PDFs, stock posting |        |
| 5     | Payments, receipts, double-entry accounting             |        |
| 6     | WhatsApp mock provider, command parser, confirmations   |        |
| 7     | Meta Cloud API on a test number with verified webhook   |        |
| 8     | Reports, audit tools, security hardening, backups       |        |
| 9     | Production deployment and full workflow test            |        |

## Ground rules

- No secrets in Git. Real values live only in `.env.local` (local) and Vercel environment settings (production).
- Money is never calculated with JavaScript `number`; use `src/lib/money.ts`.
- Totals are always recalculated on the server; client or WhatsApp totals are ignored.
- Product data is never invented. The catalogue is loaded from verified supplier data via import.
