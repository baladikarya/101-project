import { HealthSchema, type Health } from "@avo/shared";
import { useCallback, useEffect, useState } from "react";
import { getJson } from "../api";

type State = { kind: "loading" } | { kind: "ok"; health: Health } | { kind: "down" };

function Row({ label, ok }: { label: string; ok: boolean | null }) {
  const color = ok === null ? "bg-muted" : ok ? "bg-ok" : "bg-bad";
  const text = ok === null ? "Memeriksa…" : ok ? "Berjalan" : "Gangguan";
  return (
    <div className="flex items-center justify-between py-3">
      <span>{label}</span>
      <span className="flex items-center gap-2 text-sm text-muted">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
        {text}
      </span>
    </div>
  );
}

export function Overview() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const check = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ok", health: await getJson("/api/health", HealthSchema) });
    } catch {
      setState({ kind: "down" });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const api = state.kind === "loading" ? null : state.kind === "ok";
  const db = state.kind === "loading" ? null : state.kind === "ok" && state.health.db;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-surface px-4">
        <div className="flex items-center justify-between pt-3">
          <h2 className="font-semibold">Status sistem</h2>
          <button onClick={() => void check()} className="text-sm font-medium text-accent">
            Periksa ulang
          </button>
        </div>
        <div className="divide-y divide-line">
          <Row label="API" ok={api} />
          <Row label="Database cloud (D1)" ok={db} />
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-line px-4 py-5">
        <h2 className="font-semibold">Belum ada proyek</h2>
        <p className="mt-1 text-sm text-muted">
          Aplikasi sudah online dan terhubung ke database. Proyek, task, dan progres agent muncul di sini
          setelah agent nyata diaktifkan di tahap berikutnya.
        </p>
      </section>
    </div>
  );
}
