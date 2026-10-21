# Database certificate

Put Supabase's database CA certificate here as `supabase-ca.crt`.

Supabase dashboard → **Project Settings → Database → SSL Configuration → Download certificate**.
Rename the downloaded file to `supabase-ca.crt` and save it in this folder.

With it, the app verifies it is really talking to your Supabase database (protects
against anyone on the network pretending to be the database). Without it, the
connection is still encrypted, but not verified, and the app prints a warning.

This certificate is public (it is not a secret) and can be committed to Git.
