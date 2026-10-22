import { describe, expect, it } from "vitest";
import { EXTERNAL_PROMPT } from "../phase5/code-task";
import { branchFor, buildDevMessages, buildPrBody, lintFiles, summarizeCi, type CiRun } from "./build";

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

describe("lintFiles", () => {
  const html = (body: string) => [{ path: "index.html", content: body }];
  it("menandai file lokal yang tidak ada", () => {
    const w = lintFiles(html('<link href="style.css"><script src="script.js"></script><img src="assets/a.jpg">'), []);
    expect(w).toHaveLength(3);
    expect(w[0]).toContain("style.css");
  });
  it("file yang ikut di PR atau sudah ada di repo tidak ditandai", () => {
    const files = [...html('<link href="style.css"><script src="app.js"></script>'), { path: "style.css", content: "" }];
    expect(lintFiles(files, ["app.js"])).toEqual([]);
  });
  it("URL eksternal biasa, mailto, dan anchor tidak ditandai", () => {
    expect(lintFiles(html('<a href="https://x.com">x</a><a href="#menu">m</a><a href="tel:1">t</a>'), [])).toEqual([]);
  });
  it("form ke URL eksternal dan href=# ditandai", () => {
    const w = lintFiles(html('<form action="https://formspree.io/f/abc"></form><a href="#">x</a>'), []);
    expect(w.join("|")).toMatch(/formspree/);
    expect(w.join("|")).toMatch(/link mati/);
  });
  it("path relatif mengikuti folder file", () => {
    const w = lintFiles([{ path: "site/index.html", content: '<img src="a.png">' }], []);
    expect(w[0]).toContain("site/a.png");
  });
  it("peringatan masuk ke badan PR", () => {
    const body = buildPrBody({ project: "p", repo: "o/p", runId: "r", goal: "g", summary: "s", files: ["index.html"], provider: "groq", model: "m", warnings: ["w1"] });
    expect(body).toContain("Peringatan otomatis");
    expect(body).toContain("- w1");
    expect(buildPrBody({ project: "p", repo: "o/p", runId: "r", goal: "g", summary: "s", files: [], provider: "g", model: "m" })).not.toContain("Peringatan");
  });
});

describe("prompt Developer eksternal", () => {
  it("melarang mengarang URL/ID, gambar, form eksternal, dan link mati", () => {
    expect(EXTERNAL_PROMPT).toMatch(/Jangan mengarang URL/);
    expect(EXTERNAL_PROMPT).toMatch(/tanpa gambar/i);
    expect(EXTERNAL_PROMPT).toMatch(/form action/);
    expect(EXTERNAL_PROMPT).toMatch(/href="#" dilarang/);
  });
});
