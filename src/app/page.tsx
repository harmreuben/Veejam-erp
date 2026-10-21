import { Suspense } from "react";
import { connection } from "next/server";
import { CheckCircle2, CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import { getConfigChecks, getServerEnv } from "@/config/env";
import { BUILD_PHASES, CURRENT_PHASE } from "@/config/modules";

export const metadata = { title: "Setup status" };

const PROFILE_ROWS: { label: string; key: keyof typeof DEFAULT_COMPANY_PROFILE }[] = [
  { label: "Company", key: "name" },
  { label: "Telephone", key: "telephone" },
  { label: "Email on documents", key: "documentEmail" },
  { label: "Country", key: "country" },
  { label: "Currency", key: "currency" },
  { label: "Time zone", key: "timezone" },
  { label: "Business", key: "businessType" },
  { label: "Products", key: "productScope" },
];

async function Integrations() {
  await connection(); // read configuration at request time, not build time
  const env = getServerEnv();
  const checks = getConfigChecks(env);

  return (
    <ul className="divide-y">
      <li className="flex items-center justify-between gap-4 py-2.5 text-sm">
        <span>WhatsApp provider</span>
        <Badge variant="secondary">
          {env.WHATSAPP_PROVIDER === "mock" ? "Mock (simulated)" : "Meta Cloud API"}
        </Badge>
      </li>
      {checks.map((c) => (
        <li key={c.key} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <span className="flex items-center gap-2">
            {c.configured ? (
              <CheckCircle2 className="text-success size-4" aria-hidden />
            ) : (
              <CircleDashed className="text-muted-foreground size-4" aria-hidden />
            )}
            {c.label}
          </span>
          {c.configured ? (
            <Badge variant="success">Configured</Badge>
          ) : (
            <span className="text-muted-foreground text-xs">Set up in phase {c.phase}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function SetupStatusPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-10 md:py-12">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Setup status</h1>
        <p className="text-muted-foreground max-w-[65ch]">
          The foundation is in place. Business modules appear in the menu as each phase is built and tested;
          nothing here is simulated.
        </p>
      </header>

      <section aria-labelledby="phases-heading" className="grid gap-3">
        <h2 id="phases-heading" className="text-base font-semibold">
          Build plan
        </h2>
        <ol className="bg-card divide-y rounded-lg border">
          {BUILD_PHASES.map(({ phase, title }) => {
            const done = phase <= CURRENT_PHASE;
            return (
              <li key={phase} className="flex items-center gap-4 px-5 py-3 text-sm">
                <span
                  className={
                    done
                      ? "bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold"
                      : "text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full border text-xs"
                  }
                >
                  {phase}
                </span>
                <span className={done ? "font-medium" : "text-muted-foreground"}>{title}</span>
                {done && (
                  <Badge variant="success" className="ml-auto">
                    Done
                  </Badge>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company profile</CardTitle>
            <CardDescription>
              Starting values. From phase 2 they are stored in the database and edited on the Settings page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {PROFILE_ROWS.map(({ label, key }) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words">{DEFAULT_COMPANY_PROFILE[key]}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
            <CardDescription>
              Read from your <code className="text-foreground">.env.local</code> file. Only whether a value is
              set is shown, never the value.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<p className="text-muted-foreground text-sm">Checking configuration…</p>}>
              <Integrations />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
