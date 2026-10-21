import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { clientId, repeatRejections } from "./rate-limit";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Request yang dicatat: semua perubahan data, semua /api/auth/*, dan semua penolakan (401/403/429). */
export function shouldAudit(method: string, path: string, status: number): boolean {
  if (MUTATING.has(method)) return true;
  if (path.startsWith("/api/auth/")) return true;
  return status === 401 || status === 403 || status === 429;
}

export function clampLimit(raw: string | undefined, def = 50, max = 200): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

/** Catat jejak audit: siapa, apa, kapan, hasil. Isi request (body/query) tidak pernah disimpan. */
export const auditMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  await next();

  const method = c.req.method;
  const path = c.req.path.slice(0, 200);
  const status = c.res.status;
  if (!shouldAudit(method, path, status)) return;
  // Penolakan 429 berulang dari klien yang sama cukup tercatat sekali per jendela.
  if (repeatRejections.has(c.req.raw)) return;

  const actor = c.get("user")?.login ?? null;
  const ip = clientId(c.req.header("CF-Connecting-IP"));
  const write = c.env.DB.prepare(
    "INSERT INTO p6_audit_log (ts, actor, ip, method, path, status, ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(started, actor, ip, method, path, status, Date.now() - started)
    .run()
    .catch((err: unknown) => console.error("audit: db error", err));

  try {
    c.executionCtx.waitUntil(write);
  } catch {
    await write;
  }
};

/** GET /api/audit?limit=50&before=<id> — khusus pemilik. */
export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get("/", async (c) => {
  const limit = clampLimit(c.req.query("limit"));
  const beforeRaw = Number.parseInt(c.req.query("before") ?? "", 10);
  const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : Number.MAX_SAFE_INTEGER;
  const { results } = await c.env.DB.prepare(
    "SELECT id, ts, actor, ip, method, path, status, ms FROM p6_audit_log WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
  )
    .bind(before, limit)
    .all();
  const items = results ?? [];
  const last = items[items.length - 1] as { id: number } | undefined;
  return c.json({ items, nextBefore: items.length === limit && last ? last.id : null });
});
