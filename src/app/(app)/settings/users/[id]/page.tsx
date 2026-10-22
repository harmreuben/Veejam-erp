import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import {
  DUTY_GROUPS,
  hasPermission,
  NOT_GRANTABLE,
  PERMISSION_INFO,
  PERMISSIONS,
  REQUIRES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getUserDuties } from "@/server/modules/users/service";

import { DutiesForm } from "./duties-form";

export const metadata = { title: "Duties" };

export default async function UserDutiesPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!hasPermission(me, "users.view")) return <NoAccess what="users and roles" />;
  const { id } = await params;
  let view;
  try {
    view = await getUserDuties(getDb(), toActor(me), id);
  } catch (error) {
    if (error instanceof NotFoundError) return <NoAccess what="this user" />;
    throw error;
  }
  const { user, effective, roleDefaults, editable, readOnlyReason } = view;
  const duties = PERMISSIONS.map((p) => ({
    key: p,
    label: PERMISSION_INFO[p].label,
    group: PERMISSION_INFO[p].group,
    requires: REQUIRES[p] ?? null,
    roleOnly: NOT_GRANTABLE.includes(p),
  }));

  return (
    <Page>
      <PageHeader
        back={{ href: "/settings/users", label: "Users & roles" }}
        title={`${user.fullName}'s duties`}
        description={
          <>
            {user.email} · <strong>{ROLE_LABELS[user.role]}</strong>
            {!user.isActive && (
              <Badge variant="warning" className="ml-2">
                Deactivated
              </Badge>
            )}
            <br />
            The role sets the starting duties ({ROLE_DESCRIPTIONS[user.role]}) Tick or untick to fit what this
            person actually does. Changing their role later starts again from that role&apos;s duties.
          </>
        }
      />
      {readOnlyReason && (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {readOnlyReason}
        </p>
      )}
      <DutiesForm
        userId={user.id}
        name={user.fullName}
        roleLabel={ROLE_LABELS[user.role]}
        duties={duties}
        groups={[...DUTY_GROUPS]}
        effective={effective}
        roleDefaults={roleDefaults}
        editable={editable}
      />
    </Page>
  );
}
