import "server-only";

import { cookies } from "next/headers";

/**
 * A one-off message carried across a redirect (e.g. "saved as a draft, not
 * posted, because…"). Kept in an HTTP-only cookie scoped to the page it is
 * for, for one minute, so it never appears in a URL that could be crafted.
 */
const NAME = "vj-flash";

export async function setFlash(path: string, message: string): Promise<void> {
  (await cookies()).set(NAME, encodeURIComponent(message.slice(0, 900)), {
    path,
    maxAge: 60,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function readFlash(): Promise<string | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
