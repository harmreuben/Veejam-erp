import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getConfigChecks, getServerEnv } from "@/config/env";
import { BUILD_PHASES, PHASE_STATUS } from "@/config/modules";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getCompanySettings, type CompanySettingsView } from "@/server/modules/settings/service";

export const metadata = { title: "Setup status" };

const PROFILE_ROWS: { label: string; key: keyof CompanySettingsView }[] = [
  { label: "Company", key: "name" },
  { label: "Telephone", key: "telephone" },
  { label: "Email on documents", key: "documentEmail" },
  { label: "Country", key: "country" },
  { label: "Currency", key: "currency" },
  { label: "Time zone", key: "timezone" },
  { label: "Business", key: "businessType" },
  { label: "Products", key: "productScope" },
];

function Integrations() {
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

export default async function SetupStatusPage() {
  const user = await requireUser();
  const company = await getCompanySettings(getDb(), toActor(user));

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-10 md:py-12">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Setup status</h1>
        <p className="text-muted-foreground max-w-[65ch]">
          Business modules appear in the menu as each phase is built and tested. Nothing here is simulated.
        </p>
      </header>

      <section aria-labelledby="phases-heading" className="grid gap-3">
        <h2 id="phases-heading" className="text-base font-semibold">
          Build plan
        </h2>
        <ol className="bg-card divide-y rounded-lg border">
          {BUILD_PHASES.map(({ phase, title }) => {
            const status = PHASE_STATUS[phase] ?? "todo";
            const done = status !== "todo";
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
                {status === "done" && (
                  <Badge variant="success" className="ml-auto">
                    Done
                  </Badge>
                )}
                {status === "partial" && (
                  <Badge variant="warning" className="ml-auto">
                    Part done
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
              Stored in the database.{" "}
              <Link href="/settings/company" className="text-primary underline-offset-4 hover:underline">
                Open company settings
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {PROFILE_ROWS.map(({ label, key }) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words">{String(company[key] ?? "—")}</dd>
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
            <Integrations />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
