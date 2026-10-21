import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import {
  assertCanManageUser,
  authorize,
  hasPermission,
  PERMISSIONS,
  permissionsFor,
  ROLE_LABELS,
} from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";

const actor = (role: UserRole, id = "actor") => ({ id, email: `${id}@veejam.test`, role });

describe("role permissions", () => {
  it("owner has every permission", () => {
    expect([...permissionsFor("OWNER")].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("matches the agreed matrix", () => {
    const matrix = Object.fromEntries(Object.values(UserRole).map((r) => [r, [...permissionsFor(r)].sort()]));
    expect(matrix).toEqual({
      OWNER: [...PERMISSIONS].sort(),
      ADMIN: [
        "audit.view",
        "legacy.import",
        "settings.manage",
        "settings.view",
        "users.manage",
        "users.view",
      ],
      ACCOUNTANT: ["audit.view", "settings.view"],
      SALES: ["settings.view"],
      STOREKEEPER: ["settings.view"],
    });
  });

  it("every role has a label", () => {
    for (const r of Object.values(UserRole)) expect(ROLE_LABELS[r]).toBeTruthy();
  });

  it("authorize throws ForbiddenError when the role lacks the permission", () => {
    expect(() => authorize(actor("SALES"), "settings.manage")).toThrow(ForbiddenError);
    expect(() => authorize(actor("ADMIN"), "settings.manage")).not.toThrow();
    expect(hasPermission("STOREKEEPER", "users.view")).toBe(false);
  });
});

describe("managing other users", () => {
  const staff = { id: "staff", role: "SALES" as const };
  const owner = { id: "owner2", role: "OWNER" as const };

  it("owners and admins may manage staff", () => {
    expect(() => assertCanManageUser(actor("OWNER"), staff, "ACCOUNTANT")).not.toThrow();
    expect(() => assertCanManageUser(actor("ADMIN"), staff, "STOREKEEPER")).not.toThrow();
  });

  it("only owners may touch owners or create them", () => {
    expect(() => assertCanManageUser(actor("ADMIN"), owner)).toThrow(/Only an owner/);
    expect(() => assertCanManageUser(actor("ADMIN"), staff, "OWNER")).toThrow(/Only an owner/);
    expect(() => assertCanManageUser(actor("OWNER"), owner, "ADMIN")).not.toThrow();
  });

  it("nobody may change themselves", () => {
    expect(() => assertCanManageUser(actor("OWNER", "me"), { id: "me", role: "OWNER" }, "ADMIN")).toThrow(
      /your own/,
    );
  });

  it("other roles may not manage users", () => {
    for (const r of ["ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
      expect(() => assertCanManageUser(actor(r), staff)).toThrow(ForbiddenError);
    }
  });
});
