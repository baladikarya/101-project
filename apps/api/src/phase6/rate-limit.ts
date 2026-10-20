import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

/** Awal jendela waktu (detik) tempat `nowSec` berada. */
export function windowStartSec(nowSec: number, windowSec: number): number {
  return Math.floor(nowSec / windowSec) * windowSec;
}

/** Pengenal klien: IP dari Cloudflare, atau "unknown". */
export function clientId(ip: string | null | undefined): string {
  const v = (ip ?? "").trim();
  return v.length > 0 && v.length <= 64 ? v : "unknown";
}

export interface RateLimitOptions {
  name: string;
  limit: number;
  windowSec: number;
  /** Jika diisi, hanya metode ini yang dihitung. */
  methods?: string[];
}

/** Rate limit per klien per jendela tetap, disimpan di D1 (tabel p6_rate_limits). */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (opts.methods && !opts.methods.includes(c.req.method)) {
      await next();
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const ws = windowStartSec(nowSec, opts.windowSec);
    const key = `${opts.name}:${clientId(c.req.header("CF-Connecting-IP"))}`;

    let count: number;
    try {
      const row = await c.env.DB.prepare(
        "INSERT INTO p6_rate_limits (key, window_start, count) VALUES (?1, ?2, 1) " +
          "ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count",
      )
        .bind(key, ws)
        .first<{ count: number }>();
      count = row?.count ?? 0;
    } catch (err) {
      // Gagal DB tidak boleh mematikan seluruh API.
      console.error("rate-limit: db error", err);
      await next();
      return;
    }

    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.limit - count)));

    if (count > opts.limit) {
      const retryAfterSec = Math.max(1, ws + opts.windowSec - nowSec);
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "rate_limited", retryAfterSec }, 429);
    }
    await next();
  };
}
