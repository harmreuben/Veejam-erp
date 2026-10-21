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
      ADMIN: [...PERMISSIONS].sort(),
      ACCOUNTANT: [
        "audit.view",
        "catalogue.costs",
        "catalogue.view",
        "customers.credit",
        "customers.manage",
        "customers.view",
        "inventory.view",
        "settings.view",
        "suppliers.manage",
        "suppliers.view",
      ],
      SALES: ["catalogue.view", "customers.manage", "customers.view", "inventory.view", "settings.view"],
      STOREKEEPER: [
        "catalogue.view",
        "inventory.count",
        "inventory.transfer",
        "inventory.view",
        "settings.view",
        "suppliers.view",
      ],
    });
  });

  it("price changes, stock write-offs and posting counts need an owner or admin", () => {
    for (const p of [
      "inventory.adjust",
      "inventory.count.post",
      "pricing.manage",
      "catalogue.manage",
    ] as const) {
      expect(hasPermission("OWNER", p) && hasPermission("ADMIN", p)).toBe(true);
      for (const r of ["ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
        expect(hasPermission(r, p), `${r} ${p}`).toBe(false);
      }
    }
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
