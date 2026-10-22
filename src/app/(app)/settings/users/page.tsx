import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { NoAccess } from "@/components/no-access";
import { UserRole } from "@/generated/prisma/enums";
import { hasPermission, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listUsers } from "@/server/modules/users/service";

import { AddStaffForm } from "./add-staff-form";
import { AccessToggle, RoleSelect } from "./user-row-actions";

export const metadata = { title: "Users & roles" };

const nairobiDate = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Nairobi",
});

export default async function UsersPage() {
  const me = await requireUser();
  if (!hasPermission(me, "users.view")) return <NoAccess what="users and roles" />;

  const users = await listUsers(getDb(), toActor(me));
  const canManage = hasPermission(me, "users.manage");
  // Only owners may assign the owner role.
  const assignable = Object.values(UserRole)
    .filter((r) => me.role === "OWNER" || r !== "OWNER")
    .map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }));

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-10 md:py-12">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Users &amp; roles</h1>
        <p className="text-muted-foreground max-w-[70ch] text-sm">
          Each person signs in with their own email. Their role sets their starting duties; open a person to
          switch individual duties on or off. Deactivated users keep their history but can&apos;t sign in.
        </p>
      </header>

      <section aria-labelledby="people" className="grid gap-3">
        <h2 id="people" className="text-base font-semibold">
          People with access <span className="text-muted-foreground font-normal">({users.length})</span>
        </h2>
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Role
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Last signed in
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Access</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => {
                const isMe = u.id === me.id;
                const editable = canManage && !isMe && (me.role === "OWNER" || u.role !== "OWNER");
                return (
                  <tr key={u.id} className={u.isActive ? undefined : "text-muted-foreground"}>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        <Link href={`/settings/users/${u.id}`} className="hover:underline">
                          {u.fullName}
                        </Link>{" "}
                        {isMe && <span className="text-muted-foreground font-normal">(you)</span>}
                      </div>
                      <div className="text-muted-foreground text-xs">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {editable && u.isActive ? (
                          <RoleSelect userId={u.id} name={u.fullName} role={u.role} roles={assignable} />
                        ) : (
                          ROLE_LABELS[u.role]
                        )}
                        {u.dutiesAdded + u.dutiesRemoved > 0 && (
                          <Badge
                            variant="warning"
                            title={`${u.dutiesAdded} added, ${u.dutiesRemoved} removed compared with the role`}
                          >
                            Customised
                          </Badge>
                        )}
                        <Link
                          href={`/settings/users/${u.id}`}
                          className="text-muted-foreground hover:text-foreground text-xs underline"
                          aria-label={`Duties for ${u.fullName}`}
                        >
                          Duties
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        u.lastSeenAt ? (
                          nairobiDate.format(u.lastSeenAt)
                        ) : (
                          "Never"
                        )
                      ) : (
                        <Badge variant="warning">Deactivated</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editable && <AccessToggle userId={u.id} name={u.fullName} active={u.isActive} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <section aria-labelledby="add" className="bg-card grid gap-4 rounded-lg border p-5">
          <div className="grid gap-1">
            <h2 id="add" className="text-base font-semibold">
              Add a user
            </h2>
            <p className="text-muted-foreground text-sm">
              Creates their sign-in with a temporary password. They should change it from their account page
              after signing in for the first time.
            </p>
          </div>
          <AddStaffForm roles={assignable} />
        </section>
      )}
    </div>
  );
}
