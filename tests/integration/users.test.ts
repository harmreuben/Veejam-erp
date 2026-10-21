import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import {
  changeUserRole,
  createStaffAccount,
  findUserByAuthId,
  grantUserAccess,
  listUsers,
  setUserActive,
} from "@/server/modules/users/service";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => clearTestData());

describe("granting access (first owner, CLI)", () => {
  it("links a Supabase account to a role and audits it", async () => {
    const authUserId = randomUUID();
    const user = await grantUserAccess(
      db,
      { authUserId, email: "Owner@VeeJam.test", fullName: "Venus Wanjiru", role: "OWNER" },
      { id: null, label: "cli:user-grant" },
    );
    expect(user).toMatchObject({ email: "owner@veejam.test", role: "OWNER", isActive: true });
    expect(await findUserByAuthId(db, authUserId)).toMatchObject({ role: "OWNER", isActive: true });
    expect(
      await db.auditLog.count({ where: { action: "USER_ACCESS_GRANTED", actorLabel: "cli:user-grant" } }),
    ).toBe(1);
  });

  it("refuses to link an email that belongs to another sign-in account", async () => {
    await grantUserAccess(
      db,
      { authUserId: randomUUID(), email: "a@veejam.test", fullName: "A Person", role: "SALES" },
      { id: null, label: "t" },
    );
    await expect(
      grantUserAccess(
        db,
        { authUserId: randomUUID(), email: "a@veejam.test", fullName: "Imposter", role: "OWNER" },
        { id: null, label: "t" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("changing roles", () => {
  it("owner can promote and demote; change is audited", async () => {
    const owner = await makeUser(db, "OWNER");
    const staff = await makeUser(db, "SALES");
    const updated = await changeUserRole(db, owner, staff.id, "ACCOUNTANT");
    expect(updated.role).toBe("ACCOUNTANT");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "USER_ROLE_CHANGED" } });
    expect(audit).toMatchObject({
      actorUserId: owner.id,
      entityId: staff.id,
      before: { role: "SALES" },
      after: { role: "ACCOUNTANT" },
    });
  });

  it("nobody can change their own role", async () => {
    const owner = await makeUser(db, "OWNER");
    await makeUser(db, "OWNER");
    await expect(changeUserRole(db, owner, owner.id, "SALES")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an admin cannot touch owners or create new owners", async () => {
    const owner = await makeUser(db, "OWNER");
    const admin = await makeUser(db, "ADMIN");
    const staff = await makeUser(db, "SALES");
    await expect(changeUserRole(db, admin, owner.id, "SALES")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeUserRole(db, admin, staff.id, "OWNER")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserActive(db, admin, owner.id, false)).rejects.toBeInstanceOf(ForbiddenError);
    // …but can manage other staff
    expect((await changeUserRole(db, admin, staff.id, "STOREKEEPER")).role).toBe("STOREKEEPER");
  });

  it("sales, storekeeper and accountant cannot manage users at all", async () => {
    const staff = await makeUser(db, "SALES");
    for (const role of ["SALES", "STOREKEEPER", "ACCOUNTANT"] as const) {
      const actor = await makeUser(db, role);
      await expect(changeUserRole(db, actor, staff.id, "ADMIN")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setUserActive(db, actor, staff.id, false)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).role).toBe("SALES");
  });

  it("rejects unknown roles", async () => {
    const owner = await makeUser(db, "OWNER");
    const staff = await makeUser(db, "SALES");
    await expect(changeUserRole(db, owner, staff.id, "SUPERUSER")).rejects.toThrow();
  });
});

describe("there is always at least one active owner", () => {
  it("an owner can demote another owner while one remains", async () => {
    const a = await makeUser(db, "OWNER");
    const b = await makeUser(db, "OWNER");
    await changeUserRole(db, a, b.id, "ADMIN");
    expect(await db.user.count({ where: { role: "OWNER", isActive: true } })).toBe(1);
  });

  it("the database check blocks removing the last active owner, even for a stale session", async () => {
    const a = await makeUser(db, "OWNER");
    const b = await makeUser(db, "OWNER");
    await setUserActive(db, b, a.id, false); // B deactivates A; B is now the only active owner
    // A's old session object still says OWNER; the count inside the transaction refuses.
    await expect(setUserActive(db, a, b.id, false)).rejects.toBeInstanceOf(ConflictError);
    await expect(changeUserRole(db, a, b.id, "SALES")).rejects.toBeInstanceOf(ConflictError);
    expect(await db.user.count({ where: { role: "OWNER", isActive: true } })).toBe(1);
  });

  it("two owners demoting each other at the same moment cannot leave zero owners", async () => {
    const a = await makeUser(db, "OWNER");
    const b = await makeUser(db, "OWNER");
    const results = await Promise.allSettled([
      changeUserRole(db, a, b.id, "ADMIN"),
      changeUserRole(db, b, a.id, "ADMIN"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect(await db.user.count({ where: { role: "OWNER", isActive: true } })).toBe(1);
  });
});

describe("deactivation", () => {
  it("removes access immediately, records when, and blocks Supabase sign-in", async () => {
    const owner = await makeUser(db, "OWNER");
    const staff = await makeUser(db, "SALES");
    const banHook = vi.fn().mockResolvedValue(undefined);

    await setUserActive(db, owner, staff.id, false, { banHook });
    const row = await findUserByAuthId(db, staff.authUserId);
    expect(row?.isActive).toBe(false);
    expect(banHook).toHaveBeenCalledWith(staff.authUserId, true);

    await setUserActive(db, owner, staff.id, true, { banHook });
    expect((await findUserByAuthId(db, staff.authUserId))?.isActive).toBe(true);
    expect(banHook).toHaveBeenLastCalledWith(staff.authUserId, false);
    expect(
      await db.auditLog.count({ where: { action: { in: ["USER_DEACTIVATED", "USER_REACTIVATED"] } } }),
    ).toBe(2);
  });

  it("a Supabase failure does not undo the deactivation", async () => {
    const owner = await makeUser(db, "OWNER");
    const staff = await makeUser(db, "SALES");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await setUserActive(db, owner, staff.id, false, {
      banHook: vi.fn().mockRejectedValue(new Error("network")),
    });
    expect((await findUserByAuthId(db, staff.authUserId))?.isActive).toBe(false);
  });

  it("you cannot deactivate yourself", async () => {
    const owner = await makeUser(db, "OWNER");
    await makeUser(db, "OWNER");
    await expect(setUserActive(db, owner, owner.id, false)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("adding staff from the Users page", () => {
  const hooks = () => ({
    createAccount: vi.fn().mockImplementation(async () => randomUUID()),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
  });

  it("creates the sign-in and the ERP user; the password never reaches the audit log", async () => {
    const owner = await makeUser(db, "OWNER");
    const h = hooks();
    const user = await createStaffAccount(
      db,
      owner,
      {
        email: "Clerk@VeeJam.test",
        fullName: "Shop Clerk",
        role: "SALES",
        temporaryPassword: "Temp-pass-2026",
      },
      h,
    );
    expect(user).toMatchObject({ email: "clerk@veejam.test", role: "SALES" });
    expect(h.createAccount).toHaveBeenCalledWith("clerk@veejam.test", "Temp-pass-2026");
    const audit = JSON.stringify(await db.auditLog.findMany(), (_k, v: unknown) =>
      typeof v === "bigint" ? String(v) : v,
    );
    expect(audit).not.toContain("Temp-pass-2026");
  });

  it("removes the new sign-in again if linking fails", async () => {
    const owner = await makeUser(db, "OWNER");
    const h = hooks();
    h.createAccount.mockResolvedValue("not-a-uuid");
    await expect(
      createStaffAccount(
        db,
        owner,
        { email: "x@veejam.test", fullName: "X Person", role: "SALES", temporaryPassword: "Temp-pass-2026" },
        h,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(h.deleteAccount).toHaveBeenCalledWith("not-a-uuid");
    expect(await db.user.count({ where: { email: "x@veejam.test" } })).toBe(0);
  });

  it("validates input before creating anything", async () => {
    const owner = await makeUser(db, "OWNER");
    const h = hooks();
    await expect(
      createStaffAccount(
        db,
        owner,
        { email: "bad", fullName: "", role: "SALES", temporaryPassword: "short" },
        h,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(h.createAccount).not.toHaveBeenCalled();
  });

  it("only an owner can add an owner, and duplicates are refused", async () => {
    const owner = await makeUser(db, "OWNER");
    const admin = await makeUser(db, "ADMIN");
    const h = hooks();
    const input = {
      email: "boss@veejam.test",
      fullName: "New Boss",
      role: "OWNER",
      temporaryPassword: "Temp-pass-2026",
    };
    await expect(createStaffAccount(db, admin, input, h)).rejects.toBeInstanceOf(ForbiddenError);
    await createStaffAccount(db, owner, input, h);
    await expect(createStaffAccount(db, owner, input, h)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("listing", () => {
  it("is limited to roles with users.view", async () => {
    const owner = await makeUser(db, "OWNER");
    const sales = await makeUser(db, "SALES");
    expect((await listUsers(db, owner)).length).toBe(2);
    await expect(listUsers(db, sales)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
