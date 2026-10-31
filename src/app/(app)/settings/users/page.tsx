import { Page, PageHeader } from "@/components/page";

import { Badge } from "@/components/ui/badge";
import { NoAccess } from "@/components/no-access";
import { UserRole } from "@/generated/prisma/enums";
import { hasPermission, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listUsers, MAX_ACTIVE_USERS } from "@/server/modules/users/service";

import { AddStaffForm } from "./add-staff-form";
import { AccessToggle, ResetLinkButton, RoleSelect } from "./user-row-actions";

export const metadata = { title: "Users" };

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
  const active = users.filter((u) => u.isActive).length;
  const room = active < MAX_ACTIVE_USERS;
  // Two accounts: the owner and an administrator. Only owners may assign the owner role.
  const assignable = (["OWNER", "ADMIN"] as const satisfies readonly UserRole[])
    .filter((r) => me.role === "OWNER" || r !== "OWNER")
    .map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }));

  return (
    <Page>
      <PageHeader
        title="Users"
        description={`VeeJam has two accounts: the owner (Venus Wanjiru) and the administrator (Reuben Maina). Both can run everything in the business; WhatsApp commands stay with the owner. Each signs in with their own email, and everything they do is in the audit log.`}
      />

      <section aria-labelledby="people" className="grid gap-3">
        <h2 id="people" className="text-base font-semibold">
          People with access <span className="text-muted-foreground font-normal">({users.length})</span>
        </h2>
        <div className="bg-card relative overflow-x-auto rounded-lg border">
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
                        {u.fullName}{" "}
                        {isMe && <span className="text-muted-foreground font-normal">(you)</span>}
                      </div>
                      <div className="text-muted-foreground text-xs">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {editable && u.isActive ? (
                          <RoleSelect
                            userId={u.id}
                            name={u.fullName}
                            role={u.role}
                            roles={
                              // Someone given an older role keeps it listed until it's changed.
                              assignable.some((r) => r.value === u.role)
                                ? assignable
                                : [...assignable, { value: u.role, label: ROLE_LABELS[u.role] }]
                            }
                          />
                        ) : (
                          ROLE_LABELS[u.role]
                        )}
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
                      {editable && (
                        <div className="flex justify-end gap-1">
                          {u.isActive && <ResetLinkButton userId={u.id} name={u.fullName} />}
                          <AccessToggle userId={u.id} name={u.fullName} active={u.isActive} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && !room && (
        <p className="text-muted-foreground text-sm">
          Both places are taken. To give someone else access, deactivate one of the accounts first.
        </p>
      )}
      {canManage && room && (
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
    </Page>
  );
}
