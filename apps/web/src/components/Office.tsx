import {
  AGENT_ROLES,
  AGENT_STATE_LABEL,
  OfficeSchema,
  type AgentState,
  type Office as OfficeData,
  type OfficeAgent,
} from "@avo/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson } from "../api";
import { BottomSheet } from "./BottomSheet";
import { Desk } from "./icons";

const POLL_MS = 5000;

const DOT: Record<AgentState, string> = {
  idle: "bg-muted",
  working: "bg-accent animate-pulse",
  waiting: "bg-accent",
  paused: "bg-muted",
  error: "bg-bad",
};
const TEXT: Record<AgentState, string> = {
  idle: "text-muted",
  working: "text-accent",
  waiting: "text-accent",
  paused: "text-muted",
  error: "text-bad",
};

const roleOf = (id: string) => AGENT_ROLES.find((a) => a.id === id);
const fmtNum = (n: number) => n.toLocaleString("id-ID");
const fmtTime = (ms: number | null) => (ms === null ? "belum pernah" : new Date(ms).toLocaleString("id-ID"));

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export function AgentSheet({ agent, onClose }: { agent: OfficeAgent; onClose: () => void }) {
  const role = roleOf(agent.id);
  return (
    <BottomSheet title={role?.name ?? agent.id} onClose={onClose}>
      <p className="mt-1 text-sm text-muted">{role?.job}</p>
      <p className={`mt-3 flex items-center gap-2 font-semibold ${TEXT[agent.state]}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${DOT[agent.state]}`} aria-hidden="true" />
        {AGENT_STATE_LABEL[agent.state]}
      </p>
      {agent.activity && (
        <p className="mt-2 text-sm">
          {agent.activity}
          {agent.context && <span className="text-muted"> · {agent.context}</span>}
        </p>
      )}
      {agent.error && (
        <p role="alert" className="mt-3 rounded-xl border border-bad px-3 py-2 text-sm text-bad">
          {agent.error}
        </p>
      )}
      <dl className="mt-3 divide-y divide-line border-t border-line">
        <Row label="Langkah selesai" value={fmtNum(agent.steps_done)} />
        <Row label="Total token" value={fmtNum(agent.total_tokens)} />
        <Row label="Terakhir aktif" value={fmtTime(agent.last_active)} />
      </dl>
    </BottomSheet>
  );
}

export function Office() {
  const [data, setData] = useState<OfficeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getJson("/api/office", OfficeSchema));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Sesi habis. Muat ulang lalu masuk lagi."
          : "Gagal memuat status kantor. Mencoba lagi otomatis.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const agent = data?.agents.find((a) => a.id === selected) ?? null;
  const working = data?.agents.filter((a) => a.state === "working").length ?? 0;

  return (
    <div>
      <p className="mb-4 text-sm text-muted" aria-live="polite">
        {data ? `${working} dari ${data.agents.length} agent sedang bekerja.` : "Memuat status agent…"} Status dibaca dari
        database, diperbarui otomatis.
      </p>
      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-bad px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3">
        {data?.agents.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => setSelected(a.id)}
              className="w-full rounded-2xl border border-line bg-surface p-3 text-left"
            >
              <Desk className={`h-9 w-11 ${a.state === "idle" ? "text-muted" : TEXT[a.state]}`} />
              <p className="mt-3 text-sm font-semibold leading-tight">{roleOf(a.id)?.name ?? a.id}</p>
              <p className={`mt-1 flex items-center gap-1.5 text-xs ${TEXT[a.state]}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[a.state]}`} aria-hidden="true" />
                {AGENT_STATE_LABEL[a.state]}
              </p>
              {a.activity && <p className="mt-1 line-clamp-2 text-xs text-muted">{a.activity}</p>}
            </button>
          </li>
        ))}
      </ul>
      {agent && <AgentSheet agent={agent} onClose={() => setSelected(null)} />}
    </div>
  );
}
