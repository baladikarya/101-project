import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRoutes } from "../src/phase3/routes";
import { PipelineRunWorkflow } from "../src/phase3/workflow";
import { makeD1, makeWorkflowBinding, waitFor } from "./testkit";

type Env = Record<string, unknown> & { DB: ReturnType<typeof makeD1> };
let env: Env;
let ghCalls: string[];
let ci: { status: string; conclusion: string | null } | "none";
let devText: string;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const GOOD = `TITLE: Landing kopi
SUMMARY: Halaman statis
=== FILE: index.html ===
<h1>Kopi</h1>
=== END FILE ===`;

beforeEach(() => {
  ghCalls = [];
  ci = { status: "completed", conclusion: "success" };
  devText = GOOD;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  env = {
    DB: makeD1(),
    GROQ_API_KEY: "k",
    GITHUB_APP_ID: "1",
    GITHUB_APP_INSTALLATION_ID: "2",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  } as Env;
  env.RUN_WORKFLOW = makeWorkflowBinding(() => env, PipelineRunWorkflow as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("api.groq.com")) {
        const { messages } = JSON.parse(init?.body as string) as { messages: { content: string }[] };
        const isDev = (messages[0]?.content ?? "").includes("=== FILE:");
        return json({
          model: "m",
          choices: [{ message: { content: isDev ? devText : "OUT-text" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }
      ghCalls.push(`${method} ${url.replace("https://api.github.com", "")}`);
      if (url.includes("/access_tokens")) return json({ token: "t", expires_at: "2099-01-01T00:00:00Z", permissions: {} });
      if (url.includes("/git/trees/")) return json({ tree: [{ path: "README.md", type: "blob" }] });
      if (url.includes("/git/ref/heads/")) return json({ object: { sha: "abc" } });
      if (url.includes("/contents/") && method === "GET") return json({ message: "Not Found" }, 404);
      if (url.endsWith("/pulls")) return json({ number: 5, html_url: "https://github.com/baladikarya/demo-landing/pull/5" });
      if (url.includes("/actions/runs")) {
        if (ci === "none") return json({ workflow_runs: [] });
        return json({
          workflow_runs: [
            { name: "CI", workflow_id: 1, status: ci.status, conclusion: ci.conclusion, html_url: "https://x/run", created_at: "2026-10-22T01:00:00Z" },
          ],
        });
      }
      return json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const call = (path: string, method = "GET", body?: unknown) =>
  runRoutes.request(
    path,
    { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) },
    env as never,
  );
type Detail = {
  run: { status: string; error: string | null; pr_url: string | null; pr_number: number | null; project: string | null; branch: string | null };
  steps: { status: string; output: string | null; error: string | null; total_tokens: number | null }[];
};
const detail = async (id: string) => (await (await call(`/${id}`)).json()) as Detail;
const waitStatus = (id: string, s: string) => waitFor(() => detail(id), (d) => d.run.status === s);

async function start(project: string | null = "demo-landing") {
  const res = await call("/", "POST", { goal: "Landing page kopi sederhana", template: "build", ...(project ? { project } : {}) });
  return res;
}

async function toDevStep() {
  const res = await start();
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await waitStatus(id, "awaiting_approval");
  expect((await call(`/${id}/approve`, "POST")).status).toBe(200);
  return id;
}

describe("alur build: Analyst → Architect → Developer (PR) → QA (cek CI)", () => {
  it("1 run = 1 PR di repo target, CI lulus, selesai", async () => {
    const id = await toDevStep();
    const d = await waitStatus(id, "completed");
    expect(d.steps.map((s) => s.status)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(d.run).toMatchObject({ pr_number: 5, project: "demo-landing" });
    expect(d.run.pr_url).toContain("/pull/5");
    expect(d.run.branch).toMatch(/^agent\/run-[a-z0-9]{8}-a1$/);
    expect(d.steps[2]?.output).toContain("Pull Request #5");
    expect(d.steps[2]?.total_tokens).toBe(15);
    expect(d.steps[3]?.output).toContain("CI LULUS");
    expect(d.steps[3]?.total_tokens).toBeNull();

    // tepat satu PR, hanya ke repo target, tidak ada merge
    expect(ghCalls.filter((c) => c.endsWith("/pulls") && c.startsWith("POST"))).toHaveLength(1);
    expect(ghCalls.every((c) => !c.includes("101-project") || c.includes("access_tokens"))).toBe(true);
    expect(ghCalls.some((c) => c.includes("/merge"))).toBe(false);

    const hist = env.DB.raw.prepare("SELECT project, status, pr_number FROM p5_code_tasks").all();
    expect(hist).toEqual([{ project: "demo-landing", status: "pr_open", pr_number: 5 }]);
  });

  it("CI gagal -> run gagal; Retry hanya cek CI lagi (tanpa PR baru)", async () => {
    ci = { status: "completed", conclusion: "failure" };
    const id = await toDevStep();
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toContain("CI GAGAL");
    expect(d.steps.map((s) => s.status)).toEqual(["completed", "completed", "completed", "failed"]);

    ci = { status: "completed", conclusion: "success" };
    expect((await call(`/${id}/retry`, "POST")).status).toBe(200);
    await waitStatus(id, "completed");
    expect(ghCalls.filter((c) => c.startsWith("POST") && c.endsWith("/pulls"))).toHaveLength(1);
  });

  it("tanpa workflow CI di repo target -> gagal dengan petunjuk", async () => {
    ci = "none";
    const id = await toDevStep();
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toMatch(/workflow CI/);
  });

  it("jawaban Developer salah format -> gagal tanpa PR", async () => {
    devText = "maaf tidak bisa";
    const id = await toDevStep();
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toMatch(/Developer tidak valid/);
    expect(ghCalls.some((c) => c.endsWith("/pulls"))).toBe(false);
  });

  it("file terlarang (.github) ditolak sebelum PR", async () => {
    devText = `TITLE: x\nSUMMARY: y\n=== FILE: .github/workflows/a.yml ===\nname: a\n=== END FILE ===`;
    const id = await toDevStep();
    await waitStatus(id, "failed");
    expect(ghCalls.some((c) => c.endsWith("/pulls"))).toBe(false);
  });
});

describe("validasi pembuatan alur build", () => {
  it("wajib proyek", async () => expect((await start(null)).status).toBe(400));
  it("proyek tak dikenal", async () => expect((await start("tidak-ada")).status).toBe(400));
  it("proyek self (101-project) ditolak", async () => expect((await start("101-project")).status).toBe(400));
  it("proyek diarsipkan ditolak", async () => {
    env.DB.raw.exec("UPDATE p7_projects SET status='archived' WHERE name='demo-landing'");
    expect((await start()).status).toBe(400);
  });
  it("batas harian tugas coding -> 429", async () => {
    env.MAX_CODE_TASKS_PER_DAY = "1";
    const now = Date.now();
    env.DB.raw.exec(
      `INSERT INTO p5_code_tasks (id, instruction, status, created_at, updated_at) VALUES ('x','x','pr_open',${now},${now})`,
    );
    expect((await start()).status).toBe(429);
  });
  it("GitHub App belum diset -> 500", async () => {
    delete env.GITHUB_APP_ID;
    expect((await start()).status).toBe(500);
  });
  it("template lain tidak butuh proyek dan tidak menyimpannya", async () => {
    const res = await call("/", "POST", { goal: "Bangun aplikasi catatan sederhana", template: "standard", project: "demo-landing" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await detail(id)).run.project).toBeNull();
  });
});
