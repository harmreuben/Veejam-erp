import { NextResponse, type NextRequest } from "next/server";

import { homePathFor } from "@/config/modules";
import { LANDING_COOKIE } from "@/server/auth/landing";
import { getSession } from "@/server/auth/session";

/**
 * Every fresh load of the app comes here (see proxy.ts): it works out the
 * person's start page and sends them there, with a one-minute cookie that lets
 * that page load. Signed-out visitors go to sign-in.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (session.kind !== "user") return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  const home = homePathFor(session.user.role, session.user.permissions);
  const res = NextResponse.redirect(new URL(home, req.nextUrl.origin));
  res.cookies.set(LANDING_COOKIE, home, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
