// Fase 7a: daftar proyek target. Hanya repo di tabel p7_projects yang boleh dibaca/ditulis agent.

import type { PathScope } from "../phase5/code-parse";

export interface Project {
  id: string;
  name: string;
  repo: string;
  worker: string | null;
  status: string;
  kind: "self" | "external";
  created_at: number;
  updated_at: number;
}

const COLS = "id, name, repo, worker, status, kind, created_at, updated_at";

export async function listProjects(db: D1Database): Promise<Project[]> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM p7_projects ORDER BY created_at, name`).all<Project>();
  return results;
}

export async function getProject(db: D1Database, name: string): Promise<Project | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) return null;
  return await db.prepare(`SELECT ${COLS} FROM p7_projects WHERE name = ?`).bind(name).first<Project>();
}

export function isUsable(p: Project): boolean {
  return p.status !== "archived";
}

export function scopeOf(p: Project): PathScope {
  return p.kind === "self" ? "self" : "external";
}
