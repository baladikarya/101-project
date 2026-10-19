// Cloudflare Workflow: AI Manager mengerjakan satu tugas.
// Urutan: load-task -> call-ai -> save-result. Gagal -> mark-failed.
// Semua status/hasil/token ditulis ke D1, jadi tetap ada setelah browser ditutup.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { AiError, createProvider } from "./ai";
import { eventStmt, type Phase2Env, type TaskParams } from "./shared";

const MANAGER_SYSTEM = `Kamu AI Manager di "AI Virtual Office", kantor virtual berisi agent: Business Analyst, Software Architect, UI/UX Designer, Frontend Dev, Backend Dev, QA Engineer, DevOps & Security Engineer.
Pemilik mengirim tugas. Balas dalam Bahasa Indonesia, ringkas, dengan bagian:
1. Pemahaman tugas
2. Rencana langkah
3. Pembagian ke agent (hanya yang relevan)
4. Risiko / hal yang perlu ditanyakan
5. Hasil atau jawaban langsung bila tugas bisa dijawab sekarang
Aturan: kamu hanya menghasilkan teks. Jangan mengaku sudah menjalankan kode, deploy, atau mengubah file. Jangan mengarang data.`;

export class ManagerTaskWorkflow extends WorkflowEntrypoint<Phase2Env, TaskParams> {
  async run(event: WorkflowEvent<TaskParams>, step: WorkflowStep) {
    const { taskId, attempt } = event.payload;
    const env = this.env;
    const key = `${taskId}-${attempt}`;

    try {
      const task = await step.do("load-task", async () => {
        const row = await env.DB.prepare("SELECT prompt FROM p2_tasks WHERE id = ?")
          .bind(taskId)
          .first<{ prompt: string }>();
        if (!row) throw new NonRetryableError("Tugas tidak ditemukan di D1");
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE p2_tasks SET status = 'running', error = NULL, updated_at = ? WHERE id = ?",
          ).bind(Date.now(), taskId),
          eventStmt(env.DB, taskId, `${key}-start`, "running", `Percobaan ${attempt} dimulai`),
        ]);
        return { prompt: row.prompt };
      });

      const ai = await step.do(
        "call-ai",
        {
          retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
          timeout: "60 seconds",
        },
        async () => {
          try {
            return await createProvider(env).complete([
              { role: "system", content: MANAGER_SYSTEM },
              { role: "user", content: task.prompt },
            ]);
          } catch (e) {
            if (e instanceof AiError && !e.retryable) throw new NonRetryableError(e.message);
            throw e;
          }
        },
      );

      await step.do("save-result", async () => {
        const now = Date.now();
        await env.DB.batch([
          env.DB.prepare(
            `INSERT OR REPLACE INTO p2_usage_logs
             (id, task_id, attempt, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            key,
            taskId,
            attempt,
            ai.provider,
            ai.model,
            ai.usage.promptTokens,
            ai.usage.completionTokens,
            ai.usage.totalTokens,
            ai.latencyMs,
            now,
          ),
          env.DB.prepare(
            "UPDATE p2_tasks SET status = 'completed', result = ?, provider = ?, model = ?, error = NULL, updated_at = ? WHERE id = ?",
          ).bind(ai.text, ai.provider, ai.model, now, taskId),
          eventStmt(
            env.DB,
            taskId,
            `${key}-done`,
            "completed",
            `Selesai oleh ${ai.provider}/${ai.model} dalam ${ai.latencyMs} ms`,
          ),
        ]);
      });

      return { taskId, status: "completed" };
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await step.do("mark-failed", async () => {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE p2_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
          ).bind(msg, Date.now(), taskId),
          eventStmt(env.DB, taskId, `${key}-fail`, "failed", msg),
        ]);
      });
      throw err;
    }
  }
}
