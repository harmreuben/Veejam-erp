import { CheckCircle2, CircleAlert } from "lucide-react";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { measureSpeed } from "@/server/diagnostics";

import { BrowserTiming } from "./browser-timing";

export const metadata = { title: "Speed check" };

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 border-t py-3 first:border-t-0 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">
        <span className="font-medium tabular-nums">{value}</span>
        {note && <span className="text-muted-foreground block text-xs">{note}</span>}
      </dd>
    </div>
  );
}

export default async function SpeedPage() {
  const user = await pageUser("backups.view");
  if (!user) return <NoAccess what="the speed check" />;
  const r = await measureSpeed(getDb());

  return (
    <Page>
      <PageHeader
        title="Speed check"
        description="Where the time goes when a page loads. Run it from the phone or computer that feels slow; reload to measure again."
      />

      <ul className="grid gap-2">
        {r.advice.map((a) => (
          <li
            key={a.text}
            className={`flex gap-2 rounded-md border p-3 text-sm ${a.level === "warn" ? "border-warning/40 bg-warning-soft" : "border-success/40 bg-success-soft"}`}
          >
            {a.level === "warn" ? (
              <CircleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {a.text}
          </li>
        ))}
      </ul>

      <Section title="Your connection">
        <BrowserTiming />
      </Section>

      <Section title="On the server">
        <dl className="bg-card rounded-lg border px-4">
          <Row
            label="Server location"
            value={r.serverRegionName ?? "This computer (not Vercel)"}
            note={r.serverRegion ? `Vercel region ${r.serverRegion}` : undefined}
          />
          <Row
            label="Database location"
            value={r.databaseRegionName ?? "Unknown"}
            note={r.databaseRegion ?? undefined}
          />
          <Row
            label="Database step"
            value={`${r.databaseTypicalMs} ms`}
            note={`Four tries: ${r.databaseMs.join(", ")} ms (the first may include connecting). A page makes several.`}
          />
          <Row
            label="Sign-in check"
            value={r.signInMs === null ? "Not set up" : `${r.signInMs} ms`}
            note={
              r.signInKey
                ? r.signInKey.startsWith("HS")
                  ? `Key type ${r.signInKey}: asks Supabase each time`
                  : `Key type ${r.signInKey}: checked on the server`
                : undefined
            }
          />
          <Row
            label="Server running for"
            value={`${r.instanceAgeSeconds} s`}
            note="Under about 15 s means this request started a fresh server (a cold start)."
          />
        </dl>
      </Section>
    </Page>
  );
}
