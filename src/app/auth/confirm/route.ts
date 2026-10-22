import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { currentSessionId, setRecoveryProof } from "@/server/auth/password-reset";
import { safeNextPath } from "@/server/auth/resolve";
import { createSupabaseServerClient } from "@/server/auth/supabase";

/**
 * Where links in Supabase emails land.
 *  - ?token_hash=…&type=recovery  (our email template: works on any device)
 *  - ?code=…                      (Supabase's default link: works only in the browser that asked)
 * On success the person is signed in and sent on (to the new-password page for resets).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = safeNextPath(url.searchParams.get("next") ?? "/");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const fail = () => NextResponse.redirect(new URL("/forgot-password?expired=1", url.origin));

  const supabase = await createSupabaseServerClient();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  if (!ok) return fail();

  if (next === "/reset-password" || type === "recovery") {
    const sid = await currentSessionId();
    if (!sid) return fail();
    await setRecoveryProof(sid);
    return NextResponse.redirect(new URL("/reset-password", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
