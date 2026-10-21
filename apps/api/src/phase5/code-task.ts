// Fase 5: tugas coding. Instruksi -> AI (Groq) -> file -> branch agent/* -> Pull Request.
// Agent tidak pernah push ke main dan tidak pernah merge; pemilik yang menyetujui.

import { createProvider, type ChatMessage } from "../phase2/ai";
import { scopeOf, type Project } from "../phase7/projects";
import { AgentOutputError, assertAgentPath, parseAgentOutput } from "./code-parse";
import { GithubError, getInstallationToken, type GithubEnv } from "./github-app";
import { openPullRequest, readRepoFile } from "./pr";

export interface CodeEnv extends GithubEnv {
  DB: D1Database;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  MAX_CODE_TASKS_PER_DAY?: string;
}

export interface CodeTaskInput {
  project: string; // nama di p7_projects
  instruction: string;
  paths: string[];
}

export interface CodeTaskResult {
  ok: boolean;
  id: string;
  status: "pr_open" | "failed";
  pr_number?: number;
  pr_url?: string;
  branch?: string;
  title?: string;
  tokens?: number | null;
  step?: string;
  error?: string;
}

const MAX_CONTEXT_FILES = 3;
const MAX_CONTEXT_CHARS = 12_000;
export const MAX_INSTRUCTION_CHARS = 2000;

const SELF_PROMPT = `Kamu Agent Developer untuk monorepo TypeScript: React+Vite di apps/web, Hono di Cloudflare Workers di apps/api, skema bersama di packages/shared.
Tugas: buat atau ubah file sesuai instruksi pemilik. Kode harus lolos typecheck strict dan test vitest.
Aturan:
- Maksimal 3 file. Hanya path di apps/, packages/, docs/, db/.
- Jangan ubah package.json, lockfile, wrangler.jsonc, .github, atau .env.
- Untuk file yang diubah, tulis ISI LENGKAP file baru (bukan potongan atau diff).
- Tanpa pagar kode (tiga backtick). Tanpa penjelasan di luar format.
Format jawaban PERSIS:
TITLE: <judul singkat satu baris>
SUMMARY: <ringkasan satu baris>
=== FILE: path/ke/file ===
<isi lengkap file>
=== END FILE ===
(ulangi blok FILE untuk file berikutnya)`;

const EXTERNAL_PROMPT = `Kamu Agent Developer untuk proyek web kecil di repo terpisah. Struktur repo bebas; path relatif dari root repo.
Tugas: buat atau ubah file sesuai instruksi pemilik. Jaga proyek tetap sederhana dan berdiri sendiri.
Aturan:
- Maksimal 3 file.
- Jangan ubah package.json, lockfile, wrangler.jsonc, .github, atau .env.
- Untuk file yang diubah, tulis ISI LENGKAP file baru (bukan potongan atau diff).
- Tanpa pagar kode (tiga backtick). Tanpa penjelasan di luar format.
Format jawaban PERSIS:
TITLE: <judul singkat satu baris>
SUMMARY: <ringkasan satu baris>
=== FILE: path/ke/file ===
<isi lengkap file>
=== END FILE ===
(ulangi blok FILE untuk file berikutnya)`;

export function validateInput(raw: unknown): CodeTaskInput {
  if (typeof raw !== "object" || raw === null) throw new AgentOutputError("body harus JSON");
  const r = raw as { project?: unknown; instruction?: unknown; paths?: unknown };
  const project = typeof r.project === "string" ? r.project.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(project)) throw new AgentOutputError("project wajib diisi (nama proyek)");
  const instruction = typeof r.instruction === "string" ? r.instruction.trim() : "";
  if (instruction.length < 10 || instruction.length > MAX_INSTRUCTION_CHARS) {
    throw new AgentOutputError(`instruksi harus 10-${MAX_INSTRUCTION_CHARS} karakter`);
  }
  const paths = Array.isArray(r.paths)
    ? r.paths.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean)
    : [];
  if (paths.length > MAX_CONTEXT_FILES) throw new AgentOutputError(`maksimal ${MAX_CONTEXT_FILES} file konteks`);
  return { project, instruction, paths };
}

async function countToday(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM p5_code_tasks WHERE created_at > ?")
    .bind(Date.now() - 24 * 60 * 60 * 1000)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function dailyLimit(env: CodeEnv): number {
  const n = Number(env.MAX_CODE_TASKS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

export async function overDailyLimit(env: CodeEnv): Promise<boolean> {
  return (await countToday(env.DB)) >= dailyLimit(env);
}

function describeError(err: unknown): { step: string; message: string } {
  if (err instanceof GithubError) return { step: err.step, message: err.message };
  if (err instanceof AgentOutputError) return { step: "agent_output", message: err.message };
  if (err instanceof Error) return { step: "ai", message: err.message };
  return { step: "unknown", message: "kesalahan tak dikenal" };
}

export async function runCodeTask(env: CodeEnv, input: CodeTaskInput, project: Project): Promise<CodeTaskResult> {
  const scope = scopeOf(project);
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO p5_code_tasks (id, project, instruction, paths, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?)",
  )
    .bind(id, project.name, input.instruction, JSON.stringify(input.paths), now, now)
    .run();

  let tokens: number | null = null;
  let model: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  try {
    const { token } = await getInstallationToken(env);

    const context: string[] = [];
    for (const path of input.paths) {
      assertAgentPath(path, scope);
      const file = await readRepoFile(token, project.repo, path, "main");
      if (!file) throw new AgentOutputError(`file konteks tidak ada di main (${project.repo}): ${path}`);
      if (file.content.length > MAX_CONTEXT_CHARS) {
        throw new AgentOutputError(`file konteks terlalu besar (>${MAX_CONTEXT_CHARS} karakter): ${path}`);
      }
      context.push(`=== CONTEXT: ${path} ===\n${file.content}\n=== END CONTEXT ===`);
    }
    const userMsg =
      `Proyek: ${project.name}\nInstruksi pemilik:\n${input.instruction}` +
      (context.length ? `\n\nFile konteks (isi saat ini di main):\n${context.join("\n")}` : "");
    const messages: ChatMessage[] = [
      { role: "system", content: scope === "self" ? SELF_PROMPT : EXTERNAL_PROMPT },
      { role: "user", content: userMsg },
    ];

    const ai = await createProvider(env).complete(messages, { maxTokens: 4096, temperature: 0.2 });
    tokens = ai.usage.totalTokens;
    promptTokens = ai.usage.promptTokens;
    completionTokens = ai.usage.completionTokens;
    model = ai.model;
    const out = parseAgentOutput(ai.text, scope);

    const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "z").toLowerCase();
    const branch = `agent/code-${stamp}-${id.slice(0, 6)}`;
    const body = [
      `Proyek: \`${project.name}\` (${project.repo})`,
      "",
      "## Tugas",
      input.instruction.split("\n").map((l) => `> ${l}`).join("\n"),
      "",
      "## Ringkasan AI",
      out.summary || "(tanpa ringkasan)",
      "",
      "## File",
      ...out.files.map((f) => `- \`${f.path}\``),
      "",
      `_Dibuat otomatis oleh Agent Developer (${ai.provider}/${ai.model}). Review dulu; merge hanya jika CI hijau._`,
    ].join("\n");

    const pr = await openPullRequest(env, {
      repo: project.repo,
      title: `agent: ${out.title}`,
      body,
      branch,
      files: out.files,
      token,
    });

    await env.DB.prepare(
      "UPDATE p5_code_tasks SET status='pr_open', title=?, branch=?, pr_number=?, pr_url=?, model=?, prompt_tokens=?, completion_tokens=?, total_tokens=?, updated_at=? WHERE id=?",
    )
      .bind(out.title, pr.branch, pr.number, pr.url, model, promptTokens, completionTokens, tokens, Date.now(), id)
      .run();
    return { ok: true, id, status: "pr_open", pr_number: pr.number, pr_url: pr.url, branch: pr.branch, title: out.title, tokens };
  } catch (err) {
    const { step, message } = describeError(err);
    console.error("code task failed:", step, message);
    await env.DB.prepare(
      "UPDATE p5_code_tasks SET status='failed', error=?, model=?, prompt_tokens=?, completion_tokens=?, total_tokens=?, updated_at=? WHERE id=?",
    )
      .bind(`${step}: ${message}`.slice(0, 500), model, promptTokens, completionTokens, tokens, Date.now(), id)
      .run();
    return { ok: false, id, status: "failed", step, error: message.slice(0, 500), tokens };
  }
}
