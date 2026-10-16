import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv, Env, SessionUser } from "./env";
import { isHttps, randomToken, safeEqual, sha256Hex } from "./util";

const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TokenResponse = z.object({ access_token: z.string() });
const GitHubUser = z.object({
  id: z.number(),
  login: z.string(),
  avatar_url: z.string().nullable().optional(),
});

const GH_HEADERS = { Accept: "application/json", "User-Agent": "ai-virtual-office" };

async function fetchGitHubUser(env: Env, code: string) {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { ...GH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
  const { access_token } = TokenResponse.parse(await tokenRes.json());

  const userRes = await fetch("https://api.github.com/user", {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) throw new Error(`user fetch failed: ${userRes.status}`);
  return GitHubUser.parse(await userRes.json());
}

async function audit(env: Env, actor: string | null, action: string, detail?: string) {
  await env.DB.prepare("INSERT INTO audit_logs (ts, actor, action, detail) VALUES (?, ?, ?, ?)")
    .bind(Date.now(), actor, action, detail ?? null)
    .run();
}

export async function getSessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id AS id, u.login AS login, u.avatar_url AS avatarUrl
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<SessionUser>();
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
};

export const auth = new Hono<AppEnv>();

auth.get("/github/login", (c) => {
  const state = randomToken(16);
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: 600,
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "read:user");
  return c.redirect(url.toString(), 302);
});

auth.get("/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });
  if (!code || !state || !expected || !safeEqual(state, expected)) {
    return c.redirect("/?error=state");
  }

  let gh: z.infer<typeof GitHubUser>;
  try {
    gh = await fetchGitHubUser(c.env, code);
  } catch (err) {
    console.error("github oauth error", err);
    return c.redirect("/?error=github");
  }

  const db = c.env.DB;
  const existing = await db
    .prepare("SELECT id FROM users WHERE github_id = ?")
    .bind(gh.id)
    .first<{ id: number }>();

  let userId: number;
  if (existing) {
    userId = existing.id;
    await db
      .prepare("UPDATE users SET login = ?, avatar_url = ? WHERE id = ?")
      .bind(gh.login, gh.avatar_url ?? null, userId)
      .run();
  } else {
    // Single Owner Mode: akun pertama yang cocok dengan OWNER_GITHUB_LOGIN menjadi pemilik.
    const count = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    const isOwnerLogin = gh.login.toLowerCase() === c.env.OWNER_GITHUB_LOGIN.toLowerCase();
    if ((count?.n ?? 0) > 0 || !isOwnerLogin) {
      await audit(c.env, gh.login, "login_denied");
      return c.redirect("/?error=forbidden");
    }
    const res = await db
      .prepare("INSERT INTO users (github_id, login, avatar_url, created_at) VALUES (?, ?, ?, ?)")
      .bind(gh.id, gh.login, gh.avatar_url ?? null, Date.now())
      .run();
    userId = res.meta.last_row_id;
  }

  const token = randomToken(32);
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), userId, now, now + SESSION_TTL_MS),
  ]);
  await audit(c.env, gh.login, "login");

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.redirect("/", 302);
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const user = await getSessionUser(c);
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(token))
      .run();
    await audit(c.env, user?.login ?? null, "logout");
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
