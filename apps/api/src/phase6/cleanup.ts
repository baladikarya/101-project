import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

export const RATE_LIMIT_RETENTION_SEC = 60 * 60; // 1 jam
export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 hari
export const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // paling sering tiap 12 jam

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function cutoffs(nowMs: number): { rateLimitBeforeSec: number; auditBeforeMs: number } {
  return {
    rateLimitBeforeSec: Math.floor(nowMs / 1000) - RATE_LIMIT_RETENTION_SEC,
    auditBeforeMs: nowMs - AUDIT_RETENTION_MS,
  };
}

export interface CleanupResult {
  rateLimitsDeleted: number;
  auditDeleted: number;
}

export async function runCleanup(db: D1Database, nowMs: number): Promise<CleanupResult> {
  const c = cutoffs(nowMs);
  const rl = await db.prepare("DELETE FROM p6_rate_limits WHERE window_start < ?1").bind(c.rateLimitBeforeSec).run();
  const au = await db.prepare("DELETE FROM p6_audit_log WHERE ts < ?1").bind(c.auditBeforeMs).run();
  return {
    rateLimitsDeleted: rl.meta?.changes ?? 0,
    auditDeleted: au.meta?.changes ?? 0,
  };
}

/** Klaim giliran bersih-bersih secara atomik: hanya satu request yang menang per interval. */
async function claimCleanup(db: D1Database, nowMs: number): Promise<boolean> {
  const row = await db
    .prepare(
      "INSERT INTO p6_meta (key, value) VALUES ('last_cleanup', ?1) " +
        "ON CONFLICT(key) DO UPDATE SET value = ?1 WHERE value < ?2 RETURNING value",
    )
    .bind(nowMs, nowMs - CLEANUP_INTERVAL_MS)
    .first();
  return row !== null;
}

/** Pembersihan malas: dipicu request tulis, berjalan di latar belakang, tanpa Cron/konfigurasi tambahan. */
export const cleanupMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!MUTATING.has(c.req.method)) return;

  const job = (async () => {
    try {
      const now = Date.now();
      if (!(await claimCleanup(c.env.DB, now))) return;
      const r = await runCleanup(c.env.DB, now);
      console.log("cleanup", JSON.stringify(r));
    } catch (err) {
      console.error("cleanup: error", err);
    }
  })();

  try {
    c.executionCtx.waitUntil(job);
  } catch {
    await job;
  }
};

/** GET /api/maintenance — status pembersihan (khusus pemilik). */
export const maintenanceRoutes = new Hono<AppEnv>();

maintenanceRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const meta = await db.prepare("SELECT value FROM p6_meta WHERE key = 'last_cleanup'").first<{ value: number }>();
  const rl = await db.prepare("SELECT COUNT(*) AS n FROM p6_rate_limits").first<{ n: number }>();
  const au = await db.prepare("SELECT COUNT(*) AS n FROM p6_audit_log").first<{ n: number }>();
  return c.json({
    lastCleanup: meta?.value ?? null,
    rows: { rateLimits: rl?.n ?? 0, audit: au?.n ?? 0 },
    retention: {
      rateLimitSec: RATE_LIMIT_RETENTION_SEC,
      auditDays: AUDIT_RETENTION_MS / 86_400_000,
      intervalHours: CLEANUP_INTERVAL_MS / 3_600_000,
    },
  });
});
