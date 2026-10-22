import { describe, expect, it } from "vitest";
import { branchFor, buildDevMessages, summarizeCi, type CiRun } from "./build";

const run = (o: Partial<CiRun>): CiRun => ({
  name: "CI",
  workflow_id: 1,
  status: "completed",
  conclusion: "success",
  html_url: "https://x/1",
  created_at: "2026-10-22T01:00:00Z",
  ...o,
});

describe("branchFor", () => {
  it("deterministik dan lolos aturan branch agent/*", () => {
    const b = branchFor("3F2A9C10-aaaa-bbbb", 2);
    expect(b).toBe("agent/run-3f2a9c10-a2");
    expect(/^agent\/[a-z0-9][a-z0-9._-]{0,80}$/.test(b)).toBe(true);
  });
});

describe("buildDevMessages", () => {
  it("memasukkan tujuan, analyst, architect, dan daftar file", () => {
    const { messages } = buildDevMessages({
      project: "demo-landing",
      goal: "Landing kopi",
      deps: [
        { agent: "analyst", title: "a", output: "KEB-1" },
        { agent: "architect", title: "b", output: "RANC-1" },
      ],
      existingFiles: ["README.md"],
    });
    const u = messages[1]?.content ?? "";
    expect(u).toContain("Landing kopi");
    expect(u).toContain("KEB-1");
    expect(u).toContain("RANC-1");
    expect(u).toContain("- README.md");
    expect(messages[0]?.content).toContain("=== FILE:");
  });
  it("memotong hasil yang terlalu panjang", () => {
    const { messages } = buildDevMessages({
      project: "p",
      goal: "g",
      deps: [{ agent: "architect", title: "b", output: "x".repeat(9000) }],
      existingFiles: [],
    });
    expect((messages[1]?.content ?? "").length).toBeLessThan(6000);
  });
});

describe("summarizeCi", () => {
  it("tanpa run -> none", () => expect(summarizeCi([]).state).toBe("none"));
  it("semua sukses -> pass", () => expect(summarizeCi([run({})]).state).toBe("pass"));
  it("ada yang gagal -> fail", () => expect(summarizeCi([run({ conclusion: "failure" })]).state).toBe("fail"));
  it("sedang berjalan -> pending", () => expect(summarizeCi([run({ status: "in_progress", conclusion: null })]).state).toBe("pending"));
  it("action_required -> needs_approval", () =>
    expect(summarizeCi([run({ conclusion: "action_required" })]).state).toBe("needs_approval"));
  it("hanya run terbaru per workflow yang dihitung", () => {
    const old = run({ conclusion: "failure", created_at: "2026-10-22T00:00:00Z" });
    expect(summarizeCi([old, run({})]).state).toBe("pass");
  });
  it("gagal mengalahkan pending", () => {
    const r = summarizeCi([run({ conclusion: "failure" }), run({ workflow_id: 2, status: "queued", conclusion: null })]);
    expect(r.state).toBe("fail");
  });
});
