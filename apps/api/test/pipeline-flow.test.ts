import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SPECS } from "../src/phase3/pipeline";
import { runRoutes } from "../src/phase3/routes";
import { PipelineRunWorkflow } from "../src/phase3/workflow";
import { makeD1, makeWorkflowBinding, waitFor } from "./testkit";

type Env = Record<string, unknown> & { DB: ReturnType<typeof makeD1> };
let env: Env;
let calls: { agent: string; user: string }[];
let failOnCall: number | null;

function agentOf(system: string): string {
  return Object.entries(AGENT_SPECS).find(([, s]) => system.startsWith(s.system))?.[0] ?? "?";
}

beforeEach(() => {
  calls = [];
  failOnCall = null;
  const db = makeD1();
  env = { DB: db, GROQ_API_KEY: "k" } as Env;
  env.RUN_WORKFLOW = makeWorkflowBinding(() => env, PipelineRunWorkflow as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { messages } = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
      const agent = agentOf(messages[0]?.content ?? "");
      calls.push({ agent, user: messages[1]?.content ?? "" });
      if (failOnCall === calls.length) return new Response("unauthorized", { status: 401 });
      return new Response(
        JSON.stringify({
          model: "m-test",
          choices: [{ message: { content: `OUT-${agent}` } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const call = (path: string, method = "GET", body?: unknown) =>
  runRoutes.request(path, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }, env as never);

async function create(template = "standard") {
  const res = await call("/", "POST", { goal: "Bangun aplikasi catatan sederhana", template });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
const detail = async (id: string) => (await (await call(`/${id}`)).json()) as { run: { status: string; error: string | null }; steps: { status: string; output: string | null; total_tokens: number | null }[]; events: { message: string }[] };
const waitStatus = (id: string, status: string) => waitFor(() => detail(id), (d) => d.run.status === status);

describe("alur multi-agent end-to-end (Workflow asli, D1 & fetch palsu)", () => {
  it("Analyst → Architect → Backend → QA berjalan sampai selesai dengan dua persetujuan", async () => {
    const id = await create();

    let d = await waitStatus(id, "awaiting_approval");
    expect(d.steps.map((s) => s.status)).toEqual(["completed", "awaiting_approval", "pending", "pending"]);
    expect(calls.map((c) => c.agent)).toEqual(["analyst", "architect"]);

    expect((await call(`/${id}/approve`, "POST", { note: "oke" })).status).toBe(200);
    d = await waitFor(() => detail(id), (x) => x.run.status === "awaiting_approval" && x.steps[3]?.status === "awaiting_approval");
    expect(calls.map((c) => c.agent)).toEqual(["analyst", "architect", "backend", "qa"]);

    // Dependensi benar-benar dikirim sebagai konteks
    expect(calls[1]?.user).toContain("OUT-analyst");
    expect(calls[2]?.user).toContain("OUT-analyst");
    expect(calls[2]?.user).toContain("OUT-architect");
    expect(calls[3]?.user).toContain("OUT-backend");

    expect((await call(`/${id}/approve`, "POST")).status).toBe(200);
    d = await waitStatus(id, "completed");
    expect(d.steps.every((s) => s.status === "completed" && s.total_tokens === 15)).toBe(true);

    const list = (await (await call("/")).json()) as { runs: { steps_done: number; steps_total: number; total_tokens: number }[]; limits: { calls: { used: number }; free_tier_only: boolean } };
    expect(list.runs[0]).toMatchObject({ steps_done: 4, steps_total: 4, total_tokens: 60 });
    expect(list.limits.calls.used).toBe(4);
    expect(list.limits.free_tier_only).toBe(true);
  });

  it("tolak + catatan → retry hanya mengulang langkah yang ditolak dan membawa catatan", async () => {
    const id = await create();
    await waitStatus(id, "awaiting_approval");
    expect((await call(`/${id}/reject`, "POST", { note: "pakai D1 saja" })).status).toBe(200);
    await waitStatus(id, "rejected");
    expect(calls.map((c) => c.agent)).toEqual(["analyst", "architect"]);

    expect((await call(`/${id}/retry`, "POST")).status).toBe(200);
    await waitFor(() => detail(id), (x) => x.run.status === "awaiting_approval" && calls.length === 3);
    expect(calls.map((c) => c.agent)).toEqual(["analyst", "architect", "architect"]); // analyst tidak diulang
    expect(calls[2]?.user).toContain("pakai D1 saja");
    expect(calls[2]?.user).toContain("OUT-architect");
  });

  it("gagal di langkah tengah → retry melewati langkah yang sudah selesai", async () => {
    failOnCall = 3; // backend (panggilan ke-3) ditolak 401
    const id = await create();
    await waitStatus(id, "awaiting_approval");
    await call(`/${id}/approve`, "POST");
    const d = await waitStatus(id, "failed");
    expect(d.run.error).toMatch(/401/);
    expect(d.steps.map((s) => s.status)).toEqual(["completed", "completed", "failed", "pending"]);

    failOnCall = null;
    expect((await call(`/${id}/retry`, "POST")).status).toBe(200);
    await waitFor(() => detail(id), (x) => x.steps[3]?.status === "awaiting_approval");
    expect(calls.map((c) => c.agent)).toEqual(["analyst", "architect", "backend", "backend", "qa"]);
  });

  it("batas harian: alur ditolak 429 bila panggilan AI akan terlampaui", async () => {
    env.MAX_AI_CALLS_PER_DAY = "3";
    const res = await call("/", "POST", { goal: "Bangun aplikasi catatan sederhana", template: "standard" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/panggilan AI/);
    expect(calls).toHaveLength(0);
  });

  it("batas alur/hari", async () => {
    env.MAX_RUNS_PER_DAY = "1";
    await create();
    const res = await call("/", "POST", { goal: "Alur kedua untuk hari ini", template: "ui" });
    expect(res.status).toBe(429);
  });

  it("persetujuan hanya sah saat menunggu; dobel klik ditolak", async () => {
    const id = await create();
    expect((await call(`/${id}/approve`, "POST")).status).toBe(409); // belum menunggu
    await waitStatus(id, "awaiting_approval");
    expect((await call(`/${id}/approve`, "POST")).status).toBe(200);
    expect((await call(`/${id}/approve`, "POST")).status).toBe(409);
  });

  it("pause lalu resume", async () => {
    const id = await create("full");
    // Tunggu sampai approval pertama; lalu setuju dan jeda saat berjalan.
    await waitStatus(id, "awaiting_approval");
    await call(`/${id}/approve`, "POST");
    await waitFor(() => detail(id), (x) => x.run.status === "running" || x.run.status === "awaiting_approval");
    const pr = await call(`/${id}/pause`, "POST");
    if (pr.status === 200) {
      expect(["pausing", "paused"]).toContain(((await pr.json()) as { status: string }).status);
      expect((await call(`/${id}/resume`, "POST")).status).toBe(200);
    } else {
      expect(pr.status).toBe(409); // sudah menunggu persetujuan: tidak perlu pause
    }
  });

  it("template dan input tidak valid ditolak", async () => {
    expect((await call("/", "POST", { goal: "Bangun aplikasi catatan", template: "x" })).status).toBe(400);
    expect((await call("/", "POST", { goal: "pendek", template: "standard" })).status).toBe(400);
    expect((await call("/nope")).status).toBe(404);
  });

  it("alur lengkap memakai ketujuh agent", async () => {
    const id = await create("full");
    for (let i = 0; i < 2; i++) {
      await waitFor(() => detail(id), (x) => x.run.status === "awaiting_approval");
      await call(`/${id}/approve`, "POST");
      await waitFor(() => detail(id), (x) => x.run.status !== "running" || calls.length > i);
    }
    await waitStatus(id, "completed");
    expect(new Set(calls.map((c) => c.agent))).toEqual(new Set(["analyst", "architect", "designer", "backend", "frontend", "qa", "devops"]));
  });
});
