# Deployment

> Phase 1: plan. Production deployment happens in Phase 9; a staging deployment is used from Phase 7 for the WhatsApp webhook.

## Targets

- **Vercel** — hosts the Next.js app and the public HTTPS webhook URL.
- **Supabase** — Postgres database and authentication. Choose a region close to Kenya for lower latency.

## Steps (to be confirmed in Phase 9)

1. Push the repository to GitHub (private).
2. Vercel > Add New Project > import the repository. Framework: Next.js (auto-detected).
3. Add environment variables from `.env.example` in Vercel > Settings > Environment Variables, separately for Preview and Production.
4. Run database migrations against production from your PC:

   ```powershell
   $env:DIRECT_URL = "<production direct connection string>"
   npx prisma migrate deploy
   Remove-Item Env:DIRECT_URL
   ```

5. Deploy, then confirm `https://<your-app>/api/health` returns `{"status":"ok"}`.
6. Register the webhook URL in Meta (see `WHATSAPP_SETUP.md`).

## Operational checks after each deploy

- Health endpoint OK.
- Sign in works; signed-out access to pages is redirected.
- Mock provider is **not** active in production (`WHATSAPP_PROVIDER=meta`).
