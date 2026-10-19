// API alur multi-agent Fase 3. Pasang SETELAH middleware auth pemilik:
//   app.route("/api/runs", runRoutes);

import { PIPELINE_TEMPLATES, type RunStatus } from "@avo/shared";
import { Hono } from "hono";
import { z } from "zod";
import { checkBudget, getTemplate, readLimits, validateSteps } from "./pipeline";
import { runEventStmt, type Phase3Env } from "./shared";
import { loadDayUsage } from "./workflow";

const MAX_ATTEMPTS = 5;
const ACTIVE: RunStatus[] = ["queued", "running", "awaiting_approval", "pausing", "paused"];

interface RunRow {
  id: string;
  title: string;
  goal: string;
  template: string;
  status: RunStatus;
  attempts: number;
  instance_id: string | null;
  current_step: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface ListRow extends Omit<RunRow, "goal"> {
  steps_total: number;
  steps_done: number;
  total_tokens: number | null;
}

interface StepDbRow {
  idx: number;
  agent: string;
  title: string;
  depends_on: string;
  needs_approval: number;
  status: string;
  output: string | null;
  approval_note: string | null;
  provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  error: string | null;
}

export const runRoutes = new Hono<{ Bindings: Phase3Env }>();

const createSchema = z.object({
  goal: z.string().trim().min(10).max(4000),
  template: z.string().trim().min(1).max(40),
  title: z.string().trim().max(80).optional(),
});

const noteSchema = z.object({ note: z.string().trim().max(500).optional() }).default({});

function mapInstance(s: string): RunStatus | null {
  switch (s) {
    case "queued":
      return "queued";
    case "running":
    case "waiting":
      return "running";
    case "waitingForPause":
      return "pausing";
    case "paused":
      return "paused";
    case "errored":
    case "terminated":
      return "failed";
    default:
      return null; // complete / unknown: Workflow yang menulis hasil akhir ke D1
  }
}

// Samakan status D1 dengan instance Workflow. 'awaiting_approval' di D1 adalah keadaan yang
// lebih spesifik daripada 'waiting' milik Workflow, jadi tidak boleh ditimpa 'running'.
export async function syncStatus<
  T extends { id: string; status: RunStatus; instance_id: string | null; error: string | null },
>(env: Phase3Env, run: T): Promise<T> {
  if (!ACTIVE.includes(run.status) || !run.instance_id) return run;
  try {
    const inst = await env.RUN_WORKFLOW.get(run.instance_id);
    const s = await inst.status();
    const mapped = mapInstance(s.status);
    if (!mapped || mapped === run.status) return run;
    if (run.status === "awaiting_approval" && mapped === "running") return run;
    const rawErr = s.error as unknown;
    const err =
      mapped === "failed"
        ? typeof rawErr === "string"
          ? rawErr
          : ((rawErr as { message?: string } | undefined)?.message ?? `Workflow ${s.status}`)
        : null;
    const res = await env.DB.prepare(
      "UPDATE p3_runs SET status = ?, error = COALESCE(?, error), updated_at = ? WHERE id = ? AND status = ?",
    )
      .bind(mapped, err, Date.now(), run.id, run.status)
      .run();
    if (!res.meta.changes) return run;
    return { ...run, status: mapped, error: err ?? run.error };
  } catch {
    return run;
  }
}

function getRun(env: Phase3Env, id: string) {
  return env.DB.prepare("SELECT * FROM p3_runs WHERE id = ?").bind(id).first<RunRow>();
}

async function startInstance(env: Phase3Env, runId: string, attempt: number) {
  const instanceId = `${runId}-a${attempt}`;
  await env.RUN_WORKFLOW.create({ id: instanceId, params: { runId, attempt } });
  return instanceId;
}

async function failRun(env: Phase3Env, runId: string, key: string, msg: string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE p3_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(
      msg,
      Date.now(),
      runId,
    ),
    runEventStmt(env.DB, runId, key, "failed", msg),
  ]);
}

async function limitsPayload(env: Phase3Env) {
  const limits = readLimits(env);
  const u = await loadDayUsage(env);
  return {
    free_tier_only: limits.freeTierOnly,
    runs: { used: u.runs, limit: limits.runsPerDay },
    calls: { used: u.calls, limit: limits.callsPerDay },
    tokens: { used: u.tokens, limit: limits.tokensPerDay },
  };
}

// ---- Kirim tujuan -> mulai alur ----
runRoutes.post("/", async (c) => {
  const env = c.env;
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Tujuan wajib diisi (10–4000 karakter) dan template dipilih." }, 400);
  const tpl = getTemplate(parsed.data.template);
  if (!tpl) return c.json({ error: "Template alur tidak dikenal." }, 400);
  const problems = validateSteps(tpl.steps);
  if (problems.length) return c.json({ error: `Template rusak: ${problems[0]}` }, 500);
  if (!env.GROQ_API_KEY) return c.json({ error: "GROQ_API_KEY belum diset di Cloudflare." }, 500);

  const limits = readLimits(env);
  const denied = checkBudget(await loadDayUsage(env), limits, tpl.steps.length, true);
  if (denied) return c.json({ error: `${denied} Free Tier Only aktif.` }, 429);

  const id = crypto.randomUUID();
  const now = Date.now();
  const { goal } = parsed.data;
  const title = parsed.data.title || goal.replace(/\s+/g, " ").slice(0, 60);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO p3_runs (id, title, goal, template, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 1, ?, ?)",
    ).bind(id, title, goal, tpl.id, now, now),
    ...tpl.steps.map((s, i) =>
      env.DB.prepare(
        "INSERT INTO p3_steps (id, run_id, idx, agent, title, depends_on, needs_approval, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      ).bind(`${id}-${i}`, id, i, s.agent, s.title, JSON.stringify(s.dependsOn), s.needsApproval ? 1 : 0, now),
    ),
    runEventStmt(env.DB, id, `${id}-1-created`, "created", `Alur "${tpl.id}" diterima (${tpl.steps.length} langkah)`),
  ]);

  try {
    const instanceId = await startInstance(env, id, 1);
    await env.DB.prepare("UPDATE p3_runs SET instance_id = ? WHERE id = ?").bind(instanceId, id).run();
  } catch (e) {
    const msg = `Gagal memulai Workflow: ${e instanceof Error ? e.message : String(e)}`;
    await failRun(env, id, `${id}-1-fail`, msg);
    return c.json({ error: msg, id }, 502);
  }
  return c.json({ id }, 201);
});

// ---- Daftar alur + batas pemakaian ----
runRoutes.get("/", async (c) => {
  const env = c.env;
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.title, r.template, r.status, r.attempts, r.instance_id, r.current_step, r.error,
            r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM p3_steps s WHERE s.run_id = r.id) AS steps_total,
            (SELECT COUNT(*) FROM p3_steps s WHERE s.run_id = r.id AND s.status = 'completed') AS steps_done,
            (SELECT SUM(u.total_tokens) FROM p3_usage_logs u WHERE u.run_id = r.id) AS total_tokens
     FROM p3_runs r ORDER BY r.created_at DESC LIMIT 50`,
  ).all<ListRow>();
  const synced = await Promise.all(results.map((r) => syncStatus(env, r)));
  return c.json({
    runs: synced.map(({ instance_id: _i, ...rest }) => rest),
    limits: await limitsPayload(env),
    templates: PIPELINE_TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
  });
});

// ---- Detail satu alur ----
runRoutes.get("/:id", async (c) => {
  const env = c.env;
  const run = await getRun(env, c.req.param("id"));
  if (!run) return c.json({ error: "Alur tidak ditemukan." }, 404);
  const synced = await syncStatus(env, run);
  const [steps, events] = await Promise.all([
    env.DB.prepare(
      `SELECT idx, agent, title, depends_on, needs_approval, status, output, approval_note, provider, model,
              prompt_tokens, completion_tokens, total_tokens, latency_ms, error
       FROM p3_steps WHERE run_id = ? ORDER BY idx ASC`,
    )
      .bind(run.id)
      .all<StepDbRow>(),
    env.DB.prepare("SELECT id, type, message, created_at FROM p3_events WHERE run_id = ? ORDER BY created_at ASC, id ASC")
      .bind(run.id)
      .all(),
  ]);
  const { instance_id: _i, ...pub } = synced;
  return c.json({
    run: pub,
    steps: steps.results.map((s) => ({
      ...s,
      depends_on: JSON.parse(s.depends_on) as number[],
      needs_approval: s.needs_approval === 1,
    })),
    events: events.results,
  });
});

// ---- Pause ----
runRoutes.post("/:id/pause", async (c) => {
  const env = c.env;
  const run = await getRun(env, c.req.param("id"));
  if (!run) return c.json({ error: "Alur tidak ditemukan." }, 404);
  if (!["queued", "running"].includes(run.status) || !run.instance_id) {
    return c.json({ error: "Hanya alur yang sedang berjalan yang bisa di-pause." }, 409);
  }
  try {
    const inst = await env.RUN_WORKFLOW.get(run.instance_id);
    await inst.pause();
    const s = await inst.status();
    const next: RunStatus = s.status === "paused" ? "paused" : "pausing";
    await env.DB.batch([
      env.DB.prepare("UPDATE p3_runs SET status = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running')").bind(
        next,
        Date.now(),
        run.id,
      ),
      runEventStmt(env.DB, run.id, crypto.randomUUID(), "pause", "Pause diminta (berlaku setelah langkah yang sedang jalan selesai)"),
    ]);
    return c.json({ status: next });
  } catch (e) {
    return c.json({ error: `Gagal pause: ${e instanceof Error ? e.message : String(e)}` }, 409);
  }
});

// ---- Resume ----
runRoutes.post("/:id/resume", async (c) => {
  const env = c.env;
  const run = await getRun(env, c.req.param("id"));
  if (!run) return c.json({ error: "Alur tidak ditemukan." }, 404);
  if (!["paused", "pausing"].includes(run.status) || !run.instance_id) {
    return c.json({ error: "Alur tidak sedang di-pause." }, 409);
  }
  try {
    const inst = await env.RUN_WORKFLOW.get(run.instance_id);
    await inst.resume();
    // Bila saat dijeda sebuah langkah sudah selesai dan menunggu persetujuan, tampilkan status itu.
    const waiting = await env.DB.prepare(
      "SELECT 1 AS x FROM p3_steps WHERE run_id = ? AND status = 'awaiting_approval' LIMIT 1",
    )
      .bind(run.id)
      .first();
    const next: RunStatus = waiting ? "awaiting_approval" : "running";
    await env.DB.batch([
      env.DB.prepare("UPDATE p3_runs SET status = ?, updated_at = ? WHERE id = ? AND status IN ('paused','pausing')").bind(
        next,
        Date.now(),
        run.id,
      ),
      runEventStmt(env.DB, run.id, crypto.randomUUID(), "resume", "Dilanjutkan"),
    ]);
    return c.json({ status: next });
  } catch (e) {
    return c.json({ error: `Gagal resume: ${e instanceof Error ? e.message : String(e)}` }, 409);
  }
});

// ---- Setuju / tolak ----
async function decide(env: Phase3Env, id: string, approved: boolean, note: string | undefined) {
  const run = await getRun(env, id);
  if (!run) return { code: 404 as const, error: "Alur tidak ditemukan." };
  const synced = await syncStatus(env, run);
  if (synced.status !== "awaiting_approval" || !run.instance_id) {
    return { code: 409 as const, error: "Alur tidak sedang menunggu persetujuan." };
  }
  const waiting = await env.DB.prepare(
    "SELECT idx FROM p3_steps WHERE run_id = ? AND status = 'awaiting_approval' ORDER BY idx ASC LIMIT 1",
  )
    .bind(id)
    .first<{ idx: number }>();
  if (!waiting) return { code: 409 as const, error: "Tidak ada langkah yang menunggu persetujuan." };

  // Kunci: cegah dobel klik mengirim dua event.
  const claim = await env.DB.prepare(
    "UPDATE p3_runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'awaiting_approval'",
  )
    .bind(Date.now(), id)
    .run();
  if (!claim.meta.changes) return { code: 409 as const, error: "Keputusan sudah dikirim." };

  try {
    const inst = await env.RUN_WORKFLOW.get(run.instance_id);
    await inst.sendEvent({ type: `approval-${waiting.idx}`, payload: { approved, note } });
  } catch (e) {
    await env.DB.prepare("UPDATE p3_runs SET status = 'awaiting_approval', updated_at = ? WHERE id = ?")
      .bind(Date.now(), id)
      .run();
    return { code: 502 as const, error: `Gagal mengirim keputusan: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { code: 200 as const, error: null };
}

for (const [path, approved] of [
  ["approve", true],
  ["reject", false],
] as const) {
  runRoutes.post(`/:id/${path}`, async (c) => {
    const body = noteSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Catatan maksimal 500 karakter." }, 400);
    const r = await decide(c.env, c.req.param("id"), approved, body.data.note);
    if (r.error) return c.json({ error: r.error }, r.code);
    return c.json({ status: approved ? "running" : "rejecting" });
  });
}

// ---- Retry (instance baru; langkah yang sudah selesai dilewati) ----
runRoutes.post("/:id/retry", async (c) => {
  const env = c.env;
  const run = await getRun(env, c.req.param("id"));
  if (!run) return c.json({ error: "Alur tidak ditemukan." }, 404);
  if (!["failed", "rejected"].includes(run.status)) {
    return c.json({ error: "Hanya alur gagal atau ditolak yang bisa di-retry." }, 409);
  }
  if (run.attempts >= MAX_ATTEMPTS) return c.json({ error: `Batas ${MAX_ATTEMPTS} percobaan tercapai.` }, 409);

  const attempt = run.attempts + 1;
  const batch = await env.DB.batch([
    env.DB.prepare(
      "UPDATE p3_runs SET status = 'queued', attempts = ?, error = NULL, updated_at = ? WHERE id = ? AND status IN ('failed','rejected')",
    ).bind(attempt, Date.now(), run.id),
    // Langkah selesai tetap; yang gagal/ditolak/terputus diulang. 'awaiting_approval' dipertahankan
    // (hasilnya sudah ada, cukup minta persetujuan lagi tanpa memanggil AI).
    env.DB.prepare(
      "UPDATE p3_steps SET status = 'pending', error = NULL, updated_at = ? WHERE run_id = ? AND status IN ('failed','rejected','running')",
    ).bind(Date.now(), run.id),
    runEventStmt(env.DB, run.id, `${run.id}-${attempt}-retry`, "retry", `Retry: percobaan ${attempt}`),
  ]);
  if (!batch[0]?.meta.changes) return c.json({ error: "Alur sudah diproses ulang." }, 409);

  try {
    const instanceId = await startInstance(env, run.id, attempt);
    await env.DB.prepare("UPDATE p3_runs SET instance_id = ? WHERE id = ?").bind(instanceId, run.id).run();
  } catch (e) {
    const msg = `Gagal memulai Workflow: ${e instanceof Error ? e.message : String(e)}`;
    await failRun(env, run.id, `${run.id}-${attempt}-fail`, msg);
    return c.json({ error: msg }, 502);
  }
  return c.json({ status: "queued", attempt });
});
