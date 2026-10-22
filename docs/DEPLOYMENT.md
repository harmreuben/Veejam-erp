# Setup and deployment

## 1. Supabase project (Phase 2, one time)

1. Sign in at **supabase.com** → **New project**.
   - Name: `veejam-erp`
   - Database password: generate a strong one and store it in a password manager. You need it for the connection strings.
   - Region: the closest available to Kenya (for example _Frankfurt_ or another European region; check the list for anything closer).
2. **Turn off public sign-up.** Staff accounts are created only by the owner.
   Authentication → **Sign In / Providers** → turn off **Allow new users to sign up**. Keep **Email** enabled.
3. **Get the database connection strings.** Click **Connect** in the top bar:
   - **Transaction pooler** (port **6543**) → `DATABASE_URL`
   - **Session pooler** (port **5432**) → `DIRECT_URL`

   Replace `[YOUR-PASSWORD]` in both. Use the session pooler rather than "Direct connection", because the direct connection needs IPv6, which many Kenyan networks don't have.

4. **Get the API keys.** Project Settings → **API Keys**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL` (looks like `https://abcdefgh.supabase.co`)
   - **Publishable** key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Secret** key (`sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY`

   Older projects show `anon` and `service_role` keys instead; they work the same way.

5. Put all five values in `.env.local`. Never paste them into chat, code or Git.
   Add `?sslmode=require&connect_timeout=30` to the end of `DIRECT_URL`.
6. **Download the database certificate.** Project Settings → **Database** → **SSL Configuration** → **Download certificate**.
   Save it as `certs\supabase-ca.crt` in the project. The app then verifies it is talking to the real database.
   This file is public, not a secret.

## 2. Create the tables and first owner (PowerShell)

```powershell
cd C:\Projects\veejam-erp

npm run db:migrate     # create the tables in Supabase
npm run db:drift       # confirm the database matches the schema (no output, exit code 0)
npm run db:seed        # company settings and document numbering
```

Create the owner's sign-in account in Supabase:
**Authentication → Users → Add user → Create new user**, enter the email and a password, and tick **Auto Confirm User**.

Then give that account the Owner role:

```powershell
npm run user:grant -- --email owner@example.com --name "Owner Name" --role OWNER
```

Start the app and sign in:

```powershell
npm run dev            # http://localhost:3000
```

From now on, add staff in the app under **Admin → Users & roles**. That page also needs `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Stage the old system's data (optional now, required before Phase 3)

Put the nine CSV exports in `legacy-data\`, then:

```powershell
npm run legacy:stage
```

This stores the files unchanged in the database. Running it again skips files already staged.

## 4. Online on Vercel

A preview deployment can go up any time to show progress; the production launch is Phase 9.
The app runs in Vercel's Dublin region (`vercel.json`), next to the Supabase database in
`eu-west-1` (Ireland), so every page avoids a round trip across the Atlantic.
Commit `certs/supabase-ca.crt` so the deployed app can verify the database too.

1. Push the repository to GitHub (private).
2. Vercel → **Add New Project** → import it. Framework: Next.js.
3. Add every variable from `.env.local` under Settings → Environment Variables, except `TEST_DATABASE_URL`, `E2E_DATABASE_URL`, `BACKUP_PASSPHRASE` and `RESTORE_DATABASE_URL` (backups run from your PC, never on Vercel). Set `APP_BASE_URL` to the Vercel URL.
4. In Supabase, Authentication → **URL Configuration** → set **Site URL** to the Vercel URL.
5. Apply migrations from your PC before each deploy that includes new ones:

   ```powershell
   npm run db:migrate
   ```

6. Deploy, then confirm `https://<your-app>/api/health` returns `{"status":"ok"}`.

## 5. Installing the ERP as an app

Once it is on Vercel (HTTPS), staff can install it like an app: its own icon, its own window, no browser bars.

- **Android (Chrome):** open the site → menu ⋮ → **Install app** (or the **Install app** link at the bottom of the menu in the ERP).
- **Windows / Mac (Chrome or Edge):** the install icon at the right of the address bar, or **Install app** in the ERP's sidebar.
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.

The app always shows live data and stores nothing on the device: the service worker (`public/sw.js`) only shows an "offline" page when there's no connection. Updates arrive with each deploy; there is nothing to reinstall. Installing doesn't work on `http://localhost` from another device, only on the HTTPS Vercel address.

## Operational checks after each deploy

- `/api/health` is OK.
- Signing in works, and signed-out visits redirect to `/login`.
- `npm run db:status` reports the database is up to date.
- The mock WhatsApp provider is **not** active in production (`WHATSAPP_PROVIDER=meta`, from Phase 7).
- The browser console shows no "Content Security Policy" errors on the dashboard.
- A backup has been taken this week (Backup & recovery page), and a restore drill this month.
