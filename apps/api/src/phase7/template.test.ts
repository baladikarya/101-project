import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAgentPath, AgentOutputError } from "../phase5/code-parse";
import { assertSafePath } from "../phase5/pr";
import { bootstrapBody, bootstrapBranch } from "./bootstrap";
import { missingFiles, templateFiles } from "./template";

function site(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "site-"));
  for (const t of templateFiles("demo-landing")) {
    if (t.path.startsWith(".github/")) continue;
    mkdirSync(dirname(join(dir, t.path)), { recursive: true });
    writeFileSync(join(dir, t.path), t.content);
  }
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

function run(dir: string, cmd: "build" | "check"): { code: number; out: string } {
  try {
    const out = execFileSync("node", ["scripts/site.mjs", cmd], { cwd: dir, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stderr?: string; stdout?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("templateFiles", () => {
  const files = templateFiles("demo-landing");
  const get = (p: string) => files.find((f) => f.path === p)?.content ?? "";

  it("berisi 4 file tetap", () => {
    expect(files.map((f) => f.path)).toEqual([
      ".github/workflows/ci.yml",
      "package.json",
      "wrangler.jsonc",
      "scripts/site.mjs",
    ]);
  });

  it("ci.yml punya job bernama test, izin read-only, tanpa secret", () => {
    const ci = get(".github/workflows/ci.yml");
    expect(ci).toContain("  test:\n    name: test");
    expect(ci).toContain("contents: read");
    expect(ci).toContain("pull_request:");
    expect(ci).not.toContain("secrets.");
  });

  it("package.json valid, tanpa dependensi", () => {
    const pkg = JSON.parse(get("package.json")) as Record<string, unknown>;
    expect(pkg.name).toBe("demo-landing");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
  });

  it("wrangler.jsonc memakai nama worker dan aset dist", () => {
    expect(get("wrangler.jsonc")).toContain('"name": "demo-landing"');
    expect(get("wrangler.jsonc")).toContain('"directory": "dist"');
  });

  it("menolak nama worker tidak valid", () => {
    expect(() => templateFiles("../x")).toThrow();
    expect(() => templateFiles("Besar")).toThrow();
  });

  it("missingFiles tidak menimpa file yang sudah ada", () => {
    const m = missingFiles(files, new Set(["package.json"]));
    expect(m.map((f) => f.path)).not.toContain("package.json");
    expect(m).toHaveLength(3);
  });
});

describe("skrip site.mjs (dijalankan sungguhan)", () => {
  it("build + check lulus untuk halaman valid", () => {
    const dir = site({ "index.html": '<a href="#menu">m</a><link href="css/s.css"><a href="/about/">a</a>', "css/s.css": "a{}", "about/index.html": "<p>x</p>" });
    expect(run(dir, "build").code).toBe(0);
    const r = run(dir, "check");
    expect(r.code, r.out).toBe(0);
    expect(readFileSync(join(dir, "dist/css/s.css"), "utf8")).toBe("a{}");
  });

  it("check gagal bila rujukan file hilang", () => {
    const dir = site({ "index.html": '<script src="app.js"></script>' });
    run(dir, "build");
    const r = run(dir, "check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("app.js");
  });

  it("check gagal bila index.html tidak ada", () => {
    const dir = site({ "lain.html": "<p>x</p>" });
    run(dir, "build");
    expect(run(dir, "check").code).toBe(1);
  });

  it("file template tidak ikut ke dist", () => {
    const dir = site({ "index.html": "<p>x</p>" });
    run(dir, "build");
    const r = run(dir, "check");
    expect(r.code).toBe(0);
    expect(() => readFileSync(join(dir, "dist/package.json"))).toThrow();
    expect(() => readFileSync(join(dir, "dist/scripts/site.mjs"))).toThrow();
  });
});

describe("izin workflow", () => {
  it("assertSafePath: hanya ci.yml dan hanya dengan flag", () => {
    expect(() => assertSafePath(".github/workflows/ci.yml")).toThrow();
    expect(() => assertSafePath(".github/workflows/ci.yml", true)).not.toThrow();
    expect(() => assertSafePath(".github/workflows/evil.yml", true)).toThrow();
  });

  it("agent AI tetap tidak boleh menyentuh .github atau berkas template", () => {
    for (const p of [".github/workflows/ci.yml", "package.json", "wrangler.jsonc"]) {
      expect(() => assertAgentPath(p, "external"), p).toThrow(AgentOutputError);
    }
  });
});

describe("bootstrap helpers", () => {
  it("branch lolos aturan agent/*", () => {
    const b = bootstrapBranch(Date.UTC(2026, 9, 22, 3, 4, 5));
    expect(b).toBe("agent/bootstrap-20261022t030405z");
    expect(/^agent\/[a-z0-9][a-z0-9._-]{0,80}$/.test(b)).toBe(true);
  });

  it("body PR memuat file dan langkah ruleset", () => {
    const body = bootstrapBody("demo-landing", "o/demo-landing", ["package.json"]);
    expect(body).toContain("`package.json`");
    expect(body).toContain("protect-main");
  });
});
