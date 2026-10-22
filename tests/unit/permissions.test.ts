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
      expect(hasPermission("OWNER", p) && hasPermission("ADMIN", p)).toBe(true);
      for (const r of ["ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
        expect(hasPermission(r, p), `${r} ${p}`).toBe(false);
      }
    }
  });

  it("only owners run WhatsApp commands; backups and the message log are owner/admin only", () => {
    expect(hasPermission("OWNER", "whatsapp.use")).toBe(true);
    for (const r of ["ADMIN", "ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
      expect(hasPermission(r, "whatsapp.use"), r).toBe(false);
    }
    for (const p of ["whatsapp.view", "backups.view"] as const) {
      expect(hasPermission("ADMIN", p)).toBe(true);
      for (const r of ["ACCOUNTANT", "SALES", "STOREKEEPER"] as const)
        expect(hasPermission(r, p)).toBe(false);
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
