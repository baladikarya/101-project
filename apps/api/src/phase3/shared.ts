// Tipe + helper bersama untuk Fase 3 (tim multi-agent).

import type { Phase2Env } from "../phase2/shared";

export interface RunParams {
  runId: string;
  attempt: number;
}

export interface Phase3Env extends Phase2Env {
  RUN_WORKFLOW: Workflow<RunParams>;
  /** "false" mematikan mode Free Tier Only. Selain itu (termasuk kosong) = aktif. */
  FREE_TIER_ONLY?: string;
  MAX_RUNS_PER_DAY?: string;
  MAX_AI_CALLS_PER_DAY?: string;
  MAX_TOKENS_PER_DAY?: string;
  /** Fase 7e: batas token untuk semua perbaikan otomatis dalam satu alur. Bawaan 30000. */
  MAX_REPAIR_TOKENS_PER_RUN?: string;
  /** Fase 7e: "true" = uji coba; agent sengaja merusak PR sekali lalu harus memperbaikinya. Bawaan mati. */
  REPAIR_DRILL?: string;
}

export function runEventStmt(
  db: D1Database,
  runId: string,
  id: string,
  type: string,
  message: string,
): D1PreparedStatement {
  return db
    .prepare("INSERT OR REPLACE INTO p3_events (id, run_id, type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, runId, type, message, Date.now());
}

export function dayStartMs(now = Date.now()): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
