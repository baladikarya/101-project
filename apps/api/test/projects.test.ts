import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeRoutes } from "../src/phase5/code-routes";
import { githubRoutes } from "../src/phase5/github";
import { openPullRequest, readRepoFile } from "../src/phase5/pr";
import { getProject, listProjects } from "../src/phase7/projects";
import { projectRoutes } from "../src/phase7/routes";
import { makeD1 } from "./testkit";

let db: ReturnType<typeof makeD1>;
beforeEach(() => {
  db = makeD1();
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("p7_projects", () => {
  it("berisi dua proyek awal", async () => {
    const list = await listProjects(db as never);
    expect(list.map((p) => [p.name, p.repo, p.worker, p.status, p.kind])).toEqual([
      ["101-project", "baladikarya/101-project", "101-project", "active", "self"],
      ["demo-landing", "baladikarya/demo-landing", "demo-landing", "new", "external"],
    ]);
  });

  it("getProject: nama tak dikenal atau tak valid -> null", async () => {
    expect(await getProject(db as never, "nope")).toBeNull();
    expect(await getProject(db as never, "x' OR 1=1 --")).toBeNull();
    expect((await getProject(db as never, "demo-landing"))?.repo).toBe("baladikarya/demo-landing");
  });

  it("GET /api/projects", async () => {
    const res = await projectRoutes.request("/", {}, { DB: db } as never);
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects).toHaveLength(2);
  });
});

describe("POST /api/code-tasks memilih proyek", () => {
  const post = (body: unknown) =>
    codeRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { DB: db } as never,
    );
  const ok = { instruction: "buat halaman landing sederhana", paths: [] };

  it("tanpa project -> 400", async () => {
    const res = await post(ok);
    expect(res.status).toBe(400);
  });

  it("project tak dikenal -> 400 step project", async () => {
    const res = await post({ ...ok, project: "tidak-ada" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { step: string }).step).toBe("project");
  });

  it("project diarsipkan -> 400", async () => {
    db.raw.exec("UPDATE p7_projects SET status='archived' WHERE name='demo-landing'");
    const res = await post({ ...ok, project: "demo-landing" });
    expect(res.status).toBe(400);
  });

  it("path konteks mengikuti scope proyek", async () => {
    const res = await post({ ...ok, project: "101-project", paths: ["index.html"] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { step: string }).step).toBe("validate");
  });
});

describe("PR ke repo pilihan", () => {
  it("openPullRequest dan readRepoFile memakai repo dari input", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/git/ref/heads/")) return json({ object: { sha: "abc" } });
        if (url.includes("/contents/") && (init?.method ?? "GET") === "GET") return json({ message: "Not Found" }, 404);
        if (url.endsWith("/pulls")) return json({ number: 7, html_url: "https://github.com/baladikarya/demo-landing/pull/7" });
        return json({});
      }),
    );
    const pr = await openPullRequest({} as never, {
      repo: "baladikarya/demo-landing",
      title: "t",
      body: "b",
      branch: "agent/x-1",
      files: [{ path: "index.html", content: "<h1>x</h1>" }],
      token: "tok",
    });
    expect(pr.number).toBe(7);
    expect(urls.length).toBeGreaterThan(3);
    expect(urls.every((u) => u.includes("/repos/baladikarya/demo-landing/"))).toBe(true);
    expect(urls.some((u) => u.includes("101-project"))).toBe(false);
    expect(await readRepoFile("tok", "baladikarya/demo-landing", "a.txt", "main")).toBeNull();
  });

  it("menolak nama repo tidak aman", async () => {
    await expect(
      openPullRequest({} as never, { repo: "../x/y", title: "t", body: "b", branch: "agent/x", files: [{ path: "a", content: "" }], token: "t" }),
    ).rejects.toThrow(/repo/);
  });
});

describe("GET /api/github/status", () => {
  it("menampilkan 2 repo; repo tanpa akses ditandai", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/access_tokens")) {
          return json({ token: "t", expires_at: "2099-01-01T00:00:00Z", permissions: { contents: "write" } });
        }
        if (url.endsWith("/repos/baladikarya/101-project")) {
          return json({ full_name: "baladikarya/101-project", private: false, default_branch: "main" });
        }
        return json({ message: "Not Found" }, 404);
      }),
    );
    const env = { DB: db, GITHUB_APP_ID: "1", GITHUB_APP_INSTALLATION_ID: "2", GITHUB_APP_PRIVATE_KEY: pem };
    const res = await githubRoutes.request("/status", {}, env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number; repos: { project: string; ok: boolean; error?: string }[] };
    expect(body.count).toBe(2);
    expect(body.ok).toBe(false);
    expect(body.repos.find((r) => r.project === "101-project")?.ok).toBe(true);
    expect(body.repos.find((r) => r.project === "demo-landing")?.error).toMatch(/di-install/);
    expect(JSON.stringify(body)).not.toContain('"token"');

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/access_tokens")
          ? json({ token: "t", expires_at: "2099-01-01T00:00:00Z", permissions: {} })
          : json({ full_name: url.split("/repos/")[1], private: true, default_branch: "main" }),
      ),
    );
    const ok = (await (await githubRoutes.request("/status", {}, env as never)).json()) as { ok: boolean; count: number };
    expect(ok).toMatchObject({ ok: true, count: 2 });
  });
});
