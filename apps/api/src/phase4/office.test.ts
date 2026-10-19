import { AGENT_ROLES } from "@avo/shared";
import { describe, expect, it } from "vitest";
import { deriveOffice, type OfficeInput, type RunInfo, type StepInfo } from "./office";

const base: OfficeInput = { runs: [], steps: [], tasks: [], stats: {}, now: 1 };
const run = (o: Partial<RunInfo> = {}): RunInfo => ({ id: "r1", title: "Proyek", status: "running", error: null, created_at: 1, ...o });
const step = (o: Partial<StepInfo> = {}): StepInfo => ({ run_id: "r1", agent: "analyst", title: "Analisis", status: "running", error: null, ...o });
const get = (o: ReturnType<typeof deriveOffice>, id: string) => o.agents.find((a) => a.id === id)!;

describe("deriveOffice", () => {
  it("semua agent idle bila tidak ada data, urutan sama dengan AGENT_ROLES", () => {
    const o = deriveOffice(base);
    expect(o.agents.map((a) => a.id)).toEqual(AGENT_ROLES.map((a) => a.id));
    expect(o.agents.every((a) => a.state === "idle" && a.activity === null && a.total_tokens === 0)).toBe(true);
  });

  it("langkah running di alur berjalan = working", () => {
    const a = get(deriveOffice({ ...base, runs: [run()], steps: [step()] }), "analyst");
    expect(a).toMatchObject({ state: "working", activity: "Analisis", context: "Proyek" });
  });

  it("awaiting_approval = waiting; alur dijeda = paused", () => {
    const w = deriveOffice({ ...base, runs: [run({ status: "awaiting_approval" })], steps: [step({ status: "awaiting_approval" })] });
    expect(get(w, "analyst").state).toBe("waiting");
    const p = deriveOffice({ ...base, runs: [run({ status: "paused" })], steps: [step()] });
    expect(get(p, "analyst").state).toBe("paused");
  });

  it("alur gagal: langkah gagal/terputus = error dengan pesan; langkah selesai tetap idle", () => {
    const o = deriveOffice({
      ...base,
      runs: [run({ status: "failed", error: "boom" })],
      steps: [step({ status: "failed", error: "Groq 401" }), step({ agent: "architect", status: "completed" })],
    });
    expect(get(o, "analyst")).toMatchObject({ state: "error", error: "Groq 401" });
    expect(get(o, "architect").state).toBe("idle");
  });

  it("alur selesai tidak membuat agent bekerja", () => {
    const o = deriveOffice({ ...base, runs: [run({ status: "completed" })], steps: [step({ status: "completed" })] });
    expect(get(o, "analyst").state).toBe("idle");
  });

  it("working mengalahkan error dari alur lain", () => {
    const o = deriveOffice({
      ...base,
      runs: [run({ id: "r2", created_at: 2 }), run({ id: "r1", status: "failed" })],
      steps: [step({ run_id: "r1", status: "failed" }), step({ run_id: "r2", title: "Baru" })],
    });
    expect(get(o, "analyst")).toMatchObject({ state: "working", activity: "Baru" });
  });

  it("manager mengikuti p2_tasks; gagal lama tidak dihitung", () => {
    const t = (status: "running" | "failed" | "completed", created_at: number) => ({ title: `T${created_at}`, status, error: status === "failed" ? "x" : null, created_at });
    expect(get(deriveOffice({ ...base, tasks: [t("running", 3)] }), "manager").state).toBe("working");
    expect(get(deriveOffice({ ...base, tasks: [t("completed", 3), t("failed", 2)] }), "manager").state).toBe("idle");
    expect(get(deriveOffice({ ...base, tasks: [t("failed", 3)] }), "manager").state).toBe("error");
  });

  it("statistik dan pesan error dipotong", () => {
    const o = deriveOffice({
      ...base,
      runs: [run({ status: "failed" })],
      steps: [step({ status: "failed", error: "x".repeat(500) })],
      stats: { analyst: { steps_done: 2, tokens: 99, last_active: 5 } },
    });
    expect(get(o, "analyst")).toMatchObject({ steps_done: 2, total_tokens: 99, last_active: 5 });
    expect(get(o, "analyst").error!.length).toBeLessThanOrEqual(201);
  });
});
