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
let prBodies: string[];
let fixText: string;
let fixResults: string[]; // kesimpulan CI untuk commit perbaikan ke-1, ke-2, ...
let fixCalls: number;
let commits: { branch: string; message: string }[];
let comments: string[];
let fixRuns: { sha: string; conclusion: string }[];
let prOpened: boolean;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const FIXED = `TITLE: Hapus rujukan rusak
SUMMARY: Rujukan ke file yang tidak ada dihapus
=== FILE: index.html ===
<h1>Kopi</h1>
=== END FILE ===`;

const GOOD = `TITLE: Landing kopi
SUMMARY: Halaman statis
=== FILE: index.html ===
<h1>Kopi</h1>
=== END FILE ===`;

beforeEach(() => {
  ghCalls = [];
  prBodies = [];
  ci = { status: "completed", conclusion: "success" };
  devText = GOOD;
  fixText = FIXED;
  fixResults = ["success"];
  fixCalls = 0;
  commits = [];
  comments = [];
  fixRuns = [];
  prOpened = false;
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
        const sys = messages[0]?.content ?? "";
        const isFix = sys.includes("MODE PERBAIKAN");
        if (isFix) fixCalls++;
        const isDev = sys.includes("=== FILE:");
        return json({
          model: "m",
          choices: [{ message: { content: isFix ? fixText : isDev ? devText : "OUT-text" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }
      ghCalls.push(`${method} ${url.replace("https://api.github.com", "")}`);
      if (url.includes("/access_tokens")) return json({ token: "t", expires_at: "2099-01-01T00:00:00Z", permissions: {} });
      if (url.includes("/git/trees/")) return json({ tree: [{ path: "README.md", type: "blob" }] });
      if (url.includes("/git/ref/heads/")) return json({ object: { sha: "abc" } });
      if (url.includes("/contents/") && method === "GET") {
        if (!prOpened) return json({ message: "Not Found" }, 404);
        return json({ type: "file", encoding: "base64", content: btoa("<h1>Kopi</h1>\n"), sha: "b1" });
      }
      if (url.includes("/contents/") && method === "PUT") {
        const b = JSON.parse(init?.body as string) as { branch: string; message: string };
        commits.push({ branch: b.branch, message: b.message });
        if (!b.message.startsWith("agent: perbaikan CI") && !b.message.startsWith("agent: uji")) {
          return json({ commit: { sha: "init-sha" } });
        }
        const sha = `fix-sha-${fixRuns.length + 1}`;
        fixRuns.push({ sha, conclusion: fixResults[fixRuns.length] ?? "success" });
        return json({ commit: { sha } });
      }
      if (url.endsWith("/pulls") && method === "POST") {
        prOpened = true;
        prBodies.push((JSON.parse(init?.body as string) as { body: string }).body);
        return json({ number: 5, html_url: "https://github.com/baladikarya/demo-landing/pull/5" });
      }
      if (url.includes("/pulls/5/files")) return json([{ filename: "index.html", status: "added" }]);
      if (url.includes("/issues/5/comments")) {
        comments.push((JSON.parse(init?.body as string) as { body: string }).body);
        return json({});
      }
      if (url.includes("/actions/runs/") && url.includes("/jobs")) {
        return json({ jobs: [{ id: 9, name: "test", conclusion: "failure", steps: [{ name: "Run npm test", conclusion: "failure" }] }] });
      }
      if (url.includes("/actions/jobs/9/logs")) {
        return new Response("2026-10-23T01:00:00.123Z ##[error]GAGAL: index.html merujuk repair-drill-missing.html yang tidak ada\n2026-10-23T01:00:01.000Z ##[error]Process completed with exit code 1.", { status: 200 });
      }
      if (url.includes("/actions/runs")) {
        const runs = [] as unknown[];
        if (ci !== "none") {
          runs.push({ id: 100, head_sha: "init-sha", name: "CI", workflow_id: 1, status: ci.status, conclusion: ci.conclusion, html_url: "https://x/run", created_at: "2026-10-22T01:00:00Z" });
        }
        fixRuns.forEach((r, i) =>
          runs.push({ id: 101 + i, head_sha: r.sha, name: "CI", workflow_id: 1, status: "completed", conclusion: r.conclusion, html_url: `https://x/run${i}`, created_at: `2026-10-22T01:0${i + 1}:00Z` }),
        );
        return json({ workflow_runs: runs });
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

  it("badan PR memuat peringatan untuk rujukan file hilang dan form eksternal", async () => {
    devText = `TITLE: Landing\nSUMMARY: s\n=== FILE: index.html ===\n<link href="style.css"><form action="https://formspree.io/f/zzz"></form>\n=== END FILE ===`;
    const id = await toDevStep();
    await waitStatus(id, "completed");
    const prCall = prBodies[0] ?? "";
    expect(prCall).toContain("Peringatan otomatis");
    expect(prCall).toContain("style.css");
    expect(prCall).toContain("formspree");
  });

  it("CI gagal -> 1 perbaikan otomatis ke PR yang sama -> CI lulus -> selesai", async () => {
    ci = { status: "completed", conclusion: "failure" };
    const id = await toDevStep();
    const d = await waitStatus(id, "completed");
    expect(d.steps.map((s) => s.status)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(d.steps[3]?.output).toContain("CI LULUS");
    expect(d.steps[3]?.output).toContain("Perbaikan otomatis 1/2");
    expect(fixCalls).toBe(1);

    // commit perbaikan ke branch PR yang sama, tanpa PR kedua, tanpa merge, tanpa menyentuh main
    const fixCommits = commits.filter((c) => c.message.startsWith("agent: perbaikan CI 1/2"));
    expect(fixCommits).toHaveLength(1);
    expect(fixCommits[0]?.branch).toMatch(/^agent\/run-[a-z0-9]{8}-a1$/);
    expect(commits.every((c) => c.branch !== "main")).toBe(true);
    expect(ghCalls.filter((c) => c.startsWith("POST") && c.endsWith("/pulls"))).toHaveLength(1);
    expect(ghCalls.some((c) => c.includes("/merge"))).toBe(false);
    expect(comments.some((c) => c.includes("Perbaikan otomatis 1/2"))).toBe(true);

    // token perbaikan tercatat apa adanya dari penyedia
    const rows = env.DB.raw.prepare("SELECT total_tokens, step_idx FROM p3_usage_logs WHERE agent = 'developer-fix'").all();
    expect(rows).toEqual([{ total_tokens: 15, step_idx: 3 }]);
    const ev = env.DB.raw.prepare("SELECT message FROM p3_events WHERE type = 'repair'").all() as { message: string }[];
    expect(ev.map((e) => e.message).join("|")).toContain("Perbaikan 1/2");
  });

  it("perbaikan tidak berhasil 2x -> berhenti dan lapor (tanpa perbaikan ke-3)", async () => {
    ci = { status: "completed", conclusion: "failure" };
    fixResults = ["failure", "failure"];
    const id = await toDevStep();
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toContain("Batas 2 perbaikan otomatis");
    expect(d.run.error).toContain("berhenti dan lapor");
    expect(d.steps.map((s) => s.status)).toEqual(["completed", "completed", "completed", "failed"]);
    expect(fixCalls).toBe(2);
    expect(commits.filter((c) => c.message.startsWith("agent: perbaikan CI"))).toHaveLength(2);
    expect(comments.some((c) => c.includes("Perbaikan otomatis berhenti"))).toBe(true);
  });

  it("batas token per alur menahan perbaikan berikutnya", async () => {
    env.MAX_REPAIR_TOKENS_PER_RUN = "10";
    ci = { status: "completed", conclusion: "failure" };
    fixResults = ["failure", "failure"];
    const id = await toDevStep();
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toContain("token perbaikan per alur");
    expect(fixCalls).toBe(1);
  });

  it("Retry setelah berhenti: tidak ada perbaikan baru, hanya cek CI lagi", async () => {
    ci = { status: "completed", conclusion: "failure" };
    fixResults = ["failure", "failure"];
    const id = await toDevStep();
    await waitStatus(id, "failed");
    const before = fixCalls;

    const last = fixRuns[fixRuns.length - 1];
    if (last) last.conclusion = "success"; // pemilik memperbaiki manual di GitHub
    expect((await call(`/${id}/retry`, "POST")).status).toBe(200);
    await waitStatus(id, "completed");
    expect(fixCalls).toBe(before);
    expect(ghCalls.filter((c) => c.startsWith("POST") && c.endsWith("/pulls"))).toHaveLength(1);
  });

  it("jawaban perbaikan tidak valid -> berhenti dan lapor, token tetap tercatat", async () => {
    ci = { status: "completed", conclusion: "failure" };
    fixText = "maaf tidak bisa";
    const id = await toDevStep();
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toContain("Jawaban perbaikan tidak valid");
    expect(commits.some((c) => c.message.startsWith("agent: perbaikan CI"))).toBe(false);
    expect(comments.some((c) => c.includes("Perbaikan otomatis berhenti"))).toBe(true);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM p3_usage_logs WHERE agent = 'developer-fix'").get()).toEqual({ n: 1 });
  });

  it("perbaikan yang menyentuh .github ditolak (tanpa commit)", async () => {
    ci = { status: "completed", conclusion: "failure" };
    fixText = `TITLE: x\nSUMMARY: y\n=== FILE: .github/workflows/ci.yml ===\nname: a\n=== END FILE ===`;
    const id = await toDevStep();
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toContain("Jawaban perbaikan tidak valid");
    expect(commits.some((c) => c.message.startsWith("agent: perbaikan CI"))).toBe(false);
  });

  it("REPAIR_DRILL=true: PR sengaja dirusak sekali, lalu diperbaiki otomatis", async () => {
    env.REPAIR_DRILL = "true";
    fixResults = ["failure", "success"]; // commit uji gagal, commit perbaikan lulus
    const id = await toDevStep();
    const d = await waitStatus(id, "completed");
    expect(d.steps[3]?.output).toContain("Perbaikan otomatis 1/2");
    expect(commits.filter((c) => c.message.startsWith("agent: uji perbaikan"))).toHaveLength(1);
    expect(fixCalls).toBe(1);
    expect(comments.some((c) => c.includes("Uji perbaikan"))).toBe(true);
  });

  it("tanpa REPAIR_DRILL tidak ada commit uji", async () => {
    const id = await toDevStep();
    await waitStatus(id, "completed");
    expect(commits.some((c) => c.message.startsWith("agent: uji"))).toBe(false);
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
