import { AGENT_ROLES } from "@avo/shared";
import { Desk } from "./icons";

export function Agents() {
  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Delapan peran di kantor. Semuanya belum diaktifkan; agent mulai bekerja setelah penyedia AI tersambung.
      </p>
      <ul className="grid grid-cols-2 gap-3">
        {AGENT_ROLES.map((agent) => (
          <li key={agent.id} className="rounded-2xl border border-line bg-surface p-3">
            <Desk className="h-9 w-11 text-muted" />
            <p className="mt-3 text-sm font-semibold leading-tight">{agent.name}</p>
            <p className="mt-1 text-xs leading-snug text-muted">{agent.job}</p>
            <p className="mt-3 text-xs text-muted">Belum aktif</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
