# WhatsApp setup

> Phase 1: configuration plan. The mock provider is built in Phase 6 and the Meta provider is connected and tested in Phase 7. Until then, no WhatsApp feature is claimed to work.

## Rules

- Official **Meta WhatsApp Business Platform Cloud API** only. No WhatsApp Web automation, no scraping, no unofficial libraries.
- Only the number in `VEEJAM_OWNER_WHATSAPP_NUMBER` can run ERP commands. Messages from any other number get a polite refusal and are logged; customers are never confused with the owner even if they share a business.
- Every webhook POST is rejected unless its `X-Hub-Signature-256` header matches an HMAC-SHA256 of the **raw** request body computed with `META_APP_SECRET`.

## Providers

| `WHATSAPP_PROVIDER` | Use                                                                                                                    | Needs Meta account |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `mock` (default)    | Local development and automated tests. Messages are stored and shown in a simulator page, clearly marked as simulated. | No                 |
| `meta`              | Real messages through the Cloud API.                                                                                   | Yes                |

## Getting Meta credentials (Phase 7)

1. Create a Meta developer account at developers.facebook.com and a **Business** type app.
2. Add the **WhatsApp** product to the app. Meta provides a free test phone number.
3. In **WhatsApp > API Setup** copy:
   - Temporary access token → `META_WHATSAPP_TOKEN` (replace with a permanent System User token before production)
   - Phone number ID → `META_WHATSAPP_PHONE_NUMBER_ID`
   - WhatsApp Business Account ID → `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
4. Add the owner's phone as an allowed recipient for the test number.
5. In **App settings > Basic** reveal the App secret → `META_APP_SECRET`.
6. Invent a long random string → `META_WHATSAPP_VERIFY_TOKEN`. Generate one in PowerShell:

   ```powershell
   -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
   ```

7. Webhook URL (must be public HTTPS): `https://<your-app>/api/whatsapp/webhook`, subscribed to the `messages` field.

Put local values in `.env.local`; put production values in Vercel > Project > Settings > Environment Variables. Never paste them into chat, code, or Git.
