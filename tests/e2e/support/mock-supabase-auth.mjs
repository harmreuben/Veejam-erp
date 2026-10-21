/**
 * TEST-ONLY stand-in for Supabase Auth (GoTrue), used by the browser tests.
 *
 * Implements only the endpoints this app calls: password sign-in, token
 * refresh, get/update user, sign-out, and the admin endpoints for creating,
 * listing, banning and deleting users. Tokens are HS256 JWTs, which makes the
 * app verify every request by calling GET /auth/v1/user, the same path it uses
 * with a real Supabase project that has symmetric signing keys.
 *
 * Passing tests against this stand-in proves the app's sign-in logic, not
 * Supabase itself. Sign-in against the real Supabase project is checked by hand
 * (see docs/TESTING.md).
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { E2E_ANON_KEY, E2E_SERVICE_KEY, E2E_USERS, MOCK_AUTH_PORT } from "./fixtures.mjs";

const SECRET = randomBytes(32);
const users = new Map(); // id -> user
const refreshTokens = new Map(); // token -> { userId, sessionId }
const revokedSessions = new Set();

function addUser({ id = randomUUID(), email, password }) {
  const now = new Date().toISOString();
  const user = {
    id,
    email: email.toLowerCase(),
    password,
    bannedUntil: null,
    created_at: now,
    updated_at: now,
  };
  users.set(id, user);
  return user;
}
for (const u of Object.values(E2E_USERS)) addUser({ id: u.authUserId, email: u.email, password: u.password });

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function signJwt(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [head, body, sig] = String(token).split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  if (claims.exp * 1000 < Date.now() || revokedSessions.has(claims.session_id)) return null;
  return claims;
}

const publicUser = (u) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  email_confirmed_at: u.created_at,
  phone: "",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: u.created_at,
  updated_at: u.updated_at,
  banned_until: u.bannedUntil,
});

function issueSession(user) {
  const sessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const refresh = randomBytes(24).toString("hex");
  refreshTokens.set(refresh, { userId: user.id, sessionId });
  return {
    access_token: signJwt({
      sub: user.id,
      email: user.email,
      aud: "authenticated",
      role: "authenticated",
      session_id: sessionId,
      iat: now,
      exp: now + expiresIn,
    }),
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token: refresh,
    user: publicUser(user),
  };
}

const isBanned = (u) => u.bannedUntil && new Date(u.bannedUntil) > new Date();

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${MOCK_AUTH_PORT}`);
    const path = url.pathname;
    if (path === "/auth/v1/health") return send(res, 200, { status: "ok" });

    const apikey = req.headers.apikey;
    if (apikey !== E2E_ANON_KEY && apikey !== E2E_SERVICE_KEY)
      return authError(res, 401, "no_api_key", "Invalid API key");

    // Sign in / refresh
    if (req.method === "POST" && path === "/auth/v1/token") {
      const body = await readJson(req);
      if (url.searchParams.get("grant_type") === "password") {
        const user = [...users.values()].find((u) => u.email === String(body.email ?? "").toLowerCase());
        if (!user || user.password !== body.password) {
          return authError(res, 400, "invalid_credentials", "Invalid login credentials");
        }
        if (isBanned(user)) return authError(res, 400, "user_banned", "User is banned");
        return send(res, 200, issueSession(user));
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const entry = refreshTokens.get(body.refresh_token);
        if (!entry) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
        refreshTokens.delete(body.refresh_token);
        const user = users.get(entry.userId);
        if (!user || isBanned(user)) return authError(res, 400, "user_banned", "User is banned");
        return send(res, 200, issueSession(user));
      }
      return authError(res, 400, "unsupported_grant_type", "Unsupported grant type");
    }

    // Current user
    if (path === "/auth/v1/user") {
      const claims = verifyJwt(bearer(req));
      const user = claims && users.get(claims.sub);
      if (!user) return authError(res, 401, "bad_jwt", "invalid JWT");
      if (req.method === "GET") return send(res, 200, publicUser(user));
      if (req.method === "PUT") {
        const body = await readJson(req);
        if (body.password) user.password = body.password;
        user.updated_at = new Date().toISOString();
        return send(res, 200, publicUser(user));
      }
    }

    if (req.method === "POST" && path === "/auth/v1/logout") {
      const claims = verifyJwt(bearer(req));
      if (claims) revokedSessions.add(claims.session_id);
      res.writeHead(204).end();
      return;
    }

    // Admin API (service-role key only)
    if (path.startsWith("/auth/v1/admin/")) {
      if (apikey !== E2E_SERVICE_KEY || bearer(req) !== E2E_SERVICE_KEY) {
        return authError(res, 403, "not_admin", "User not allowed");
      }
      if (req.method === "POST" && path === "/auth/v1/admin/users") {
        const body = await readJson(req);
        if ([...users.values()].some((u) => u.email === String(body.email).toLowerCase())) {
          return authError(
            res,
            422,
            "email_exists",
            "A user with this email address has already been registered",
          );
        }
        return send(res, 200, publicUser(addUser({ email: body.email, password: body.password })));
      }
      if (req.method === "GET" && path === "/auth/v1/admin/users") {
        const page = Number(url.searchParams.get("page") ?? 1);
        const perPage = Number(url.searchParams.get("per_page") ?? 50);
        const all = [...users.values()];
        return send(res, 200, {
          users: all.slice((page - 1) * perPage, page * perPage).map(publicUser),
          aud: "authenticated",
        });
      }
      const match = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
      if (match) {
        const user = users.get(match[1]);
        if (!user) return authError(res, 404, "user_not_found", "User not found");
        if (req.method === "PUT") {
          const body = await readJson(req);
          if (body.ban_duration === "none") user.bannedUntil = null;
          else if (body.ban_duration)
            user.bannedUntil = new Date(Date.now() + 876000 * 3600 * 1000).toISOString();
          if (body.password) user.password = body.password;
          return send(res, 200, publicUser(user));
        }
        if (req.method === "DELETE") {
          users.delete(user.id);
          return send(res, 200, {});
        }
      }
    }

    return authError(res, 404, "not_found", `Mock auth: no route for ${req.method} ${path}`);
  } catch (error) {
    return authError(res, 500, "unexpected_failure", String(error));
  }
});

server.listen(MOCK_AUTH_PORT, "127.0.0.1", () => {
  console.log(`[mock-supabase-auth] TEST ONLY — listening on http://127.0.0.1:${MOCK_AUTH_PORT}`);
});
