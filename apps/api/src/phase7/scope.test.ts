import { describe, expect, it } from "vitest";
import { AgentOutputError, assertAgentPath, parseAgentOutput } from "../phase5/code-parse";
import { assertSafeRepo } from "../phase5/github-app";
import { validateInput } from "../phase5/code-task";

describe("path scope external (proyek terpisah)", () => {
  it("menerima path bebas di root repo", () => {
    for (const p of ["index.html", "css/style.css", "src/app.ts", ".gitignore"]) {
      expect(() => assertAgentPath(p, "external"), p).not.toThrow();
    }
  });

  it("tetap menolak path berbahaya dan file sensitif", () => {
    for (const p of [
      "../x",
      "/etc/passwd",
      "a//b",
      ".github/workflows/ci.yml",
      ".git/config",
      "node_modules/x/index.js",
      "package.json",
      "sub/package-lock.json",
      "wrangler.jsonc",
      ".env",
      ".env.production",
      "pnpm-lock.yaml",
    ]) {
      expect(() => assertAgentPath(p, "external"), p).toThrow(AgentOutputError);
    }
  });

  it("scope self tetap ketat", () => {
    expect(() => assertAgentPath("index.html")).toThrow(AgentOutputError);
    expect(() => assertAgentPath("index.html", "self")).toThrow(AgentOutputError);
  });

  it("parseAgentOutput memakai scope", () => {
    const text = "TITLE: t\n=== FILE: index.html ===\n<h1>hai</h1>\n=== END FILE ===";
    expect(() => parseAgentOutput(text)).toThrow(AgentOutputError);
    expect(parseAgentOutput(text, "external").files[0]?.path).toBe("index.html");
  });
});

describe("assertSafeRepo", () => {
  it("menerima pemilik/nama", () => {
    expect(() => assertSafeRepo("baladikarya/demo-landing")).not.toThrow();
  });
  it("menolak bentuk lain", () => {
    for (const r of ["demo-landing", "a/b/c", "../x/y", "a/..", "a/b?x=1", " a/b", "a/b#c", ""]) {
      expect(() => assertSafeRepo(r), r).toThrow();
    }
  });
});

describe("validateInput project", () => {
  const base = { instruction: "buat halaman landing sederhana", paths: [] };
  it("project wajib", () => {
    expect(() => validateInput(base)).toThrow(/project/);
    expect(() => validateInput({ ...base, project: "../x" })).toThrow(/project/);
  });
  it("menerima project valid", () => {
    expect(validateInput({ ...base, project: "demo-landing" }).project).toBe("demo-landing");
  });
});
