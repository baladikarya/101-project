import {
  AGENT_ROLES,
  AGENT_STATE_LABEL,
  OfficeSchema,
  type AgentState,
  type Office as OfficeData,
  type OfficeAgent,
} from "@avo/shared";
import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, getJson } from "../api";
import { BottomSheet } from "./BottomSheet";
import { Desk } from "./icons";

const POLL_MS = 5000;
const VIEW_KEY = "avo.office.view";
const LOW_KEY = "avo.office.low";

// Three.js hanya diunduh saat tampilan 3D benar-benar dibuka.
const Scene3D = lazy(() => import("./Scene3D"));

type View = "3d" | "2d";

function webglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

function initialView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === "2d") return "2d";
  } catch {
    // penyimpanan tidak tersedia
  }
  return webglOk() ? "3d" : "2d";
}

// Tebakan awal untuk HP lemah. Pilihan pengguna (tersimpan) selalu menang.
function autoLow(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (
    (n.deviceMemory !== undefined && n.deviceMemory <= 2) ||
    (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 4) ||
    n.connection?.saveData === true
  );
}

function initialLow(): boolean {
  try {
    const saved = localStorage.getItem(LOW_KEY);
    if (saved === "on") return true;
    if (saved === "off") return false;
  } catch {
    // penyimpanan tidak tersedia
  }
  return autoLow();
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return on;
}

// Bila 3D gagal dimuat atau dirender, jatuh ke tampilan 2D alih-alih layar kosong.
class SceneBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

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
  const [view, setView] = useState<View>(initialView);
  const [note, setNote] = useState<string | null>(null);
  const [low, setLow] = useState(initialLow);
  const dark = useMedia("(prefers-color-scheme: dark)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  const pick = (v: View) => {
    setView(v);
    setNote(null);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // abaikan
    }
  };
  const toggleLow = () => {
    const next = !low;
    setLow(next);
    try {
      localStorage.setItem(LOW_KEY, next ? "on" : "off");
    } catch {
      // abaikan
    }
  };
  const fail3d = useCallback(() => {
    setView("2d");
    setNote("Tampilan 3D tidak bisa dimuat di perangkat ini. Memakai tampilan 2D.");
  }, []);

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
      <div role="group" aria-label="Pilih tampilan" className="mb-3 inline-flex rounded-xl border border-line p-0.5 text-sm">
        {(["3d", "2d"] as const).map((v) => (
          <button
            key={v}
            onClick={() => pick(v)}
            aria-pressed={view === v}
            className={`rounded-lg px-4 py-1.5 font-medium ${view === v ? "bg-accent text-accent-ink" : "text-muted"}`}
          >
            {v === "3d" ? "3D" : "2D"}
          </button>
        ))}
      </div>
      {view === "3d" && (
        <button
          onClick={toggleLow}
          aria-pressed={low}
          className={`mb-3 ml-2 rounded-xl border px-3 py-2 text-sm font-medium ${
            low ? "border-accent text-accent" : "border-line text-muted"
          }`}
        >
          Hemat grafis: {low ? "nyala" : "mati"}
        </button>
      )}
      {note && <p className="mb-3 text-sm text-muted">{note}</p>}

      {view === "3d" && data ? (
        <div>
          <div className="h-[min(62vh,30rem)] overflow-hidden rounded-2xl border border-line">
            <SceneBoundary onFail={fail3d}>
              <Suspense fallback={<p className="p-4 text-sm text-muted">Memuat kantor 3D…</p>}>
                <Scene3D agents={data.agents} dark={dark} reduced={reduced} low={low} onSelect={setSelected} onLost={fail3d} />
              </Suspense>
            </SceneBoundary>
          </div>
          <p className="mt-2 text-xs text-muted">
            Ketuk agent untuk detail · geser untuk memutar · cubit untuk zoom.
          </p>
        </div>
      ) : (
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
      )}
      {agent && <AgentSheet agent={agent} onClose={() => setSelected(null)} />}
    </div>
  );
}
