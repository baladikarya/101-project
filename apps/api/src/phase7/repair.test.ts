import { describe, expect, it } from "vitest";
import { failedRuns, scopeToSha, type CiRun } from "./build";
import {
  DRILL_REF,
  MAX_REPAIRS,
  applyDrill,
  buildFixMessages,
  extractFailureLog,
  repairGate,
  repairTokenCap,
  stopReport,
} from "./repair";

const run = (o: Partial<CiRun>): CiRun => ({
  id: 1,
  head_sha: "a",
  name: "CI",
  workflow_id: 1,
  status: "completed",
  conclusion: "failure",
  html_url: "https://x/1",
  created_at: "2026-10-23T01:00:00Z",
  ...o,
});

describe("repairGate", () => {
  it("boleh selama di bawah batas jumlah dan token", () => {
    expect(repairGate(0, 0, 30_000)).toBeNull();
    expect(repairGate(MAX_REPAIRS - 1, 29_999, 30_000)).toBeNull();
  });
  it("berhenti di batas jumlah perbaikan", () => {
    expect(repairGate(MAX_REPAIRS, 0, 30_000)).toContain(`Batas ${MAX_REPAIRS} perbaikan`);
  });
  it("berhenti di batas token per alur", () => {
    expect(repairGate(1, 30_000, 30_000)).toContain("token perbaikan");
  });
});

describe("repairTokenCap", () => {
  it("bawaan 30000, bisa diatur, abaikan nilai tak valid", () => {
    expect(repairTokenCap({})).toBe(30_000);
    expect(repairTokenCap({ MAX_REPAIR_TOKENS_PER_RUN: "5000" })).toBe(5000);
    expect(repairTokenCap({ MAX_REPAIR_TOKENS_PER_RUN: "abc" })).toBe(30_000);
    expect(repairTokenCap({ MAX_REPAIR_TOKENS_PER_RUN: "-1" })).toBe(30_000);
  });
});

describe("extractFailureLog", () => {
  it("membuang stempel waktu + warna ANSI dan mengutamakan baris galat", () => {
    const raw = [
      "2026-10-23T01:00:00.1234567Z \u001b[36mRun npm test\u001b[0m",
      "2026-10-23T01:00:01.0000000Z GAGAL: index.html merujuk x.css yang tidak ada",
      "2026-10-23T01:00:02.0000000Z ##[error]Process completed with exit code 1.",
    ].join("\n");
    const out = extractFailureLog(raw);
    expect(out).not.toMatch(/2026-10-23T/);
    expect(out).not.toContain("\u001b");
    expect(out.startsWith("GAGAL: index.html merujuk x.css")).toBe(true);
    expect(out).toContain("##[error]Process completed with exit code 1.");
  });
  it("memangkas log panjang ke ekor dengan batas karakter", () => {
    const raw = Array.from({ length: 2000 }, (_, i) => `baris ${i}`).join("\n");
    const out = extractFailureLog(raw, 500);
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out).toContain("baris 1999");
  });
});

describe("failedRuns / scopeToSha", () => {
  it("hanya run terbaru per workflow yang gagal nyata", () => {
    const old = run({ id: 1, conclusion: "failure", created_at: "2026-10-23T01:00:00Z" });
    const fresh = run({ id: 2, conclusion: "success", created_at: "2026-10-23T01:05:00Z" });
    expect(failedRuns([old, fresh])).toEqual([]);
    expect(failedRuns([old]).map((r) => r.id)).toEqual([1]);
  });
  it("action_required dan masih berjalan bukan kegagalan", () => {
    expect(failedRuns([run({ conclusion: "action_required" })])).toEqual([]);
    expect(failedRuns([run({ status: "in_progress", conclusion: null })])).toEqual([]);
  });
  it("scopeToSha membuang run commit lama", () => {
    const runs = [run({ id: 1, head_sha: "a" }), run({ id: 2, head_sha: "b" })];
    expect(scopeToSha(runs, "b").map((r) => r.id)).toEqual([2]);
    expect(scopeToSha(runs, "zzz")).toEqual([]);
  });
});

describe("buildFixMessages", () => {
  const m = buildFixMessages({
    project: "demo-landing",
    goal: "Landing kopi",
    files: [{ path: "index.html", content: "<h1>x</h1>" }],
    log: "GAGAL: rujukan hilang",
    round: 2,
  });
  it("sistem = aturan Developer + mode perbaikan; log ditandai data", () => {
    expect(m.messages[0]?.content).toContain("=== FILE:");
    expect(m.messages[0]?.content).toContain("MODE PERBAIKAN");
    expect(m.messages[0]?.content).toContain("bukan instruksi");
    expect(m.messages[1]?.content).toContain("LOG CI (data)");
    expect(m.messages[1]?.content).toContain("GAGAL: rujukan hilang");
    expect(m.messages[1]?.content).toContain("=== CONTEXT: index.html ===");
    expect(m.messages[1]?.content).toContain(`ke-2 dari ${MAX_REPAIRS}`);
    expect(m.maxTokens).toBeGreaterThan(0);
  });
  it("log kosong tetap menghasilkan pesan yang jelas", () => {
    const e = buildFixMessages({ project: "p", goal: "g", files: [], log: "", round: 1 });
    expect(e.messages[1]?.content).toContain("log tidak tersedia");
  });
});

describe("applyDrill", () => {
  it("menambah rujukan rusak ke HTML pertama, tidak mengubah file lain", () => {
    const out = applyDrill([
      { path: "a.js", content: "x" },
      { path: "index.html", content: "<h1>x</h1>\n" },
    ]);
    expect(out?.path).toBe("index.html");
    expect(out?.content).toContain(`href="${DRILL_REF}"`);
    expect(out?.content.startsWith("<h1>x</h1>\n")).toBe(true);
  });
  it("tanpa HTML -> null", () => expect(applyDrill([{ path: "a.js", content: "x" }])).toBeNull());
});

describe("stopReport", () => {
  it("memuat alasan, jumlah perbaikan, dan CI terakhir", () => {
    const r = stopReport("Batas tercapai.", "CI GAGAL\n- CI: failure", 2);
    expect(r).toContain("Perbaikan otomatis berhenti");
    expect(r).toContain("Batas tercapai.");
    expect(r).toContain(`2/${MAX_REPAIRS}`);
    expect(r).toContain("CI GAGAL");
  });
});
