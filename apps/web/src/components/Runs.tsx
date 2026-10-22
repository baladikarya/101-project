import {
  AGENT_ROLES,
  PIPELINE_TEMPLATES,
  ProjectListSchema,
  RunDetailSchema,
  RunListSchema,
  stepKindOf,
  type RunDetail,
  type RunList,
  type RunStatus,
  type StepStatus,
} from "@avo/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson, postJson } from "../api";

const API = "/api/runs";

const RUN_BADGE: Record<RunStatus, { label: string; cls: string }> = {
  queued: { label: "Antre", cls: "border-line text-muted" },
  running: { label: "Berjalan", cls: "border-accent text-accent" },
  awaiting_approval: { label: "Menunggu persetujuan", cls: "border-accent text-accent" },
  pausing: { label: "Menjeda…", cls: "border-line text-muted" },
  paused: { label: "Dijeda", cls: "border-line text-muted" },
  completed: { label: "Selesai", cls: "border-ok text-ok" },
  failed: { label: "Gagal", cls: "border-bad text-bad" },
  rejected: { label: "Ditolak", cls: "border-bad text-bad" },
};

const STEP_LABEL: Record<StepStatus, { label: string; cls: string }> = {
  pending: { label: "Menunggu giliran", cls: "text-muted" },
  running: { label: "Dikerjakan", cls: "text-accent" },
  awaiting_approval: { label: "Perlu persetujuan", cls: "text-accent" },
  completed: { label: "Selesai", cls: "text-ok" },
  failed: { label: "Gagal", cls: "text-bad" },
  rejected: { label: "Ditolak", cls: "text-bad" },
};

const fmtTime = (ms: number) => new Date(ms).toLocaleString("id-ID");
const fmtNum = (n: number | null) => (n === null ? "—" : n.toLocaleString("id-ID"));
const agentName = (id: string) => AGENT_ROLES.find((a) => a.id === id)?.name ?? id;
const isBusy = (s: RunStatus) => s === "queued" || s === "running" || s === "pausing";

function errText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Sesi habis. Muat ulang lalu masuk lagi.";
    return err.detail ?? `Gagal (HTTP ${err.status}).`;
  }
  return "Tidak bisa menghubungi server.";
}

export function Runs() {
  const [list, setList] = useState<RunList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [goal, setGoal] = useState("");
  const [template, setTemplate] = useState(PIPELINE_TEMPLATES[0]?.id ?? "standard");
  const [note, setNote] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await getJson(API, RunListSchema));
      if (open) setDetail(await getJson(`${API}/${open}`, RunDetailSchema));
      setError(null);
    } catch (err) {
      setError(errText(err));
    }
  }, [open]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    getJson("/api/projects", ProjectListSchema)
      .then((r) => {
        const names = r.projects.filter((p) => p.kind === "external" && p.status !== "archived").map((p) => p.name);
        setProjects(names);
        setProject((cur) => cur || names[0] || "");
      })
      .catch(() => setProjects([]));
  }, []);

  const anyBusy = list?.runs.some((r) => isBusy(r.status)) ?? false;
  useEffect(() => {
    if (!anyBusy) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [anyBusy, refresh]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      setError(null);
      await refresh();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const tpl = PIPELINE_TEMPLATES.find((t) => t.id === template);

  const submit = () =>
    run(async () => {
      await postJson(API, { goal, template, ...(tpl?.needsProject ? { project } : {}) });
      setGoal("");
    });

  const act = (id: string, action: "pause" | "resume" | "retry") => run(() => postJson(`${API}/${id}/${action}`));

  const decide = (id: string, action: "approve" | "reject") =>
    run(async () => {
      await postJson(`${API}/${id}/${action}`, note.trim() ? { note: note.trim() } : {});
      setNote("");
    });

  function toggle(id: string) {
    setDetail(null);
    setNote("");
    setOpen((cur) => (cur === id ? null : id));
  }

  const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40";
  const lim = list?.limits;

  return (
    <div className="space-y-4">
      <section>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          maxLength={4000}
          aria-label="Tujuan proyek untuk tim agent"
          placeholder="Tujuan proyek untuk tim agent…"
          className="w-full rounded-xl border border-line bg-surface p-3 text-sm"
        />
        <select
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          aria-label="Susunan tim"
          className="mt-2 w-full rounded-xl border border-line bg-surface p-2.5 text-sm"
        >
          {PIPELINE_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {tpl?.needsProject && (
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            aria-label="Proyek target"
            className="mt-2 w-full rounded-xl border border-line bg-surface p-2.5 text-sm"
          >
            {projects.length === 0 && <option value="">Belum ada proyek target</option>}
            {projects.map((n) => (
              <option key={n} value={n}>
                Proyek target: {n}
              </option>
            ))}
          </select>
        )}
        {tpl && (
          <p className="mt-1 text-xs text-muted">
            {tpl.steps.filter((s) => stepKindOf(s) !== "ci").length} panggilan AI
            {tpl.needsProject ? " · hasil: 1 Pull Request (tidak di-merge)" : ""} · persetujuan Anda diminta di:{" "}
            {tpl.steps
              .filter((s) => s.needsApproval)
              .map((s) => agentName(s.agent))
              .join(", ")}
          </p>
        )}
        <button
          onClick={() => void submit()}
          disabled={busy || goal.trim().length < 10 || (tpl?.needsProject === true && !project)}
          className="mt-2 w-full rounded-lg bg-accent py-2 font-medium text-accent-ink disabled:opacity-40"
        >
          {busy ? "Memproses…" : "Mulai alur tim"}
        </button>
        {lim && (
          <p className="mt-2 text-xs text-muted">
            {lim.free_tier_only ? "Free Tier Only: aktif" : "Free Tier Only: MATI"} · hari ini (UTC): {lim.runs.used}/
            {lim.runs.limit} alur · {lim.calls.used}/{lim.calls.limit} panggilan · {fmtNum(lim.tokens.used)}/
            {fmtNum(lim.tokens.limit)} token
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-bad px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {list?.runs.map((r) => {
          const badge = RUN_BADGE[r.status];
          const expanded = open === r.id;
          return (
            <li key={r.id} className="rounded-2xl border border-line bg-surface">
              <button onClick={() => toggle(r.id)} aria-expanded={expanded} className="w-full p-3 text-left">
                <div className="flex items-start justify-between gap-2">
                  <span className="break-words text-sm font-semibold">{r.title}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {fmtTime(r.created_at)} · {r.steps_done}/{r.steps_total} langkah · percobaan {r.attempts} ·{" "}
                  {fmtNum(r.total_tokens)} token
                  {r.project ? ` · ${r.project}` : ""}
                </p>
              </button>

              {expanded && (
                <div className="space-y-3 border-t border-line p-3 text-sm">
                  <div className="flex gap-2">
                    {(r.status === "queued" || r.status === "running") && (
                      <button disabled={busy} onClick={() => void act(r.id, "pause")} className={`${btn} border border-line`}>
                        Pause
                      </button>
                    )}
                    {(r.status === "paused" || r.status === "pausing") && (
                      <button disabled={busy} onClick={() => void act(r.id, "resume")} className={`${btn} bg-accent text-accent-ink`}>
                        Resume
                      </button>
                    )}
                    {(r.status === "failed" || r.status === "rejected") && (
                      <button disabled={busy} onClick={() => void act(r.id, "retry")} className={`${btn} bg-accent text-accent-ink`}>
                        Retry
                      </button>
                    )}
                  </div>

                  {r.error && <p className="break-words rounded-xl border border-bad px-3 py-2 text-bad">{r.error}</p>}

                  {!detail || detail.run.id !== r.id ? (
                    <p className="text-muted">Memuat…</p>
                  ) : (
                    <>
                      <section>
                        <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Tujuan</h3>
                        <p className="whitespace-pre-wrap break-words">{detail.run.goal}</p>
                        {detail.run.pr_url && (
                          <p className="mt-2 break-words">
                            Pull Request:{" "}
                            <a href={detail.run.pr_url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
                              {detail.run.project} #{detail.run.pr_number}
                            </a>
                          </p>
                        )}
                      </section>

                      <ol className="space-y-2">
                        {detail.steps.map((s) => {
                          const st = STEP_LABEL[s.status];
                          const waiting = s.status === "awaiting_approval" && detail.run.status === "awaiting_approval";
                          return (
                            <li key={s.idx} className="rounded-xl border border-line p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-medium">
                                  {s.idx + 1}. {agentName(s.agent)}
                                  <span className="block text-xs font-normal text-muted">
                                    {s.title}
                                    {s.depends_on.length > 0 && ` · butuh hasil langkah ${s.depends_on.map((d) => d + 1).join(", ")}`}
                                  </span>
                                </span>
                                <span className={`shrink-0 text-xs ${st.cls}`}>{st.label}</span>
                              </div>
                              {s.error && <p className="mt-1 break-words text-xs text-bad">{s.error}</p>}
                              {s.output && (
                                <details className="mt-2" open={waiting}>
                                  <summary className="cursor-pointer text-xs font-medium text-accent">Lihat hasil</summary>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-xs">{s.output}</p>
                                </details>
                              )}
                              {s.total_tokens !== null && (
                                <p className="mt-1 text-xs text-muted">
                                  {s.provider}/{s.model} · masuk {fmtNum(s.prompt_tokens)} · keluar{" "}
                                  {fmtNum(s.completion_tokens)} · total {fmtNum(s.total_tokens)} · {s.latency_ms ?? "—"} ms
                                </p>
                              )}
                              {s.approval_note && <p className="mt-1 text-xs text-muted">Catatan Anda: {s.approval_note}</p>}
                              {waiting && (
                                <div className="mt-2 space-y-2">
                                  <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={2}
                                    maxLength={500}
                                    aria-label="Catatan untuk agent (opsional)"
                                    placeholder="Catatan (opsional; dipakai agent bila Anda menolak lalu Retry)"
                                    className="w-full rounded-lg border border-line bg-surface p-2 text-xs"
                                  />
                                  <div className="flex gap-2">
                                    <button disabled={busy} onClick={() => void decide(r.id, "approve")} className={`${btn} bg-accent text-accent-ink`}>
                                      Setujui
                                    </button>
                                    <button disabled={busy} onClick={() => void decide(r.id, "reject")} className={`${btn} border border-bad text-bad`}>
                                      Tolak
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ol>

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
        {list && list.runs.length === 0 && (
          <li className="rounded-2xl border border-dashed border-line px-4 py-5 text-sm text-muted">
            Belum ada alur. Tulis tujuan proyek di atas; agent bekerja berurutan, meminta persetujuan Anda di titik
            penting, dan hasilnya tersimpan walau browser ditutup.
          </li>
        )}
      </ul>
    </div>
  );
}
