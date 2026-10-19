// API tugas Fase 2. Pasang SETELAH middleware auth pemilik:
//   app.route("/api/tasks", taskRoutes);

import { Hono } from "hono";
import { z } from "zod";
import { eventStmt, type Phase2Env, type TaskStatus } from "./shared";

const MAX_ATTEMPTS = 5;
const ACTIVE: TaskStatus[] = ["queued", "running", "pausing", "paused"];

interface TaskRow {
  id: string;
  title: string;
  prompt: string;
  agent: string;
  status: TaskStatus;
  attempts: number;
  instance_id: string | null;
  provider: string | null;
  model: string | null;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface ListRow {
  id: string;
  title: string;
  status: TaskStatus;
  attempts: number;
  instance_id: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  total_tokens: number | null;
}

export const taskRoutes = new Hono<{ Bindings: Phase2Env }>();

const createSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  title: z.string().trim().max(80).optional(),
});

function dayStartMs(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function dailyLimit(env: Phase2Env): number {
  const n = Number(env.MAX_TASKS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

function mapInstance(s: string): TaskStatus | null {
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
      return null; // complete / unknown: biarkan Workflow yang menulis ke D1
  }
}

// Samakan status D1 dengan status instance Workflow yang sebenarnya.
async function syncStatus<
  T extends { id: string; status: TaskStatus; instance_id: string | null; error: string | null },
>(env: Phase2Env, task: T): Promise<T> {
  if (!ACTIVE.includes(task.status) || !task.instance_id) return task;
  try {
    const inst = await env.TASK_WORKFLOW.get(task.instance_id);
    const s = await inst.status();
    const mapped = mapInstance(s.status);
    if (!mapped || mapped === task.status) return task;
    const rawErr = s.error as unknown;
    const err =
      mapped === "failed"
        ? typeof rawErr === "string"
          ? rawErr
          : ((rawErr as { message?: string } | undefined)?.message ?? `Workflow ${s.status}`)
        : null;
    const res = await env.DB.prepare(
      "UPDATE p2_tasks SET status = ?, error = COALESCE(?, error), updated_at = ? WHERE id = ? AND status = ?",
    )
      .bind(mapped, err, Date.now(), task.id, task.status)
      .run();
    if (!res.meta.changes) return task;
    return { ...task, status: mapped, error: err ?? task.error };
  } catch {
    return task;
  }
}

function getTask(env: Phase2Env, id: string) {
  return env.DB.prepare("SELECT * FROM p2_tasks WHERE id = ?").bind(id).first<TaskRow>();
}

async function startInstance(env: Phase2Env, taskId: string, attempt: number) {
  const instanceId = `${taskId}-a${attempt}`;
  await env.TASK_WORKFLOW.create({ id: instanceId, params: { taskId, attempt } });
  return instanceId;
}

async function failTask(env: Phase2Env, taskId: string, key: string, msg: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE p2_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    ).bind(msg, Date.now(), taskId),
    eventStmt(env.DB, taskId, key, "failed", msg),
  ]);
}

// ---- Kirim tugas ----
taskRoutes.post("/", async (c) => {
  const env = c.env;
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Prompt wajib diisi (3–4000 karakter)." }, 400);
  if (!env.GROQ_API_KEY) return c.json({ error: "GROQ_API_KEY belum diset di Cloudflare." }, 500);

  const limit = dailyLimit(env);
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM p2_tasks WHERE created_at >= ?")
    .bind(dayStartMs())
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= limit) {
    return c.json({ error: `Batas ${limit} tugas/hari (UTC) tercapai. Free Tier Only aktif.` }, 429);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const { prompt } = parsed.data;
  const title = parsed.data.title || prompt.replace(/\s+/g, " ").slice(0, 60);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO p2_tasks (id, title, prompt, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'queued', 1, ?, ?)",
    ).bind(id, title, prompt, now, now),
    eventStmt(env.DB, id, `${id}-1-created`, "created", "Tugas diterima"),
  ]);

  try {
    const instanceId = await startInstance(env, id, 1);
    await env.DB.prepare("UPDATE p2_tasks SET instance_id = ? WHERE id = ?").bind(instanceId, id).run();
  } catch (e) {
    const msg = `Gagal memulai Workflow: ${e instanceof Error ? e.message : String(e)}`;
    await failTask(env, id, `${id}-1-fail`, msg);
    return c.json({ error: msg, id }, 502);
  }
  return c.json({ id }, 201);
});

// ---- Daftar tugas + ringkasan hari ini ----
taskRoutes.get("/", async (c) => {
  const env = c.env;
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.attempts, t.instance_id, t.provider, t.model, t.error,
            t.created_at, t.updated_at,
            (SELECT SUM(u.total_tokens) FROM p2_usage_logs u WHERE u.task_id = t.id) AS total_tokens
     FROM p2_tasks t ORDER BY t.created_at DESC LIMIT 50`,
  ).all<ListRow>();

  const synced = await Promise.all(results.map((r) => syncStatus(env, r)));
  const start = dayStartMs();
  const [n, tok] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM p2_tasks WHERE created_at >= ?").bind(start).first<{ n: number }>(),
    env.DB.prepare("SELECT SUM(total_tokens) AS t FROM p2_usage_logs WHERE created_at >= ?").bind(start).first<{ t: number | null }>(),
  ]);

  return c.json({
    tasks: synced.map(({ instance_id: _i, ...rest }) => rest),
    today: { tasks: n?.n ?? 0, tokens: tok?.t ?? null, limit: dailyLimit(env) },
  });
});

// ---- Detail satu tugas ----
taskRoutes.get("/:id", async (c) => {
  const env = c.env;
  const task = await getTask(env, c.req.param("id"));
  if (!task) return c.json({ error: "Tugas tidak ditemukan." }, 404);
  const synced = await syncStatus(env, task);
  const [events, usage] = await Promise.all([
    env.DB.prepare("SELECT id, type, message, created_at FROM p2_task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC")
      .bind(task.id)
      .all(),
    env.DB.prepare(
      "SELECT attempt, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at FROM p2_usage_logs WHERE task_id = ? ORDER BY attempt ASC",
    )
      .bind(task.id)
      .all(),
  ]);
  const { instance_id: _i, ...pub } = synced;
  return c.json({ task: pub, events: events.results, usage: usage.results });
});

// ---- Pause ----
taskRoutes.post("/:id/pause", async (c) => {
  const env = c.env;
  const task = await getTask(env, c.req.param("id"));
  if (!task) return c.json({ error: "Tugas tidak ditemukan." }, 404);
  if (!["queued", "running"].includes(task.status) || !task.instance_id) {
    return c.json({ error: "Hanya tugas yang sedang berjalan yang bisa di-pause." }, 409);
  }
  try {
    const inst = await env.TASK_WORKFLOW.get(task.instance_id);
    await inst.pause();
    const s = await inst.status();
    const next: TaskStatus = s.status === "paused" ? "paused" : "pausing";
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE p2_tasks SET status = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running')",
      ).bind(next, Date.now(), task.id),
      eventStmt(env.DB, task.id, crypto.randomUUID(), "pause", "Pause diminta (berlaku setelah langkah yang sedang jalan selesai)"),
    ]);
    return c.json({ status: next });
  } catch (e) {
    return c.json({ error: `Gagal pause: ${e instanceof Error ? e.message : String(e)}` }, 409);
  }
});

// ---- Resume ----
taskRoutes.post("/:id/resume", async (c) => {
  const env = c.env;
  const task = await getTask(env, c.req.param("id"));
  if (!task) return c.json({ error: "Tugas tidak ditemukan." }, 404);
  if (!["paused", "pausing"].includes(task.status) || !task.instance_id) {
    return c.json({ error: "Tugas tidak sedang di-pause." }, 409);
  }
  try {
    const inst = await env.TASK_WORKFLOW.get(task.instance_id);
    await inst.resume();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE p2_tasks SET status = 'running', updated_at = ? WHERE id = ? AND status IN ('paused','pausing')",
      ).bind(Date.now(), task.id),
      eventStmt(env.DB, task.id, crypto.randomUUID(), "resume", "Dilanjutkan"),
    ]);
    return c.json({ status: "running" });
  } catch (e) {
    return c.json({ error: `Gagal resume: ${e instanceof Error ? e.message : String(e)}` }, 409);
  }
});

// ---- Retry (instance Workflow baru, percobaan ke-N) ----
taskRoutes.post("/:id/retry", async (c) => {
  const env = c.env;
  const task = await getTask(env, c.req.param("id"));
  if (!task) return c.json({ error: "Tugas tidak ditemukan." }, 404);
  if (task.status !== "failed") return c.json({ error: "Hanya tugas gagal yang bisa di-retry." }, 409);
  if (task.attempts >= MAX_ATTEMPTS) {
    return c.json({ error: `Batas ${MAX_ATTEMPTS} percobaan tercapai.` }, 409);
  }

  const attempt = task.attempts + 1;
  const batch = await env.DB.batch([
    env.DB.prepare(
      "UPDATE p2_tasks SET status = 'queued', attempts = ?, error = NULL, updated_at = ? WHERE id = ? AND status = 'failed'",
    ).bind(attempt, Date.now(), task.id),
    eventStmt(env.DB, task.id, `${task.id}-${attempt}-retry`, "retry", `Retry: percobaan ${attempt}`),
  ]);
  if (!batch[0]?.meta.changes) return c.json({ error: "Tugas sudah diproses ulang." }, 409);

  try {
    const instanceId = await startInstance(env, task.id, attempt);
    await env.DB.prepare("UPDATE p2_tasks SET instance_id = ? WHERE id = ?").bind(instanceId, task.id).run();
  } catch (e) {
    const msg = `Gagal memulai Workflow: ${e instanceof Error ? e.message : String(e)}`;
    await failTask(env, task.id, `${task.id}-${attempt}-fail`, msg);
    return c.json({ error: msg }, 502);
  }
  return c.json({ status: "queued", attempt });
});
