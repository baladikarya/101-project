// Fase 4: status agent untuk tampilan kantor. Semua angka dan status berasal dari D1
// (p2_tasks, p3_runs, p3_steps, log pemakaian); tidak ada data buatan.
// Pasang SETELAH middleware auth pemilik:
//   app.route("/api/office", officeRoutes);

import {
  AGENT_ROLES,
  type AgentState,
  type Office,
  type OfficeAgent,
  type RunStatus,
  type TaskStatus,
} from "@avo/shared";
import { Hono } from "hono";
import { syncStatus as syncTask } from "../phase2/routes";
import { syncStatus as syncRun } from "../phase3/routes";
import type { Phase3Env } from "../phase3/shared";

const ACTIVE_RUN = new Set<RunStatus>(["queued", "running", "awaiting_approval", "pausing", "paused"]);
const FAILED_RUN = new Set<RunStatus>(["failed", "rejected"]);
const PRIORITY: Record<AgentState, number> = { working: 4, waiting: 3, paused: 2, error: 1, idle: 0 };
const ERROR_MAX = 200;

export interface RunInfo {
  id: string;
  title: string;
  status: RunStatus;
  error: string | null;
  created_at: number;
}
export interface StepInfo {
  run_id: string;
  agent: string;
  title: string;
  status: string;
  error: string | null;
}
export interface TaskInfo {
  title: string;
  status: TaskStatus;
  error: string | null;
  created_at: number;
}
export interface AgentStat {
  steps_done: number;
  tokens: number;
  last_active: number | null;
}

export interface OfficeInput {
  runs: RunInfo[];
  steps: StepInfo[];
  tasks: TaskInfo[];
  stats: Record<string, AgentStat | undefined>;
  now: number;
}

const clip = (s: string | null) => (s && s.length > ERROR_MAX ? `${s.slice(0, ERROR_MAX)}…` : s);

function stepState(run: RunInfo, step: StepInfo): AgentState | null {
  if (ACTIVE_RUN.has(run.status)) {
    if (step.status === "awaiting_approval") return "waiting";
    if (step.status === "running") return run.status === "paused" ? "paused" : "working";
    return null;
  }
  if (FAILED_RUN.has(run.status) && ["failed", "rejected", "running"].includes(step.status)) return "error";
  return null;
}

function taskState(t: TaskInfo): AgentState | null {
  if (t.status === "queued" || t.status === "running") return "working";
  if (t.status === "pausing" || t.status === "paused") return "paused";
  if (t.status === "failed") return "error";
  return null;
}

type Pick = { state: AgentState; activity: string; context: string; error: string | null };

function better(cur: Pick | null, next: Pick): Pick {
  return !cur || PRIORITY[next.state] > PRIORITY[cur.state] ? next : cur;
}

export function deriveOffice({ runs, steps, tasks, stats, now }: OfficeInput): Office {
  const runById = new Map(runs.map((r) => [r.id, r]));
  const agents: OfficeAgent[] = AGENT_ROLES.map(({ id }) => {
    let pick: Pick | null = null;

    if (id === "manager") {
      // `tasks` terurut dari yang terbaru; tugas gagal lama tidak boleh mengalahkan yang aktif.
      for (const t of tasks) {
        const state = taskState(t);
        if (!state) continue;
        // Tugas gagal hanya relevan bila itu tugas terbaru.
        if (state === "error" && t !== tasks[0]) continue;
        pick = better(pick, { state, activity: "Mengerjakan tugas", context: t.title, error: clip(t.error) });
      }
    } else {
      for (const s of steps) {
        if (s.agent !== id) continue;
        const run = runById.get(s.run_id);
        if (!run) continue;
        const state = stepState(run, s);
        if (!state) continue;
        pick = better(pick, { state, activity: s.title, context: run.title, error: clip(s.error ?? run.error) });
      }
    }

    const st = stats[id];
    return {
      id,
      state: pick?.state ?? "idle",
      activity: pick?.activity ?? null,
      context: pick?.context ?? null,
      error: pick?.state === "error" ? pick.error : null,
      last_active: st?.last_active ?? null,
      steps_done: st?.steps_done ?? 0,
      total_tokens: st?.tokens ?? 0,
    };
  });
  return { agents, generated_at: now };
}

const maxOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

interface RunRow extends RunInfo {
  instance_id: string | null;
}
interface TaskRow extends TaskInfo {
  id: string;
  instance_id: string | null;
}

export const officeRoutes = new Hono<{ Bindings: Phase3Env }>();

officeRoutes.get("/", async (c) => {
  const env = c.env;
  const [runRows, taskRows] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, status, instance_id, error, created_at FROM p3_runs
       WHERE status IN ('queued','running','awaiting_approval','pausing','paused')
          OR id = (SELECT id FROM p3_runs ORDER BY created_at DESC LIMIT 1)
       ORDER BY created_at DESC LIMIT 20`,
    ).all<RunRow>(),
    env.DB.prepare(
      `SELECT id, title, status, instance_id, error, created_at FROM p2_tasks
       WHERE status IN ('queued','running','pausing','paused')
          OR id = (SELECT id FROM p2_tasks ORDER BY created_at DESC LIMIT 1)
       ORDER BY created_at DESC LIMIT 20`,
    ).all<TaskRow>(),
  ]);

  // Samakan dengan status Workflow yang sebenarnya, supaya tidak menampilkan "bekerja" untuk alur yang sudah mati.
  const [runs, tasks] = await Promise.all([
    Promise.all(runRows.results.map((r) => syncRun(env, r))),
    Promise.all(taskRows.results.map((t) => syncTask(env, t))),
  ]);

  const ids = runs.map((r) => r.id);
  const stepsQ = ids.length
    ? env.DB.prepare(
        `SELECT run_id, agent, title, status, error FROM p3_steps WHERE run_id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(...ids)
        .all<StepInfo>()
    : Promise.resolve({ results: [] as StepInfo[] });

  const [steps, done, usage, mDone, mUsage] = await Promise.all([
    stepsQ,
    env.DB.prepare(
      "SELECT agent, COUNT(*) AS n, MAX(updated_at) AS last FROM p3_steps WHERE status = 'completed' GROUP BY agent",
    ).all<{ agent: string; n: number; last: number | null }>(),
    env.DB.prepare(
      "SELECT agent, COALESCE(SUM(total_tokens), 0) AS tokens, MAX(created_at) AS last FROM p3_usage_logs GROUP BY agent",
    ).all<{ agent: string; tokens: number; last: number | null }>(),
    env.DB.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM p2_tasks WHERE status = 'completed'").first<{
      n: number;
      last: number | null;
    }>(),
    env.DB.prepare("SELECT COALESCE(SUM(total_tokens), 0) AS tokens, MAX(created_at) AS last FROM p2_usage_logs").first<{
      tokens: number;
      last: number | null;
    }>(),
  ]);

  const stats: Record<string, AgentStat | undefined> = {};
  for (const d of done.results) {
    stats[d.agent] = { steps_done: d.n, tokens: 0, last_active: d.last };
  }
  for (const u of usage.results) {
    const cur = stats[u.agent];
    stats[u.agent] = {
      steps_done: cur?.steps_done ?? 0,
      tokens: u.tokens,
      last_active: maxOf(cur?.last_active ?? null, u.last),
    };
  }
  stats.manager = {
    steps_done: mDone?.n ?? 0,
    tokens: mUsage?.tokens ?? 0,
    last_active: maxOf(mDone?.last ?? null, mUsage?.last ?? null),
  };

  return c.json(deriveOffice({ runs, steps: steps.results, tasks, stats, now: Date.now() }));
});
