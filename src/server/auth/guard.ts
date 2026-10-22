import "server-only";

import { hasPermission, type Permission } from "./permissions";
import type { AppUser } from "./resolve";
import { requireUser } from "./session";

/**
 * For pages: the signed-in user if they hold the permission, otherwise null
 * (the page then shows the "no access" message instead of any data).
 * Sign-in is still enforced: signed-out visitors are redirected.
 */
export async function pageUser(permission: Permission): Promise<AppUser | null> {
  const user = await requireUser();
  return hasPermission(user, permission) ? user : null;
}
