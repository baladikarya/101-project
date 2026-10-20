import { describe, expect, it } from "vitest";
import { AgentOutputError, assertAgentPath, parseAgentOutput } from "./code-parse";

const good = [
  "TITLE: Tambah catatan",
  "SUMMARY: Dokumen baru",
  "=== FILE: docs/catatan.md ===",
  "# Catatan",
  "isi",
  "=== END FILE ===",
  "=== FILE: apps/web/src/x.ts ===",
  "```ts",
  "export const x = 1;",
  "```",
  "=== END FILE ===",
].join("\n");

describe("parseAgentOutput", () => {
  it("mem-parse judul, ringkasan, dan file", () => {
    const out = parseAgentOutput(good);
    expect(out.title).toBe("Tambah catatan");
    expect(out.summary).toBe("Dokumen baru");
    expect(out.files.map((f) => f.path)).toEqual(["docs/catatan.md", "apps/web/src/x.ts"]);
    expect(out.files[0]?.content).toBe("# Catatan\nisi\n");
    expect(out.files[1]?.content).toBe("export const x = 1;\n");
  });

  it("menolak jawaban tanpa file atau tanpa judul", () => {
    expect(() => parseAgentOutput("TITLE: a")).toThrow(AgentOutputError);
    expect(() => parseAgentOutput("halo")).toThrow(AgentOutputError);
  });

  it("menolak lebih dari 3 file", () => {
    const block = (n: number) => `=== FILE: docs/f${n}.md ===\nx\n=== END FILE ===`;
    const text = `TITLE: t\n${[1, 2, 3, 4].map(block).join("\n")}`;
    expect(() => parseAgentOutput(text)).toThrow(/maksimal/);
  });

  it("menolak file ganda", () => {
    const b = "=== FILE: docs/a.md ===\nx\n=== END FILE ===";
    expect(() => parseAgentOutput(`TITLE: t\n${b}\n${b}`)).toThrow(/ganda/);
  });
});

describe("assertAgentPath", () => {
  it("menerima path wajar", () => {
    expect(() => assertAgentPath("apps/web/src/App.tsx")).not.toThrow();
    expect(() => assertAgentPath("docs/x.md")).not.toThrow();
  });

  it("menolak path terlarang", () => {
    for (const p of [
      ".github/workflows/ci.yml",
      "wrangler.jsonc",
      "package.json",
      "apps/web/package.json",
      "apps/api/src/auth.ts",
      "apps/api/src/phase5/pr.ts",
      "apps/api/.env",
      "../x",
      "/etc/passwd",
      "src/x.ts",
    ]) {
      expect(() => assertAgentPath(p), p).toThrow(AgentOutputError);
    }
  });
});
