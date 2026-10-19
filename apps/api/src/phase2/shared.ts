// Tipe + helper bersama untuk Fase 2.
// Binding D1 harus bernama DB. Kalau di wrangler.jsonc namanya lain, ganti di sini.

export interface TaskParams {
  taskId: string;
  attempt: number;
}

export interface Phase2Env {
  DB: D1Database;
  TASK_WORKFLOW: Workflow<TaskParams>;
  GROQ_API_KEY: string;
  GROQ_MODEL?: string;
  MAX_TASKS_PER_DAY?: string;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "pausing"
  | "paused"
  | "completed"
  | "failed";

// Event idempoten: id deterministik, aman kalau step Workflow di-retry.
export function eventStmt(
  db: D1Database,
  taskId: string,
  id: string,
  type: string,
  message: string,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT OR REPLACE INTO p2_task_events (id, task_id, type, message, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, taskId, type, message, Date.now());
}
