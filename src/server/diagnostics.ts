import "server-only";

import type { Db } from "@/server/db/client";

import { createSupabaseServerClient, isSupabaseConfigured } from "./auth/supabase";

const REGION_NAMES: Record<string, string> = {
  dub1: "Dublin, Ireland",
  lhr1: "London",
  cdg1: "Paris",
  fra1: "Frankfurt",
  arn1: "Stockholm",
  iad1: "Washington, D.C., USA",
  cle1: "Cleveland, USA",
  sfo1: "San Francisco, USA",
  pdx1: "Portland, USA",
  gru1: "São Paulo",
  bom1: "Mumbai",
  sin1: "Singapore",
  hnd1: "Tokyo",
  icn1: "Seoul",
  syd1: "Sydney",
  cpt1: "Cape Town",
  dxb1: "Dubai",
  hkg1: "Hong Kong",
};
const AWS_REGIONS: Record<string, string> = {
  "eu-west-1": "Ireland",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "eu-central-1": "Frankfurt",
  "eu-central-2": "Zurich",
  "eu-north-1": "Stockholm",
  "us-east-1": "N. Virginia, USA",
  "us-east-2": "Ohio, USA",
  "us-west-1": "N. California, USA",
  "us-west-2": "Oregon, USA",
  "ap-south-1": "Mumbai",
  "af-south-1": "Cape Town",
  "me-central-1": "UAE",
};

const ms = (start: number) => Math.round(performance.now() - start);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

export type SpeedReport = {
  serverRegion: string | null;
  serverRegionName: string | null;
  databaseRegion: string | null;
  databaseRegionName: string | null;
  instanceAgeSeconds: number;
  /** Round trips to the database, first one first (it may include opening the connection). */
  databaseMs: number[];
  databaseTypicalMs: number;
  /** One sign-in check as done on every page. */
  signInMs: number | null;
  /** HS256 = older shared secret: every check calls Supabase. ES256/RS256 = checked locally. */
  signInKey: string | null;
  advice: { level: "ok" | "warn"; text: string }[];
};

/**
 * Measure the steps every page goes through, from inside the server. No
 * secrets are returned: only region names, timings and the key algorithm.
 */
export async function measureSpeed(db: Db): Promise<SpeedReport> {
  const serverRegion = process.env.VERCEL_REGION ?? null;
  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  const databaseRegion = /(?:^|[.-])((?:eu|us|ap|af|me|sa|ca)-[a-z]+-\d)\b/.exec(dbHost)?.[1] ?? null;

  const databaseMs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const t = performance.now();
    await db.$queryRaw`SELECT 1`;
    databaseMs.push(ms(t));
  }
  const databaseTypicalMs = median(databaseMs.slice(1));

  let signInMs: number | null = null;
  let signInKey: string | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const t = performance.now();
    const { data } = await supabase.auth.getClaims();
    signInMs = ms(t);
    signInKey = (data?.header as { alg?: string } | undefined)?.alg ?? null;
  }

  const advice: SpeedReport["advice"] = [];
  if (serverRegion && serverRegion !== "dub1" && databaseRegion === "eu-west-1") {
    advice.push({
      level: "warn",
      text: `The app's server runs in ${REGION_NAMES[serverRegion] ?? serverRegion}, far from the database in Ireland, so every database step crosses that distance. In Vercel → Settings → Functions → Function Regions, choose Dublin (dub1) and redeploy.`,
    });
  }
  if (databaseTypicalMs > 40) {
    advice.push({
      level: "warn",
      text: `Each database step takes about ${databaseTypicalMs} ms; next to the database it should be under 10 ms. Check the server region above and that DATABASE_URL is the Transaction pooler (port 6543).`,
    });
  }
  if (signInKey?.startsWith("HS")) {
    advice.push({
      level: "warn",
      text: `Sign-in checks use Supabase's older shared-secret key (${signInKey}), so every click asks Supabase over the internet, twice. Switch to signing keys: Supabase → Project Settings → JWT Keys → "Migrate JWT secret", then "Rotate keys". Nobody gets signed out. Checks then happen on the server instantly.`,
    });
  } else if (signInMs !== null && signInMs > 150) {
    advice.push({ level: "warn", text: `The sign-in check took ${signInMs} ms.` });
  }
  // How long this server process has been running: young means this request paid a "cold start".
  const ageSeconds = Math.round(process.uptime());
  if (ageSeconds < 15) {
    advice.push({
      level: "warn",
      text: 'This server had only just started (a "cold start"), which adds a second or two to the first click after a quiet spell. Reload this page to see warm timings.',
    });
  }
  if (!advice.length)
    advice.push({ level: "ok", text: "The server side looks fast. Compare with the browser timing below." });

  return {
    serverRegion,
    serverRegionName: serverRegion ? (REGION_NAMES[serverRegion] ?? serverRegion) : null,
    databaseRegion,
    databaseRegionName: databaseRegion ? (AWS_REGIONS[databaseRegion] ?? databaseRegion) : null,
    instanceAgeSeconds: ageSeconds,
    databaseMs,
    databaseTypicalMs,
    signInMs,
    signInKey,
    advice,
  };
}
