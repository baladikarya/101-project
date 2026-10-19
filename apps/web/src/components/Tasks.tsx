import { TaskDetailSchema, TaskListSchema, type TaskDetail, type TaskList, type TaskStatus } from "@avo/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, postJson } from "../api";

const API = "/api/tasks";

const BADGE: Record<TaskStatus, { label: string; cls: string }> = {
  queued: { label: "Antre", cls: "border-line text-muted" },
  running: { label: "Berjalan", cls: "border-accent text-accent" },
  pausing: { label: "Menjeda…", cls: "border-line text-muted" },
  paused: { label: "Dijeda", cls: "border-line text-muted" },
  completed: { label: "Selesai", cls: "border-ok text-ok" },
  failed: { label: "Gagal", cls: "border-bad text-bad" },
};

const fmtTime = (ms: number) => new Date(ms).toLocaleString("id-ID");
const fmtNum = (n: number | null) => (n === null ? "—" : n.toLocaleString("id-ID"));
const isActive = (s: TaskStatus) => s === "queued" || s === "running" || s === "pausing";

function errText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Sesi habis. Muat ulang lalu masuk lagi.";
    return err.detail ?? `Gagal (HTTP ${err.status}).`;
  }
  return "Tidak bisa menghubungi server.";
}

export function Tasks() {
  const [list, setList] = useState<TaskList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await getJson(API, TaskListSchema));
      if (open) setDetail(await getJson(`${API}/${open}`, TaskDetailSchema));
      setError(null);
    } catch (err) {
      setError(errText(err));
    }
  }, [open]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anyActive = list?.tasks.some((t) => isActive(t.status)) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [anyActive, refresh]);

  async function submit() {
    if (prompt.trim().length < 3) return;
    setBusy(true);
    try {
      await postJson(API, { prompt });
      setPrompt("");
      setError(null);
      await refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "pause" | "resume" | "retry") {
    setBusy(true);
    try {
      await postJson(`${API}/${id}/${action}`);
      setError(null);
      await refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setDetail(null);
    setOpen((cur) => (cur === id ? null : id));
  }

  const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40";

  return (
    <div className="space-y-4">
      <section>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={4000}
          aria-label="Tugas untuk AI Manager"
          placeholder="Kirim tugas ke AI Manager…"
          className="w-full rounded-xl border border-line bg-surface p-3 text-sm"
        />
        <button
          onClick={() => void submit()}
          disabled={busy || prompt.trim().length < 3}
          className="mt-2 w-full rounded-lg bg-accent py-2 font-medium text-accent-ink disabled:opacity-40"
        >
          {busy ? "Memproses…" : "Kirim tugas"}
        </button>
        {list && (
          <p className="mt-2 text-xs text-muted">
            Hari ini (UTC): {list.today.tasks}/{list.today.limit} tugas · {fmtNum(list.today.tokens)} token
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-bad px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {list?.tasks.map((t) => {
          const badge = BADGE[t.status];
          const expanded = open === t.id;
          return (
            <li key={t.id} className="rounded-2xl border border-line bg-surface">
              <button onClick={() => toggle(t.id)} aria-expanded={expanded} className="w-full p-3 text-left">
                <div className="flex items-start justify-between gap-2">
                  <span className="break-words text-sm font-semibold">{t.title}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {fmtTime(t.created_at)} · percobaan {t.attempts} · {fmtNum(t.total_tokens)} token
                </p>
              </button>

              {expanded && (
                <div className="space-y-3 border-t border-line p-3 text-sm">
                  <div className="flex gap-2">
                    {(t.status === "queued" || t.status === "running") && (
                      <button
                        disabled={busy}
                        onClick={() => void act(t.id, "pause")}
                        className={`${btn} border border-line`}
                      >
                        Pause
                      </button>
                    )}
                    {(t.status === "paused" || t.status === "pausing") && (
                      <button
                        disabled={busy}
                        onClick={() => void act(t.id, "resume")}
                        className={`${btn} bg-accent text-accent-ink`}
                      >
                        Resume
                      </button>
                    )}
                    {t.status === "failed" && (
                      <button
                        disabled={busy}
                        onClick={() => void act(t.id, "retry")}
                        className={`${btn} bg-accent text-accent-ink`}
                      >
                        Retry
                      </button>
                    )}
                  </div>

                  {t.error && <p className="break-words rounded-xl border border-bad px-3 py-2 text-bad">{t.error}</p>}

                  {!detail || detail.task.id !== t.id ? (
                    <p className="text-muted">Memuat…</p>
                  ) : (
                    <>
                      <section>
                        <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Tugas</h3>
                        <p className="whitespace-pre-wrap break-words">{detail.task.prompt}</p>
                      </section>
                      {detail.task.result && (
                        <section>
                          <h3 className="mb-1 text-xs font-semibold uppercase text-muted">
                            Hasil ({detail.task.provider}/{detail.task.model})
                          </h3>
                          <p className="whitespace-pre-wrap break-words">{detail.task.result}</p>
                        </section>
                      )}
                      {detail.usage.length > 0 && (
                        <section>
                          <h3 className="mb-1 text-xs font-semibold uppercase text-muted">
                            Token (angka dari penyedia AI)
                          </h3>
                          <ul className="space-y-0.5 text-xs text-muted">
                            {detail.usage.map((u) => (
                              <li key={u.attempt}>
                                #{u.attempt} · masuk {fmtNum(u.prompt_tokens)} · keluar {fmtNum(u.completion_tokens)} ·
                                total {fmtNum(u.total_tokens)} · {u.latency_ms ?? "—"} ms
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      <section>
                        <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Riwayat</h3>
                        <ul className="space-y-0.5 text-xs text-muted">
                          {detail.events.map((e) => (
                            <li key={e.id}>
                              {fmtTime(e.created_at)} — {e.message}
                            </li>
                          ))}
                        </ul>
                      </section>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {list && list.tasks.length === 0 && (
          <li className="rounded-2xl border border-dashed border-line px-4 py-5 text-sm text-muted">
            Belum ada tugas. Kirim satu di atas; hasilnya tersimpan dan tetap terlihat setelah browser ditutup.
          </li>
        )}
      </ul>
    </div>
  );
}
