import { DUTY_GROUPS, PERMISSION_INFO, ROLE_LABELS } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";

import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-8 md:px-10 md:py-12">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Your account</h1>
        <p className="text-muted-foreground text-sm">
          {user.fullName} · {user.email}
        </p>
      </header>
      <section className="grid gap-1 border-t pt-6" aria-labelledby="role">
        <h2 id="role" className="text-sm font-semibold">
          Role: {ROLE_LABELS[user.role]}
        </h2>
        <p className="text-muted-foreground text-sm">
          What you can do. Only an owner or administrator can change this.
        </p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          {DUTY_GROUPS.map((group) => {
            const mine = user.permissions.filter((p) => PERMISSION_INFO[p].group === group);
            if (!mine.length) return null;
            return (
              <div key={group}>
                <dt className="font-medium">{group}</dt>
                <dd className="text-muted-foreground">
                  <ul className="list-disc pl-5">
                    {mine.map((p) => (
                      <li key={p}>{PERMISSION_INFO[p].label}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
      <section className="grid gap-4 border-t pt-6" aria-labelledby="password">
        <h2 id="password" className="text-sm font-semibold">
          Change password
        </h2>
        <ChangePasswordForm email={user.email} />
      </section>
    </div>
  );
}
