import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import {
  assertCanManageUser,
  authorize,
  DUTY_GROUPS,
  effectivePermissions,
  hasPermission,
  NOT_GRANTABLE,
  PERMISSION_INFO,
  PERMISSIONS,
  permissionsFor,
  REQUIRES,
  ROLE_LABELS,
  roleHasPermission,
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
      ADMIN: PERMISSIONS.filter((p) => p !== "whatsapp.use").sort(),
      ACCOUNTANT: [
        "accounting.journal",
        "accounting.view",
        "audit.view",
        "bills.manage",
        "catalogue.costs",
        "catalogue.view",
        "credit_notes.manage",
        "customers.credit",
        "customers.manage",
        "customers.view",
        "documents.share",
        "goods.receive",
        "inventory.view",
        "invoices.manage",
        "invoices.post",
        "payables.view",
        "payments.record",
        "payments.reverse",
        "purchasing.manage",
        "purchasing.view",
        "reports.view",
        "sales.view",
        "settings.view",
        "supplier_payments.manage",
        "suppliers.manage",
        "suppliers.view",
      ],
      SALES: [
        "catalogue.view",
        "customers.manage",
        "customers.view",
        "delivery.manage",
        "documents.share",
        "inventory.view",
        "invoices.manage",
        "invoices.post",
        "orders.manage",
        "payments.record",
        "quotations.manage",
        "sales.view",
        "settings.view",
      ],
      STOREKEEPER: [
        "catalogue.view",
        "delivery.manage",
        "goods.receive",
        "inventory.count",
        "inventory.transfer",
        "inventory.view",
        "purchasing.view",
        "sales.view",
        "settings.view",
        "suppliers.view",
      ],
    });
  });

  it("price changes, write-offs, posting counts, discounts, credit overrides and tax rates need an owner or admin", () => {
    for (const p of [
      "inventory.adjust",
      "inventory.count.post",
      "pricing.manage",
      "catalogue.manage",
      "sales.discount",
      "credit.override",
      "tax.manage",
      "accounting.close",
      "inventory.revalue",
    ] as const) {
      expect(roleHasPermission("OWNER", p) && roleHasPermission("ADMIN", p)).toBe(true);
      for (const r of ["ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
        expect(roleHasPermission(r, p), `${r} ${p}`).toBe(false);
      }
    }
  });

  it("only owners run WhatsApp commands; backups and the message log are owner/admin only", () => {
    expect(roleHasPermission("OWNER", "whatsapp.use")).toBe(true);
    for (const r of ["ADMIN", "ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
      expect(roleHasPermission(r, "whatsapp.use"), r).toBe(false);
    }
    for (const p of ["whatsapp.view", "backups.view"] as const) {
      expect(roleHasPermission("ADMIN", p)).toBe(true);
      for (const r of ["ACCOUNTANT", "SALES", "STOREKEEPER"] as const)
        expect(roleHasPermission(r, p)).toBe(false);
    }
  });

  it("every role has a label", () => {
    for (const r of Object.values(UserRole)) expect(ROLE_LABELS[r]).toBeTruthy();
  });

  it("authorize throws ForbiddenError when the role lacks the permission", () => {
    expect(() => authorize(actor("SALES"), "settings.manage")).toThrow(ForbiddenError);
    expect(() => authorize(actor("ADMIN"), "settings.manage")).not.toThrow();
    expect(roleHasPermission("STOREKEEPER", "users.view")).toBe(false);
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

describe("per-person duties", () => {
  it("every duty has a plain-English label in a listed group", () => {
    for (const p of PERMISSIONS) {
      expect(PERMISSION_INFO[p]?.label, p).toBeTruthy();
      expect(DUTY_GROUPS).toContain(PERMISSION_INFO[p].group);
    }
  });

  it("with no changes, everyone has exactly their role's defaults (roles respect the dependencies)", () => {
    for (const r of Object.values(UserRole)) {
      expect(effectivePermissions(r, []).sort(), r).toEqual([...permissionsFor(r)].sort());
    }
  });

  it("dependencies point at real duties and never loop", () => {
    for (const [p, need] of Object.entries(REQUIRES)) {
      expect(PERMISSIONS).toContain(p);
      expect(PERMISSIONS).toContain(need);
      const seen = new Set<string>([p]);
      let cur: string | undefined = need;
      while (cur) {
        expect(seen.has(cur), `loop at ${p}`).toBe(false);
        seen.add(cur);
        cur = REQUIRES[cur as keyof typeof REQUIRES];
      }
    }
  });

  it("switches duties on and off for one person", () => {
    const sales = effectivePermissions("SALES", [
      { permission: "payments.record", granted: false },
      { permission: "sales.discount", granted: true },
    ]);
    expect(sales).not.toContain("payments.record");
    expect(sales).toContain("sales.discount");
    expect(sales).toContain("invoices.post");
  });

  it("owners always keep every duty", () => {
    expect(effectivePermissions("OWNER", [{ permission: "users.manage", granted: false }]).sort()).toEqual(
      [...PERMISSIONS].sort(),
    );
  });

  it("WhatsApp commands and managing users can't be switched on outside their roles", () => {
    for (const p of NOT_GRANTABLE) {
      expect(effectivePermissions("SALES", [{ permission: p, granted: true }])).not.toContain(p);
    }
    // An admin keeps users.manage unless it's switched off.
    expect(effectivePermissions("ADMIN", [])).toContain("users.manage");
    expect(effectivePermissions("ADMIN", [{ permission: "users.manage", granted: false }])).not.toContain(
      "users.manage",
    );
  });

  it("removing a duty also removes the duties that depend on it", () => {
    const p = effectivePermissions("SALES", [{ permission: "invoices.manage", granted: false }]);
    expect(p).not.toContain("invoices.manage");
    expect(p).not.toContain("invoices.post");
    const noSales = effectivePermissions("SALES", [{ permission: "sales.view", granted: false }]);
    expect(noSales.filter((x) => REQUIRES[x] === "sales.view")).toEqual([]);
  });

  it("unknown keys are ignored, and checks use the person's own duties", () => {
    const perms = effectivePermissions("STOREKEEPER", [
      { permission: "not.a.duty", granted: true },
      { permission: "inventory.adjust", granted: true },
    ]);
    const person = { id: "s", email: "s@veejam.test", role: "STOREKEEPER" as const, permissions: perms };
    expect(hasPermission(person, "inventory.adjust")).toBe(true);
    expect(roleHasPermission("STOREKEEPER", "inventory.adjust")).toBe(false);
    expect(() => authorize(person, "inventory.adjust")).not.toThrow();
    expect(() =>
      authorize({ ...person, permissions: perms.filter((x) => x !== "goods.receive") }, "goods.receive"),
    ).toThrow(ForbiddenError);
  });
});
