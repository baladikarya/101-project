// Fase 7b: sambungan alur tim -> coding. Logika murni (tanpa D1) + pembaca status CI GitHub.

import type { ChatMessage } from "../phase2/ai";
import { githubGet } from "../phase5/github-app";
import { EXTERNAL_PROMPT } from "../phase5/code-task";
import { truncate, type DepOutput } from "../phase3/pipeline";

export const ANALYST_CHARS = 2500;
export const ARCHITECT_CHARS = 4000;
export const DEV_MAX_TOKENS = 4096;
export const CI_MAX_POLLS = 10;
export const CI_POLL_DELAY = "1 minute";

/** Nama branch deterministik per run + percobaan: agent/run-<8 hex>-a<n>. */
export function branchFor(runId: string, attempt: number): string {
  const short = runId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "run";
  return `agent/run-${short}-a${attempt}`;
}

/** Output Analyst + Architect -> instruksi coding otomatis untuk Developer. */
export function buildDevMessages(opts: {
  project: string;
  goal: string;
  deps: readonly DepOutput[];
  existingFiles: readonly string[];
}): { messages: ChatMessage[]; maxTokens: number } {
  const analyst = opts.deps.find((d) => d.agent === "analyst");
  const architect = opts.deps.find((d) => d.agent === "architect");
  const parts = [
    `Proyek: ${opts.project}`,
    "Instruksi pemilik (dibuat otomatis dari hasil Analyst dan Architect):",
    "Wujudkan tujuan berikut sebagai kode di repo ini. Ikuti rancangan, tapi sederhanakan agar muat maksimal 3 file. Proyek harus berdiri sendiri (misalnya halaman statis) tanpa dependensi baru.",
    `TUJUAN:\n${opts.goal}`,
  ];
  if (analyst) parts.push(`KEBUTUHAN (Analyst):\n${truncate(analyst.output, ANALYST_CHARS)}`);
  if (architect) parts.push(`RANCANGAN (Architect):\n${truncate(architect.output, ARCHITECT_CHARS)}`);
  parts.push(
    opts.existingFiles.length
      ? `File yang sudah ada di main (menulis path yang sama = mengganti isi penuh):\n${opts.existingFiles.map((f) => `- ${f}`).join("\n")}`
      : "Repo belum punya file selain yang wajar; buat file baru.",
  );
  return {
    messages: [
      { role: "system", content: EXTERNAL_PROMPT },
      { role: "user", content: parts.join("\n\n") },
    ],
    maxTokens: DEV_MAX_TOKENS,
  };
}

/** Peringatan otomatis untuk kode buatan AI: rujukan file hilang, form ke luar, link mati. Tidak memblokir PR. */
export function lintFiles(
  files: readonly { path: string; content: string }[],
  existing: readonly string[],
): string[] {
  const have = new Set([...existing, ...files.map((f) => f.path)]);
  const out: string[] = [];
  for (const f of files) {
    if (!/\.(html?|svg)$/i.test(f.path)) continue;
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    const refs = new Set<string>();
    for (const m of f.content.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const r = (m[1] ?? "").trim();
      if (!r || /^(https?:|\/\/|mailto:|tel:|data:|javascript:|#)/i.test(r)) continue;
      refs.add((dir + r.split(/[?#]/)[0]).replace(/^\.\//, ""));
    }
    for (const r of refs) if (!have.has(r)) out.push(`${f.path} memuat \`${r}\` yang tidak ada di PR maupun repo`);
    for (const m of f.content.matchAll(/<form\b[^>]*\baction\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
      out.push(`${f.path} mengirim form ke URL eksternal ${m[1]} (periksa kepemilikan endpoint)`);
    }
    if (/\bhref\s*=\s*["']#["']/i.test(f.content)) out.push(`${f.path} punya link mati href="#"`);
  }
  return out;
}

export function buildPrBody(opts: {
  project: string;
  repo: string;
  runId: string;
  goal: string;
  summary: string;
  files: readonly string[];
  provider: string;
  model: string;
  warnings?: readonly string[];
}): string {
  const warn = opts.warnings?.length
    ? ["", "## Peringatan otomatis (review sebelum merge)", ...opts.warnings.map((w) => `- ${w}`)]
    : [];
  return [
    `Proyek: \`${opts.project}\` (${opts.repo})`,
    `Alur tim: \`${opts.runId}\` (Analyst → Architect → Developer → QA)`,
    "",
    "## Tujuan",
    opts.goal.split("\n").map((l) => `> ${l}`).join("\n"),
    "",
    "## Ringkasan AI",
    opts.summary || "(tanpa ringkasan)",
    "",
    "## File",
    ...opts.files.map((f) => `- \`${f}\``),
    ...warn,
    "",
    `_Dibuat otomatis oleh alur tim (${opts.provider}/${opts.model}). Review dulu; merge hanya jika CI hijau._`,
  ].join("\n");
}

// ---- Status CI ----

export interface CiRun {
  id?: number;
  head_sha?: string;
  name: string;
  workflow_id: number;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}

export type CiState = "pass" | "fail" | "pending" | "needs_approval" | "none";

export interface CiVerdict {
  state: CiState;
  text: string;
}

const OK = new Set(["success", "neutral", "skipped"]);

/** Run terbaru per workflow. */
export function latestRuns(runs: readonly CiRun[]): CiRun[] {
  const latest = new Map<number, CiRun>();
  for (const r of [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    if (!latest.has(r.workflow_id)) latest.set(r.workflow_id, r);
  }
  return [...latest.values()];
}

/** Run terbaru per workflow yang selesai dengan kegagalan nyata (bukan menunggu persetujuan). */
export function failedRuns(runs: readonly CiRun[]): CiRun[] {
  return latestRuns(runs).filter(
    (r) => r.status === "completed" && r.conclusion !== null && !OK.has(r.conclusion) && r.conclusion !== "action_required",
  );
}

/** Hanya run milik commit tertentu (setelah perbaikan, run lama tidak boleh dihitung). */
export function scopeToSha(runs: readonly CiRun[], sha: string): CiRun[] {
  return runs.filter((r) => r.head_sha === sha);
}

/** Ambil run terbaru per workflow, lalu tentukan status gabungan. */
export function summarizeCi(runs: readonly CiRun[]): CiVerdict {
  const list = latestRuns(runs);
  if (list.length === 0) return { state: "none", text: "Belum ada run CI untuk branch ini." };
  const line = (r: CiRun) => `- ${r.name}: ${r.status === "completed" ? (r.conclusion ?? "?") : (r.status ?? "?")} ${r.html_url}`;
  const lines = list.map(line).join("\n");
  const done = (r: CiRun) => r.status === "completed";
  if (list.some((r) => done(r) && r.conclusion !== null && !OK.has(r.conclusion) && r.conclusion !== "action_required")) {
    return { state: "fail", text: `CI GAGAL\n${lines}` };
  }
  if (list.some((r) => done(r) && r.conclusion === "action_required")) {
    return { state: "needs_approval", text: `CI menunggu persetujuan (klik "Approve workflows to run" di PR)\n${lines}` };
  }
  if (list.some((r) => !done(r))) return { state: "pending", text: `CI masih berjalan\n${lines}` };
  return { state: "pass", text: `CI LULUS\n${lines}` };
}

export async function fetchCiRuns(token: string, repo: string, branch: string): Promise<CiRun[]> {
  const res = await githubGet<{ workflow_runs?: CiRun[] }>(
    token,
    `/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`,
    "ci_runs",
  );
  return (res.workflow_runs ?? []).map((r) => ({
    id: r.id,
    head_sha: r.head_sha,
    name: r.name,
    workflow_id: r.workflow_id,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    created_at: r.created_at,
  }));
}

/** Daftar path file di main (maks 60) agar Developer tahu isi repo. Gagal = daftar kosong. */
export async function listRepoFiles(token: string, repo: string): Promise<string[]> {
  try {
    const res = await githubGet<{ tree?: { path: string; type: string }[] }>(
      token,
      `/repos/${repo}/git/trees/main?recursive=1`,
      "list_files",
    );
    return (res.tree ?? [])
      .filter((t) => t.type === "blob" && !t.path.startsWith(".github/") && !t.path.startsWith("node_modules/"))
      .map((t) => t.path)
      .slice(0, 60);
  } catch {
    return [];
  }
}
