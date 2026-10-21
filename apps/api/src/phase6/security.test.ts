import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv, Env } from "../env";
import { isSameOrigin, safeEqual } from "../util";
import { auditMiddleware } from "./audit";
import { rateLimit } from "./rate-limit";

/** D1 palsu: cukup untuk SQL yang dipakai middleware Fase 6. */
function fakeDb(opts: { failRateLimit?: boolean } = {}) {
  const counters = new Map<string, number>();
  const auditRows: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first() {
          if (sql.includes("p6_rate_limits")) {
            if (opts.failRateLimit) throw new Error("db down");
            const k = `${args[0]}|${args[1]}`;
            const n = (counters.get(k) ?? 0) + 1;
            counters.set(k, n);
            return { count: n };
          }
          return null;
        },
        async run() {
          if (sql.includes("p6_audit_log")) auditRows.push(args);
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { db, auditRows };
}

function makeApp() {
  const app = new Hono<AppEnv>();
  app.use("/api/*", auditMiddleware);
  app.use("/api/*", rateLimit({ name: "api", limit: 3, windowSec: 60 }));
  app.use(
    "/api/*",
    rateLimit({ name: "write", limit: 2, windowSec: 60, methods: ["POST"] }),
  );
  app.use("/api/*", async (c, next) => {
    if (c.req.header("X-Test-User")) c.set("user", { id: 1, login: "owner", avatarUrl: null });
    await next();
  });
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.post("/api/tasks", (c) => c.json({ ok: true }, 201));
  app.get("/api/secret", (c) => c.json({ error: "unauthorized" }, 401));
  return app;
}

const envOf = (db: unknown) => ({ DB: db }) as unknown as Env;
const ip = (v: string) => ({ "CF-Connecting-IP": v });

describe("CSRF (isSameOrigin)", () => {
  const requestUrl = "https://app.example.dev/api/tasks";
  it("menerima origin yang sama", () => {
    expect(isSameOrigin({ origin: "https://app.example.dev", secFetchSite: null, requestUrl })).toBe(true);
  });
  it("menolak origin lain", () => {
    expect(isSameOrigin({ origin: "https://evil.example", secFetchSite: null, requestUrl })).toBe(false);
  });
  it("menolak subdomain atau skema berbeda", () => {
    expect(isSameOrigin({ origin: "http://app.example.dev", secFetchSite: null, requestUrl })).toBe(false);
    expect(isSameOrigin({ origin: "https://x.app.example.dev", secFetchSite: null, requestUrl })).toBe(false);
  });
  it("tanpa Origin hanya menerima Sec-Fetch-Site same-origin", () => {
    expect(isSameOrigin({ origin: null, secFetchSite: "same-origin", requestUrl })).toBe(true);
    expect(isSameOrigin({ origin: null, secFetchSite: "cross-site", requestUrl })).toBe(false);
    expect(isSameOrigin({ origin: null, secFetchSite: null, requestUrl })).toBe(false);
  });
});

describe("safeEqual", () => {
  it("membandingkan dengan benar", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("rate limit", () => {
  it("menolak request setelah batas dengan 429 dan Retry-After", async () => {
    const { db } = fakeDb();
    const app = makeApp();
    const env = envOf(db);
    for (let i = 0; i < 3; i++) {
      const ok = await app.request("/api/ping", { headers: ip("1.1.1.1") }, env);
      expect(ok.status).toBe(200);
    }
    const res = await app.request("/api/ping", { headers: ip("1.1.1.1") }, env);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
  });

  it("IP berbeda dihitung terpisah", async () => {
    const { db } = fakeDb();
    const app = makeApp();
    const env = envOf(db);
    for (let i = 0; i < 4; i++) await app.request("/api/ping", { headers: ip("2.2.2.2") }, env);
    const other = await app.request("/api/ping", { headers: ip("3.3.3.3") }, env);
    expect(other.status).toBe(200);
  });

  it("batas tulis hanya menghitung POST, bukan GET", async () => {
    const { db } = fakeDb();
    const app = makeApp();
    const env = envOf(db);
    const post = () => app.request("/api/tasks", { method: "POST", headers: ip("4.4.4.4") }, env);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
  });

  it("DB error tidak mematikan API (fail-open)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ failRateLimit: true });
    const res = await makeApp().request("/api/ping", { headers: ip("5.5.5.5") }, envOf(db));
    expect(res.status).toBe(200);
    spy.mockRestore();
  });
});

describe("audit log", () => {
  it("mencatat POST dengan actor, tanpa query dan body", async () => {
    const { db, auditRows } = fakeDb();
    const app = makeApp();
    const res = await app.request(
      "/api/tasks?token=RAHASIA-QUERY",
      {
        method: "POST",
        headers: { ...ip("6.6.6.6"), "X-Test-User": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "RAHASIA-BODY" }),
      },
      envOf(db),
    );
    expect(res.status).toBe(201);
    expect(auditRows).toHaveLength(1);
    const [, actor, addr, method, path, status] = auditRows[0] as [number, string, string, string, string, number];
    expect(actor).toBe("owner");
    expect(addr).toBe("6.6.6.6");
    expect(method).toBe("POST");
    expect(path).toBe("/api/tasks");
    expect(status).toBe(201);
    expect(JSON.stringify(auditRows)).not.toContain("RAHASIA");
  });

  it("mencatat penolakan 401 dan 429", async () => {
    const { db, auditRows } = fakeDb();
    const app = makeApp();
    const env = envOf(db);
    await app.request("/api/secret", { headers: ip("7.7.7.7") }, env);
    for (let i = 0; i < 4; i++) await app.request("/api/ping", { headers: ip("8.8.8.8") }, env);
    const statuses = auditRows.map((r) => r[5]);
    expect(statuses).toContain(401);
    expect(statuses).toContain(429);
  });

  it("tidak mencatat GET sukses", async () => {
    const { db, auditRows } = fakeDb();
    await makeApp().request("/api/ping", { headers: ip("9.9.9.9") }, envOf(db));
    expect(auditRows).toHaveLength(0);
  });
});
