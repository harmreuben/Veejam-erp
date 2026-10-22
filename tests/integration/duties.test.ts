import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { authorize, type Actor } from "@/server/auth/permissions";
import { resolveSession } from "@/server/auth/resolve";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import {
  changeUserRole,
  findUserByAuthId,
  getUserDuties,
  listUsers,
  setUserDuties,
} from "@/server/modules/users/service";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => clearTestData());

/** The person as the app sees them on their next click (role defaults + their changes). */
async function signedIn(authUserId: string): Promise<Actor> {
  const s = await resolveSession({ sub: authUserId }, (id) => findUserByAuthId(db, id));
  if (s.kind !== "user") throw new Error(`expected a signed-in user, got ${s.kind}`);
  return { id: s.user.id, email: s.user.email, role: s.user.role, permissions: s.user.permissions };
}

const salesDefaults = async () =>
  (await getUserDuties(db, await makeUser(db, "OWNER"), (await makeUser(db, "SALES")).id)).effective;

describe("per-person duties", () => {
  it("an owner removes and adds duties; it applies on the person's next click and is audited", async () => {
    const owner = await makeUser(db, "OWNER");
    const sales = await makeUser(db, "SALES");
    const before = await signedIn(sales.authUserId);
    expect(() => authorize(before, "payments.record")).not.toThrow();
    expect(() => authorize(before, "sales.discount")).toThrow(ForbiddenError);

    const current = (await getUserDuties(db, owner, sales.id)).effective;
    const wanted = [...current.filter((p) => p !== "payments.record"), "sales.discount"];
    const r = await setUserDuties(db, owner, { userId: sales.id, permissions: wanted });
    expect(r.added).toEqual(["sales.discount"]);
    expect(r.removed).toEqual(["payments.record"]);

    const after = await signedIn(sales.authUserId);
    expect(() => authorize(after, "payments.record")).toThrow(ForbiddenError);
    expect(() => authorize(after, "sales.discount")).not.toThrow();

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "USER_DUTIES_CHANGED" } });
    expect(audit).toMatchObject({ actorUserId: owner.id, entityId: sales.id });
    expect(audit.summary).toContain("added Give discounts");
    expect(audit.summary).toContain("removed Record customer payments");

    const listed = (await listUsers(db, owner)).find((u) => u.id === sales.id)!;
    expect(listed).toMatchObject({ dutiesAdded: 1, dutiesRemoved: 1 });
  });

  it("saving the same duties again changes nothing", async () => {
    const owner = await makeUser(db, "OWNER");
    const sales = await makeUser(db, "SALES");
    const current = (await getUserDuties(db, owner, sales.id)).effective;
    const r = await setUserDuties(db, owner, { userId: sales.id, permissions: current });
    expect(r).toMatchObject({ added: [], removed: [] });
    expect(await db.userDutyChange.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "USER_DUTIES_CHANGED" } })).toBe(0);
  });

  it("a duty needs the one it depends on, and role-only duties can't be switched on", async () => {
    const owner = await makeUser(db, "OWNER");
    const store = await makeUser(db, "STOREKEEPER");
    const current = (await getUserDuties(db, owner, store.id)).effective;

    // Posting invoices without preparing them.
    await expect(
      setUserDuties(db, owner, { userId: store.id, permissions: [...current, "invoices.post"] }),
    ).rejects.toMatchObject({ fieldErrors: { permissions: [expect.stringContaining("also needs")] } });

    for (const p of ["whatsapp.use", "users.manage"]) {
      const withView = [...current, p, p === "users.manage" ? "users.view" : "whatsapp.view"];
      await expect(
        setUserDuties(db, owner, { userId: store.id, permissions: withView }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      setUserDuties(db, owner, { userId: store.id, permissions: [...current, "made.up"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    // The database refuses WhatsApp for non-owners too.
    await expect(
      db.userDutyChange.create({ data: { userId: store.id, permission: "whatsapp.use", granted: true } }),
    ).rejects.toThrow();
  });

  it("owners keep every duty; admins can't change owners; nobody changes their own", async () => {
    const owner = await makeUser(db, "OWNER");
    const owner2 = await makeUser(db, "OWNER");
    const admin = await makeUser(db, "ADMIN");
    const sales = await makeUser(db, "SALES");

    await expect(setUserDuties(db, owner, { userId: owner2.id, permissions: [] })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await getUserDuties(db, owner, owner2.id)).readOnlyReason).toBe("Owners always have every duty.");
    await expect(setUserDuties(db, admin, { userId: owner.id, permissions: [] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setUserDuties(db, admin, { userId: admin.id, permissions: [] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setUserDuties(db, sales, { userId: sales.id, permissions: [] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // An admin can change a sales person.
    const current = (await getUserDuties(db, admin, sales.id)).effective;
    await setUserDuties(db, admin, {
      userId: sales.id,
      permissions: current.filter((p) => p !== "documents.share"),
    });
    expect((await signedIn(sales.authUserId)).permissions).not.toContain("documents.share");
  });

  it("an admin whose user management was switched off can no longer manage anyone", async () => {
    const owner = await makeUser(db, "OWNER");
    const admin = await makeUser(db, "ADMIN");
    const sales = await makeUser(db, "SALES");
    const current = (await getUserDuties(db, owner, admin.id)).effective;
    await setUserDuties(db, owner, {
      userId: admin.id,
      permissions: current.filter((p) => p !== "users.manage"),
    });
    const adminNow = await signedIn(admin.authUserId);
    await expect(
      setUserDuties(db, adminNow, { userId: sales.id, permissions: await salesDefaults() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeUserRole(db, adminNow, sales.id, "ACCOUNTANT")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("changing someone's role starts again from the new role's duties", async () => {
    const owner = await makeUser(db, "OWNER");
    const sales = await makeUser(db, "SALES");
    const current = (await getUserDuties(db, owner, sales.id)).effective;
    await setUserDuties(db, owner, { userId: sales.id, permissions: [...current, "sales.discount"] });
    expect(await db.userDutyChange.count({ where: { userId: sales.id } })).toBe(1);

    await changeUserRole(db, owner, sales.id, "STOREKEEPER");
    expect(await db.userDutyChange.count({ where: { userId: sales.id } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "USER_ROLE_CHANGED" } });
    expect(audit.metadata).toMatchObject({ dutyChangesCleared: 1 });
    expect((await signedIn(sales.authUserId)).permissions).not.toContain("sales.discount");
  });

  it("deactivated people can't be changed until reactivated", async () => {
    const owner = await makeUser(db, "OWNER");
    const gone = await makeUser(db, "SALES", { isActive: false });
    await expect(setUserDuties(db, owner, { userId: gone.id, permissions: [] })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
