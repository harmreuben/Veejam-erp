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

## 6. Password reset emails (one time)

Staff can reset a forgotten password themselves (**Forgot your password?** on the sign-in page), and owners/admins can send a link from **Users & roles → Reset password**. Supabase sends the email, so it needs three settings.

1. **An email service.** Supabase's built-in sender only delivers to your Supabase team's own addresses, about 2 an hour, so connect your own. Simplest: a Gmail account.
   - Turn on 2-Step Verification for that Google account, then create an **App password** (Google Account → Security → App passwords).
   - Supabase → Authentication → **Emails** → **SMTP Settings** → enable custom SMTP:
     host `smtp.gmail.com`, port `465`, username = the Gmail address, password = the app password, sender email = the same Gmail address, sender name `VeeJam Limited`.
   - (Brevo or Resend work the same way with their SMTP details, and suit higher volumes.)
   - Then Authentication → **Rate Limits**: emails per hour can stay at 30.
2. **The reset email's link.** Supabase → Authentication → **Emails** → **Templates** → **Reset Password**, and replace the link with:

   ```html
   <h2>Reset your VeeJam ERP password</h2>
   <p>Someone asked to reset the password for {{ .Email }}. If it was you, choose a new one:</p>
   <p>
     <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password"
       >Choose a new password</a
     >
   </p>
   <p>
     The link works once, for one hour. If you didn't ask, ignore this email: your password stays the same.
   </p>
   ```

   This link works on any device (the default one only works in the browser that asked).

3. **URLs.** Authentication → **URL Configuration**: Site URL `https://veejam.vercel.app` (or your own domain), and under Redirect URLs `https://veejam.vercel.app/**` and `http://localhost:3000/**`.

What the app does: the same answer whatever address is typed (it never reveals who has an account); links only for active ERP users; at most 3 emails per address an hour; the link works once, for an hour; the new-password page only opens from the link (a 15-minute, signed proof), so an unattended signed-in screen can't be used to change someone's password; after a reset every other device signed in as that person is signed out; everything is in the audit log. **Sign out** now signs out only the device you're on.

## 6. If the app feels slow

Open **Admin → Speed check** (owners and admins) on the device that feels slow. It measures the round trip from that device, where the app's server runs, each database step and the sign-in check, and says what to change. The usual fixes:

- **Server far from the database.** Vercel → Settings → Functions → Function Regions → Dublin (`dub1`), next to the Supabase database in Ireland (`vercel.json` asks for this too), then redeploy.
- **Older sign-in key (HS256).** Every click then asks Supabase over the internet. Supabase → Project Settings → JWT Keys → **Migrate JWT secret**, then **Rotate keys**. Nobody is signed out. (Don't revoke the legacy secret until at least 1 hour 15 minutes later, and only if nothing else uses it.)
- **Cold starts.** The first click after a quiet spell starts a fresh server and takes a second or two longer; later clicks are fast.
- **Connection.** Kenya to Europe is usually 150–300 ms per round trip on mobile data; a weak signal adds more.

Every signed-in page also sends a `Server-Timing` header (browser developer tools → Network → Timing) with the sign-in check's time.

## Operational checks after each deploy

- `/api/health` is OK.
- Signing in works, and signed-out visits redirect to `/login`.
- `npm run db:status` reports the database is up to date.
- The mock WhatsApp provider is **not** active in production (`WHATSAPP_PROVIDER=meta`, from Phase 7).
- The browser console shows no "Content Security Policy" errors on the dashboard.
- A backup has been taken this week (Backup & recovery page), and a restore drill this month.
