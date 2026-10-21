// Load .env.local for command-line scripts, the same way Next.js does for the app.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
