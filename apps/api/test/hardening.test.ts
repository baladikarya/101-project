// Uji Fase 6 pada app Hono asli (index.ts) dengan D1 palsu: auth, CSRF, rate limit, audit, pembersihan.
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { runCleanup } from "../src/phase6/cleanup";
import { sha256Hex } from "../src/util";
import { makeD1 } from "./testkit";

let db: ReturnType<typeof makeD1>;
let env: Record<string, unknown>;
let seq = 0;
const freshIp = () => `10.0.${Math.floor(++seq / 250)}.${seq % 250}`;

beforeEach(() => {
  db = makeD1();
  env = { DB: db, OWNER_GITHUB_LOGIN: "owner", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec" };
});

async function login(): Promise<string> {
  const token = "token-uji-" + freshIp();
  const now = Date.now();
  db.raw.exec(`INSERT OR IGNORE INTO users (id, github_id, login, created_at) VALUES (1, 1, 'owner', ${now})`);
  db.raw.exec(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('${await sha256Hex(token)}', 1, ${now}, ${now + 3_600_000})`,
  );
  return `session=${token}`;
}

const req = (path: string, init: RequestInit & { ip?: string } = {}) => {
  const { ip, ...rest } = init;
  return app.request(path, { ...rest, headers: { "CF-Connecting-IP": ip ?? freshIp(), ...(rest.headers as object) } }, env as never);
};
const count = (table: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("akses tanpa login", () => {
  it.each(["/api/audit", "/api/maintenance", "/api/tasks", "/api/runs", "/api/office", "/api/code-tasks", "/api/github/status", "/api/projects"])(
    "%s -> 401",
    async (path) => {
      const res = await req(path);
      expect(res.status).toBe(401);
    },
  );

  it("sesi kedaluwarsa ditolak", async () => {
    const now = Date.now();
    db.raw.exec(`INSERT INTO users (id, github_id, login, created_at) VALUES (1, 1, 'owner', ${now})`);
    db.raw.exec(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('${await sha256Hex("lama")}', 1, ${now - 9000}, ${now - 1000})`,
    );
    const res = await req("/api/audit", { headers: { Cookie: "session=lama" } });
    expect(res.status).toBe(401);
  });

  it("health tetap terbuka dan memakai header keamanan", async () => {
    const res = await req("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("CSRF", () => {
  it("POST dari origin asing -> 403 dan tercatat di audit", async () => {
    const ip = freshIp();
    const res = await req("/api/tasks", { method: "POST", ip, headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    const row = db.raw.prepare("SELECT method, path, status, actor, ip FROM p6_audit_log").get() as Record<string, unknown>;
    expect(row).toMatchObject({ method: "POST", path: "/api/tasks", status: 403, actor: null, ip });
  });
});

describe("rate limit pada app asli", () => {
  it("endpoint auth: request ke-31 dalam semenit -> 429", async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) {
      const ok = await req("/api/auth/github/login", { ip });
      expect(ok.status).toBe(302);
    }
    const res = await req("/api/auth/github/login", { ip });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
  });

  it("banjir 429 dari satu IP hanya mencatat satu baris audit", async () => {
    const ip = freshIp();
    for (let i = 0; i < 45; i++) await req("/api/auth/github/login", { ip });
    const rejected = db.raw.prepare("SELECT COUNT(*) AS n FROM p6_audit_log WHERE status = 429").get() as { n: number };
    expect(rejected.n).toBe(1);
  });

  it("IP lain tidak ikut terblokir", async () => {
    const a = freshIp();
    for (let i = 0; i < 31; i++) await req("/api/auth/github/login", { ip: a });
    const other = await req("/api/auth/github/login", { ip: freshIp() });
    expect(other.status).toBe(302);
  });
});

describe("audit log", () => {
  it("pemilik bisa membaca jejak audit, tanpa body atau query", async () => {
    const cookie = await login();
    await req("/api/tasks?token=RAHASIA", { headers: { Cookie: "session=salah" } }); // 401
    await req("/api/tasks", { method: "POST", headers: { Origin: "https://evil.example" }, body: "RAHASIA-BODY" }); // 403
    const res = await req("/api/audit?limit=10", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ status: number }>; nextBefore: number | null };
    expect(body.items.map((i) => i.status).sort()).toEqual([401, 403]);
    expect(JSON.stringify(body)).not.toContain("RAHASIA");
  });

  it("limit dibatasi maksimum 200", async () => {
    const cookie = await login();
    const res = await req("/api/audit?limit=99999", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});

describe("pembersihan data", () => {
  const DAY = 86_400_000;

  function seedOldAndNew() {
    const now = Date.now();
    db.raw.exec(`
      INSERT INTO p6_audit_log (ts, method, path, status) VALUES (${now - 100 * DAY}, 'POST', '/lama', 200), (${now}, 'POST', '/baru', 200);
      INSERT INTO p6_rate_limits (key, window_start, count) VALUES ('x', ${Math.floor(now / 1000) - 7200}, 5), ('y', ${Math.floor(now / 1000)}, 1);
      INSERT INTO audit_logs (ts, actor, action) VALUES (${now - 100 * DAY}, 'a', 'lama'), (${now}, 'a', 'baru');
      INSERT INTO users (id, github_id, login, created_at) VALUES (1, 1, 'owner', ${now});
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('s1', 1, ${now - 9 * DAY}, ${now - DAY}), ('s2', 1, ${now}, ${now + DAY});
      INSERT INTO p2_tasks (id, title, prompt, status, created_at, updated_at) VALUES ('t', 'T', 'p', 'completed', ${now - 90 * DAY}, ${now - 90 * DAY});
      INSERT INTO p2_task_events (id, task_id, type, message, created_at) VALUES ('e1', 't', 'x', 'm', ${now - 40 * DAY}), ('e2', 't', 'x', 'm', ${now});
    `);
  }

  it("runCleanup menghapus data lama dan mempertahankan yang baru", async () => {
    seedOldAndNew();
    const r = await runCleanup(db as never, Date.now());
    expect(r.rateLimitsDeleted).toBe(1);
    expect(r.auditDeleted).toBe(1);
    expect(r.legacy).toMatchObject({ sessions: 1, audit_logs: 1, p2_task_events: 1 });
    expect(count("p6_audit_log")).toBe(1);
    expect(count("p6_rate_limits")).toBe(1);
    expect(count("sessions")).toBe(1);
    expect(count("p2_task_events")).toBe(1);
    expect(count("p2_tasks")).toBe(1); // data utama tidak disentuh
  });

  it("request tulis memicu pembersihan malas sekali per interval", async () => {
    seedOldAndNew();
    const post = () => req("/api/auth/logout", { method: "POST", headers: { Origin: "http://localhost" } });
    expect((await post()).status).toBe(200);
    const meta = db.raw.prepare("SELECT value FROM p6_meta WHERE key = 'last_cleanup'").get() as { value: number };
    expect(meta.value).toBeGreaterThan(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM p6_audit_log WHERE path = '/lama'").get()).toMatchObject({ n: 0 });
    const first = meta.value;
    await post();
    const again = db.raw.prepare("SELECT value FROM p6_meta WHERE key = 'last_cleanup'").get() as { value: number };
    expect(again.value).toBe(first);
  });
});
