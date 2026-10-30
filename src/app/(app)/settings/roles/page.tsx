import Link from "next/link";
import { Check, Minus, Lock } from "lucide-react";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { UserRole } from "@/generated/prisma/enums";
import {
  DUTY_GROUPS,
  NOT_GRANTABLE,
  PERMISSION_INFO,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  roleHasPermission,
} from "@/server/auth/permissions";
import { pageUser } from "@/server/auth/guard";

export const metadata = { title: "Roles & permissions" };

const ROLES = Object.values(UserRole);

/**
 * Which duties each role starts with, straight from the rules the app enforces
 * (server/auth/permissions.ts). Read-only: a person's own duties are switched on
 * or off on their page under Users & roles.
 */
export default async function RolesPage() {
  const user = await pageUser("users.view");
  if (!user) return <NoAccess what="roles and permissions" />;
  return (
    <Page wide>
      <PageHeader
        title="Roles & permissions"
        description={
          <>
            What each role can do when someone is given it. To change one person&apos;s duties, open them
            under{" "}
            <Link href="/settings/users" className="text-link hover:underline">
              Users &amp; roles
            </Link>
            . Duties marked with a lock stay with owners and administrators and can&apos;t be given to anyone
            else.
          </>
        }
      />
      <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="bg-card rounded-lg border p-3">
            <div className="font-semibold">{ROLE_LABELS[r]}</div>
            <div className="text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</div>
          </div>
        ))}
      </div>
      <div className="bg-card relative overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="sr-only">Duties each role starts with</caption>
          <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-semibold tracking-[0.04em] uppercase">
            <tr>
              <th scope="col" className="bg-muted sticky left-0 px-4 py-2.5 text-left">
                Duty
              </th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="px-3 py-2.5 text-center whitespace-nowrap">
                  {ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          {DUTY_GROUPS.map((g) => {
            const duties = PERMISSIONS.filter((p) => PERMISSION_INFO[p].group === g);
            if (!duties.length) return null;
            return (
              <tbody key={g} className="divide-y border-b">
                <tr className="bg-secondary/60">
                  <th
                    scope="rowgroup"
                    colSpan={ROLES.length + 1}
                    className="px-4 py-2 text-left text-xs font-semibold"
                  >
                    {g}
                  </th>
                </tr>
                {duties.map((p) => (
                  <tr key={p} className="hover:bg-muted/40">
                    <th
                      scope="row"
                      className="bg-card sticky left-0 min-w-72 px-4 py-2 text-left font-normal"
                    >
                      <span className="flex items-center gap-2">
                        {PERMISSION_INFO[p].label}
                        {NOT_GRANTABLE.includes(p) && (
                          <Lock
                            className="text-muted-foreground size-3.5"
                            aria-label="Owners and admins only"
                          />
                        )}
                      </span>
                    </th>
                    {ROLES.map((r) => (
                      <td key={r} className="px-3 py-2 text-center">
                        {roleHasPermission(r, p) ? (
                          <Check className="text-success mx-auto size-4" aria-label="Yes" />
                        ) : (
                          <Minus className="text-muted-foreground/50 mx-auto size-4" aria-label="No" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </Page>
  );
}
