// Cloudflare Workflow: satu alur multi-agent (Analyst -> Architect -> ... -> QA).
// Langkah dijalankan berurutan sesuai indeks; hasil dependensi dikirim sebagai konteks.
// Langkah bertanda needsApproval berhenti di waitForEvent sampai pemilik setuju/tolak.
// Semua status/hasil/token ada di D1, jadi tetap terlihat setelah browser ditutup.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { AiError, createProvider, type AiResult } from "../phase2/ai";
import { getInstallationToken } from "../phase5/github-app";
import { parseAgentOutput, AgentOutputError } from "../phase5/code-parse";
import { overDailyLimit, type CodeEnv } from "../phase5/code-task";
import { openPullRequest } from "../phase5/pr";
import {
  CI_MAX_POLLS,
  CI_POLL_DELAY,
  branchFor,
  buildDevMessages,
  buildPrBody,
  fetchCiRuns,
  listRepoFiles,
  summarizeCi,
} from "../phase7/build";
import { getProject, isUsable } from "../phase7/projects";
import { buildMessages, checkBudget, isProviderAllowed, readLimits, type DepOutput } from "./pipeline";
import { dayStartMs, runEventStmt, type Phase3Env, type RunParams } from "./shared";

interface StepRow {
  idx: number;
  agent: string;
  title: string;
  depends_on: string;
  needs_approval: number;
  kind: string;
  status: string;
  output: string | null;
  approval_note: string | null;
}

type Prepared =
  | { action: "skip" }
  | { action: "approve" }
  | {
      action: "run";
      agent: string;
      title: string;
      kind: "ai" | "pr" | "ci";
      project: string | null;
      repo: string | null;
      branch: string | null;
      needsApproval: boolean;
      goal: string;
      deps: DepOutput[];
      previousOutput: string | null;
      note: string | null;
    };

interface ApprovalPayload {
  approved: boolean;
  note?: string;
}

// Jangan menimpa status pause yang diminta pemilik saat langkah sedang selesai.
const SET_ACTIVE =
  "UPDATE p3_runs SET status = CASE WHEN status IN ('pausing','paused') THEN status ELSE ? END, current_step = ?, error = NULL, updated_at = ? WHERE id = ?";

export async function loadDayUsage(env: Phase3Env) {
  const start = dayStartMs();
  const [runs, p3, p2] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM p3_runs WHERE created_at >= ?").bind(start).first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n, SUM(total_tokens) AS t FROM p3_usage_logs WHERE created_at >= ?")
      .bind(start)
      .first<{ n: number; t: number | null }>(),
    env.DB.prepare("SELECT COUNT(*) AS n, SUM(total_tokens) AS t FROM p2_usage_logs WHERE created_at >= ?")
      .bind(start)
      .first<{ n: number; t: number | null }>(),
  ]);
  return {
    runs: runs?.n ?? 0,
    calls: (p3?.n ?? 0) + (p2?.n ?? 0),
    tokens: (p3?.t ?? 0) + (p2?.t ?? 0),
  };
}

/** Cek CI Pull Request berkala (step.sleep tidak memakai sumber daya). Lulus -> teks ringkasan; selain itu error. */
async function pollCi(env: Phase3Env, step: WorkflowStep, idx: number, repo: string, branch: string): Promise<string> {
  let last = "CI belum diperiksa.";
  for (let n = 0; n < CI_MAX_POLLS; n++) {
    const v = await step.do(`s${idx}-ci-${n}`, { retries: { limit: 2, delay: "10 seconds" }, timeout: "30 seconds" }, async () => {
      const { token } = await getInstallationToken(env as unknown as CodeEnv);
      return summarizeCi(await fetchCiRuns(token, repo, branch));
    });
    last = v.text;
    if (v.state === "pass") return v.text;
    if (v.state === "fail") throw new NonRetryableError(v.text.slice(0, 450));
    if (n < CI_MAX_POLLS - 1) await step.sleep(`s${idx}-ci-wait-${n}`, CI_POLL_DELAY);
  }
  const hint = last.startsWith("Belum ada run CI")
    ? " Repo target perlu workflow CI (pull_request). Setelah ada, tekan Retry."
    : " Tekan Retry untuk memeriksa lagi.";
  throw new NonRetryableError(`CI belum selesai setelah ${CI_MAX_POLLS} menit. ${last.split("\n")[0]}${hint}`.slice(0, 480));
}

export class PipelineRunWorkflow extends WorkflowEntrypoint<Phase3Env, RunParams> {
  async run(event: WorkflowEvent<RunParams>, step: WorkflowStep) {
    const { runId, attempt } = event.payload;
    const env = this.env;
    let currentIdx: number | null = null;

    try {
      const info = await step.do("load-run", async () => {
        const run = await env.DB.prepare("SELECT goal, project FROM p3_runs WHERE id = ?")
          .bind(runId)
          .first<{ goal: string; project: string | null }>();
        if (!run) throw new NonRetryableError("Alur tidak ditemukan di D1");
        const { results } = await env.DB.prepare("SELECT idx FROM p3_steps WHERE run_id = ? ORDER BY idx ASC")
          .bind(runId)
          .all<{ idx: number }>();
        if (results.length === 0) throw new NonRetryableError("Alur tidak punya langkah");
        await env.DB.batch([
          env.DB.prepare(SET_ACTIVE).bind("running", null, Date.now(), runId),
          runEventStmt(env.DB, runId, `${runId}-${attempt}-start`, "running", `Percobaan ${attempt} dimulai`),
        ]);
        return { goal: run.goal, project: run.project, indexes: results.map((r) => r.idx) };
      });

      for (const idx of info.indexes) {
        currentIdx = idx;

        // 1) Baca keadaan langkah + periksa batas harian. Hasilnya di-cache Workflow.
        const prep = await step.do(`s${idx}-prepare`, async (): Promise<Prepared> => {
          const row = await env.DB.prepare(
            "SELECT idx, agent, title, depends_on, needs_approval, kind, status, output, approval_note FROM p3_steps WHERE run_id = ? AND idx = ?",
          )
            .bind(runId, idx)
            .first<StepRow>();
          if (!row) throw new NonRetryableError(`Langkah ${idx} tidak ada`);
          if (row.status === "completed") return { action: "skip" };
          if (row.status === "awaiting_approval") {
            await env.DB.prepare(SET_ACTIVE).bind("awaiting_approval", idx, Date.now(), runId).run();
            return { action: "approve" };
          }

          const limits = readLimits(env);
          const need = checkBudget(await loadDayUsage(env), limits, 1, false);
          if (need) throw new NonRetryableError(`${need} Free Tier Only: coba lagi setelah reset 00:00 UTC.`);

          const depIdx = JSON.parse(row.depends_on) as number[];
          const deps: DepOutput[] = [];
          for (const d of depIdx) {
            const dep = await env.DB.prepare(
              "SELECT agent, title, output FROM p3_steps WHERE run_id = ? AND idx = ? AND status = 'completed'",
            )
              .bind(runId, d)
              .first<{ agent: string; title: string; output: string | null }>();
            if (!dep?.output) throw new NonRetryableError(`Dependensi langkah ${d} belum selesai`);
            deps.push({ agent: dep.agent, title: dep.title, output: dep.output });
          }

          const kind = row.kind === "pr" || row.kind === "ci" ? row.kind : "ai";
          let repo: string | null = null;
          let branch: string | null = null;
          if (kind !== "ai") {
            const proj = info.project ? await getProject(env.DB, info.project) : null;
            if (!proj || !isUsable(proj) || proj.kind !== "external") {
              throw new NonRetryableError("Proyek target tidak valid (harus proyek eksternal yang aktif).");
            }
            repo = proj.repo;
          }
          if (kind === "pr") {
            if (await overDailyLimit(env as unknown as CodeEnv)) {
              throw new NonRetryableError("Batas harian tugas coding tercapai. Coba lagi besok (UTC).");
            }
            branch = branchFor(runId, attempt);
          }
          if (kind === "ci") {
            const r = await env.DB.prepare("SELECT branch FROM p3_runs WHERE id = ?")
              .bind(runId)
              .first<{ branch: string | null }>();
            if (!r?.branch) throw new NonRetryableError("Pull Request belum ada; langkah Developer belum selesai.");
            branch = r.branch;
          }

          const now = Date.now();
          await env.DB.batch([
            env.DB.prepare("UPDATE p3_steps SET status = 'running', error = NULL, updated_at = ? WHERE run_id = ? AND idx = ?").bind(
              now,
              runId,
              idx,
            ),
            env.DB.prepare(SET_ACTIVE).bind("running", idx, now, runId),
            runEventStmt(env.DB, runId, `${runId}-${attempt}-s${idx}-start`, "step", `${row.title}: dimulai`),
          ]);
          return {
            action: "run",
            agent: row.agent,
            title: row.title,
            kind,
            project: info.project,
            repo,
            branch,
            needsApproval: row.needs_approval === 1,
            goal: info.goal,
            deps,
            previousOutput: row.output,
            note: row.approval_note,
          };
        });

        if (prep.action === "skip") continue;

        let needsApproval = true;

        if (prep.action === "run") {
          needsApproval = prep.needsApproval;

          // 2) Hasil langkah: AI teks, AI kode + PR, atau cek CI.
          let ai: AiResult | null = null;
          let output: string;
          let pr: { number: number; url: string; branch: string; title: string; files: string[] } | null = null;

          if (prep.kind === "ci") {
            output = await pollCi(env, step, idx, prep.repo as string, prep.branch as string);
          } else {
            ai = await step.do(
              `s${idx}-ai`,
              { retries: { limit: 4, delay: "15 seconds", backoff: "exponential" }, timeout: "90 seconds" },
              async () => {
                try {
                  const provider = createProvider(env);
                  if (!isProviderAllowed(provider.name, readLimits(env).freeTierOnly)) {
                    throw new NonRetryableError(`Penyedia "${provider.name}" tidak gratis; Free Tier Only aktif.`);
                  }
                  if (prep.kind === "pr") {
                    const { token } = await getInstallationToken(env as unknown as CodeEnv);
                    const existingFiles = await listRepoFiles(token, prep.repo as string);
                    const dev = buildDevMessages({
                      project: prep.project as string,
                      goal: prep.goal,
                      deps: prep.deps,
                      existingFiles,
                    });
                    return await provider.complete(dev.messages, { maxTokens: dev.maxTokens, temperature: 0.2 });
                  }
                  const { messages, maxTokens } = buildMessages({
                    agent: prep.agent,
                    title: prep.title,
                    goal: prep.goal,
                    deps: prep.deps,
                    previousOutput: prep.previousOutput,
                    note: prep.note,
                  });
                  return await provider.complete(messages, { maxTokens });
                } catch (e) {
                  if (e instanceof AiError && !e.retryable) throw new NonRetryableError(e.message);
                  throw e;
                }
              },
            );
            output = ai.text;

            if (prep.kind === "pr") {
              const aiText = ai.text;
              const model = `${ai.provider}/${ai.model}`;
              // Tanpa retry otomatis: branch sudah dibuat bila gagal di tengah. Pemilik bisa Retry (branch baru per percobaan).
              pr = await step.do(`s${idx}-pr`, { retries: { limit: 0, delay: "5 seconds" }, timeout: "90 seconds" }, async () => {
                let out;
                try {
                  out = parseAgentOutput(aiText, "external");
                } catch (e) {
                  if (e instanceof AgentOutputError) throw new NonRetryableError(`Jawaban Developer tidak valid: ${e.message}`);
                  throw e;
                }
                const res = await openPullRequest(env as unknown as CodeEnv, {
                  repo: prep.repo as string,
                  title: `agent: ${out.title}`,
                  body: buildPrBody({
                    project: prep.project as string,
                    repo: prep.repo as string,
                    runId,
                    goal: prep.goal,
                    summary: out.summary,
                    files: out.files.map((f) => f.path),
                    provider: ai?.provider ?? "?",
                    model: ai?.model ?? model,
                  }),
                  branch: prep.branch as string,
                  files: out.files,
                });
                return { ...res, title: out.title, files: out.files.map((f) => f.path) };
              });
              output = `Pull Request #${pr.number} dibuka: ${pr.url}\nBranch: ${pr.branch}\nFile: ${pr.files.join(", ")}\nTidak di-merge; pemilik yang menyetujui di GitHub.`;
            }
          }

          // 3) Simpan hasil + token apa adanya dari penyedia.
          await step.do(`s${idx}-save`, async () => {
            const now = Date.now();
            const nextStep = needsApproval ? "awaiting_approval" : "completed";
            const stmts: D1PreparedStatement[] = [];
            if (ai) {
              stmts.push(
                env.DB.prepare(
                  `INSERT OR REPLACE INTO p3_usage_logs
                 (id, run_id, step_idx, attempt, agent, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).bind(
                  `${runId}-${attempt}-s${idx}`,
                  runId,
                  idx,
                  attempt,
                  prep.agent,
                  ai.provider,
                  ai.model,
                  ai.usage.promptTokens,
                  ai.usage.completionTokens,
                  ai.usage.totalTokens,
                  ai.latencyMs,
                  now,
                ),
              );
            }
            if (pr) {
              stmts.push(
                env.DB.prepare("UPDATE p3_runs SET branch = ?, pr_number = ?, pr_url = ? WHERE id = ?").bind(
                  pr.branch,
                  pr.number,
                  pr.url,
                  runId,
                ),
                // Masuk riwayat + batas harian tugas coding (Fase 5).
                env.DB.prepare(
                  `INSERT OR REPLACE INTO p5_code_tasks
                   (id, project, instruction, paths, status, title, branch, pr_number, pr_url, model, prompt_tokens, completion_tokens, total_tokens, created_at, updated_at)
                   VALUES (?, ?, ?, '[]', 'pr_open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).bind(
                  `${runId}-a${attempt}`,
                  prep.project,
                  `[alur tim] ${prep.goal}`.slice(0, 2000),
                  pr.title,
                  pr.branch,
                  pr.number,
                  pr.url,
                  ai?.model ?? null,
                  ai?.usage.promptTokens ?? null,
                  ai?.usage.completionTokens ?? null,
                  ai?.usage.totalTokens ?? null,
                  now,
                  now,
                ),
              );
            }
            stmts.push(
              env.DB.prepare(
                `UPDATE p3_steps SET status = ?, output = ?, approval_note = NULL, provider = ?, model = ?,
                   prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, latency_ms = ?, error = NULL, updated_at = ?
                 WHERE run_id = ? AND idx = ?`,
              ).bind(
                nextStep,
                output,
                ai?.provider ?? (prep.kind === "ci" ? "github-actions" : null),
                ai?.model ?? null,
                ai?.usage.promptTokens ?? null,
                ai?.usage.completionTokens ?? null,
                ai?.usage.totalTokens ?? null,
                ai?.latencyMs ?? null,
                now,
                runId,
                idx,
              ),
              env.DB.prepare(SET_ACTIVE).bind(needsApproval ? "awaiting_approval" : "running", idx, now, runId),
              runEventStmt(
                env.DB,
                runId,
                `${runId}-${attempt}-s${idx}-done`,
                needsApproval ? "approval" : "step",
                needsApproval
                  ? `${prep.title}: selesai, menunggu persetujuan`
                  : pr
                    ? `${prep.title}: PR #${pr.number} dibuka`
                    : ai
                      ? `${prep.title}: selesai (${ai.provider}/${ai.model}, ${ai.latencyMs} ms)`
                      : `${prep.title}: CI lulus`,
              ),
            );
            await env.DB.batch(stmts);
          });
        }

        // 4) Persetujuan pemilik (bila langkah ini memintanya).
        if (needsApproval) {
          const decision = await step.waitForEvent<ApprovalPayload>(`s${idx}-approval`, {
            type: `approval-${idx}`,
            timeout: "3 days",
          });
          const approved = decision.payload.approved === true;
          const note = (decision.payload.note ?? "").slice(0, 500) || null;

          await step.do(`s${idx}-decide`, async () => {
            const now = Date.now();
            await env.DB.batch([
              env.DB.prepare(
                "UPDATE p3_steps SET status = ?, approval_note = ?, updated_at = ? WHERE run_id = ? AND idx = ?",
              ).bind(approved ? "completed" : "rejected", note, now, runId, idx),
              approved
                ? env.DB.prepare(SET_ACTIVE).bind("running", idx, now, runId)
                : env.DB.prepare(
                    "UPDATE p3_runs SET status = 'rejected', current_step = ?, updated_at = ? WHERE id = ?",
                  ).bind(idx, now, runId),
              runEventStmt(
                env.DB,
                runId,
                `${runId}-${attempt}-s${idx}-decide`,
                approved ? "approved" : "rejected",
                `${approved ? "Disetujui" : "Ditolak"}${note ? `: ${note}` : ""}`,
              ),
            ]);
          });

          if (!approved) return { runId, status: "rejected" };
        }
      }

      await step.do("finish", async () => {
        const now = Date.now();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE p3_runs SET status = 'completed', current_step = NULL, error = NULL, updated_at = ? WHERE id = ?",
          ).bind(now, runId),
          runEventStmt(env.DB, runId, `${runId}-${attempt}-done`, "completed", "Seluruh alur selesai"),
        ]);
      });
      return { runId, status: "completed" };
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await step.do("mark-failed", async () => {
        const now = Date.now();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE p3_steps SET status = 'failed', error = ?, updated_at = ? WHERE run_id = ? AND idx = ? AND status = 'running'",
          ).bind(msg, now, runId, currentIdx ?? -1),
          env.DB.prepare("UPDATE p3_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(
            msg,
            now,
            runId,
          ),
          runEventStmt(env.DB, runId, `${runId}-${attempt}-fail`, "failed", msg),
        ]);
      });
      throw err;
    }
  }
}
