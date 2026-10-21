/**
 * Session cookie settings, shared by the proxy and server code.
 *
 * - httpOnly: page scripts can't read the session (limits damage from any XSS bug).
 *   Safe because the app never uses Supabase from the browser.
 * - secure in production: only sent over HTTPS.
 * - sameSite lax: not sent on cross-site form posts (CSRF protection; server
 *   actions also check the Origin header).
 * - 12 hours: staff sign in once per working day; a lost or shared laptop
 *   doesn't stay signed in for weeks.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 12 * 60 * 60,
};
