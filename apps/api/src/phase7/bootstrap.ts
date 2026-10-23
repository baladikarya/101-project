// Fase 7c: agent membuat PR "bootstrap CI" di proyek target: ci.yml + package.json + wrangler.jsonc + skrip build/tes.
// Isi dari template tetap (template.ts). Tidak push ke main, tidak merge.

import { GithubError, getInstallationToken, type GithubEnv } from "../phase5/github-app";
import { CI_WORKFLOW_PATH, openPullRequest, readRepoFile } from "../phase5/pr";
import type { Project } from "./projects";
import { missingFiles, templateFiles } from "./template";

export interface BootstrapResult {
  ok: boolean;
  status?: number;
  step?: string;
  error?: string;
  hint?: string;
  pr_number?: number;
  pr_url?: string;
  branch?: string;
  files?: string[];
  /** File template yang sudah ada di main sehingga tidak ditimpa. */
  skipped?: SkippedFile[];
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export const SKIP_REASON = "sudah ada di main, tidak ditimpa";

export function skippedFiles(all: readonly { path: string }[], existing: ReadonlySet<string>): SkippedFile[] {
  return all.filter((f) => existing.has(f.path)).map((f) => ({ path: f.path, reason: SKIP_REASON }));
}

export function bootstrapBranch(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "z").toLowerCase();
  return `agent/bootstrap-${stamp}`;
}

export function bootstrapBody(
  project: string,
  repo: string,
  files: readonly string[],
  skipped: readonly SkippedFile[] = [],
): string {
  const skipLines =
    skipped.length === 0
      ? []
      : [
          "",
          "## Dilewati (sudah ada di main)",
          ...skipped.map((f) => `- \`${f.path}\``),
          "",
          skipped.some((f) => f.path === CI_WORKFLOW_PATH)
            ? "`ci.yml` lama dipertahankan. Nama job-nya mungkin bukan `test`: wajibkan check dengan nama job yang sebenarnya di ruleset, atau ganti isinya dengan template."
            : "File di atas tidak diubah; periksa apakah cocok dengan template.",
        ];
  return [
    `Proyek: \`${project}\` (${repo})`,
    "",
    "## Template CI proyek baru (Fase 7c)",
    "Isi template tetap, bukan buatan AI:",
    ...files.map((f) => `- \`${f}\``),
    ...skipLines,
    "",
    "Job CI bernama `test`: `npm run build` lalu `npm test` (cek `dist/index.html` + rujukan file lokal). Tanpa dependensi.",
    "",
    "## Setelah merge",
    "1. Buat ruleset `protect-main` di repo ini: wajib Pull Request, wajib check `test`, tanpa force push/hapus.",
    "2. Hubungkan Cloudflare Workers Builds ke repo ini (build command `npm run build`).",
    "",
    "_Dibuat otomatis oleh agent. Review dulu; merge hanya jika CI hijau._",
  ].join("\n");
}

export async function bootstrapProject(env: GithubEnv, project: Project, now = Date.now()): Promise<BootstrapResult> {
  if (project.kind !== "external") {
    return { ok: false, status: 400, step: "validate", error: "bootstrap hanya untuk proyek eksternal" };
  }
  try {
    const inst = await getInstallationToken(env);
    if (inst.permissions.workflows !== "write") {
      return {
        ok: false,
        status: 412,
        step: "permission",
        error: "GitHub App belum punya izin Workflows (read and write)",
        hint: "Settings > Developer settings > GitHub Apps > 101-project-agent > Permissions > Repository permissions > Workflows: Read and write > Save. Lalu di halaman Install App klik Accept new permissions.",
      };
    }
    const all = templateFiles(project.worker ?? project.name);
    const existing = new Set<string>();
    for (const f of all) {
      if (await readRepoFile(inst.token, project.repo, f.path, "main")) existing.add(f.path);
    }
    const files = missingFiles(all, existing);
    const skipped = skippedFiles(all, existing);
    if (files.length === 0) {
      return { ok: false, status: 409, step: "exists", error: "semua file template sudah ada di main", skipped };
    }
    const names = files.map((f) => f.path);
    const pr = await openPullRequest(env, {
      repo: project.repo,
      title: "agent: Template CI proyek baru",
      body: bootstrapBody(project.name, project.repo, names, skipped),
      branch: bootstrapBranch(now),
      files,
      token: inst.token,
      allowCiWorkflow: names.includes(CI_WORKFLOW_PATH),
    });
    return { ok: true, pr_number: pr.number, pr_url: pr.url, branch: pr.branch, files: names, skipped };
  } catch (err) {
    if (err instanceof GithubError) {
      return { ok: false, status: 502, step: err.step, error: err.message };
    }
    console.error("bootstrap:", err);
    return { ok: false, status: 500, step: "unknown", error: "internal_error" };
  }
}
