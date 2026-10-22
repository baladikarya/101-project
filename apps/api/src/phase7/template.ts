// Fase 7c: template CI proyek baru. Isi TETAP (bukan buatan AI) supaya aman ditulis ke .github/workflows.
// Proyek target = situs statis: build menyalin file situs ke dist/, tes memeriksa dist/ + rujukan file.

export interface TemplateFile {
  path: string;
  content: string;
}

export const WORKER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const CI_YML = [
  "name: CI",
  "",
  "on:",
  "  pull_request:",
  "    branches: [main]",
  "  workflow_dispatch:",
  "",
  "permissions:",
  "  contents: read",
  "",
  "concurrency:",
  "  group: ci-${{ github.ref }}",
  "  cancel-in-progress: true",
  "",
  "jobs:",
  "  test:",
  "    name: test",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "        with:",
  "          node-version: 22",
  "      - run: npm run build",
  "      - run: npm test",
  "",
].join("\n");

// Tanpa backtick dan tanpa pemisah templat: skrip ini ditulis apa adanya ke repo target.
const SITE_MJS = String.raw`// Build + tes situs statis. Tanpa dependensi.
// node scripts/site.mjs build  -> salin file situs ke dist/
// node scripts/site.mjs check  -> pastikan dist/index.html ada dan semua rujukan lokal ada
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, extname, join, posix } from "node:path";

const SKIP_DIRS = new Set(["dist", "scripts", "node_modules"]);
const SKIP_FILES = new Set(["package.json", "package-lock.json", "wrangler.jsonc", "README.md"]);

function walk(dir, rel, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), r, out);
    } else if (!(rel === "" && SKIP_FILES.has(e.name))) {
      out.push(r);
    }
  }
  return out;
}

function build() {
  rmSync("dist", { recursive: true, force: true });
  const files = walk(".", "", []);
  for (const f of files) {
    mkdirSync(dirname(join("dist", f)), { recursive: true });
    copyFileSync(f, join("dist", f));
  }
  console.log("build: " + files.length + " file -> dist/");
}

function refsOf(html) {
  const refs = [];
  const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(m[1].trim());
  return refs;
}

function check() {
  const errors = [];
  if (!existsSync("dist/index.html") || statSync("dist/index.html").size === 0) {
    errors.push("dist/index.html tidak ada atau kosong");
  }
  const pages = existsSync("dist") ? walk("dist", "", []).filter((f) => extname(f).toLowerCase() === ".html") : [];
  for (const page of pages) {
    const base = posix.dirname(page);
    for (const ref of refsOf(readFileSync(join("dist", page), "utf8"))) {
      if (!ref || /^(https?:|\/\/|mailto:|tel:|data:|javascript:|#)/i.test(ref)) continue;
      const clean = ref.split(/[?#]/)[0];
      if (!clean) continue;
      let target = clean.startsWith("/") ? posix.normalize(clean.slice(1)) : posix.normalize(posix.join(base, clean));
      if (target === "." || target.endsWith("/")) target = posix.join(target, "index.html");
      if (!existsSync(join("dist", target))) errors.push(page + " merujuk " + ref + " yang tidak ada");
    }
  }
  if (errors.length) {
    for (const e of errors) console.error("GAGAL: " + e);
    process.exit(1);
  }
  console.log("check: OK (" + pages.length + " halaman HTML)");
}

const cmd = process.argv[2];
if (cmd === "build") build();
else if (cmd === "check") check();
else {
  console.error("pakai: node scripts/site.mjs build|check");
  process.exit(2);
}
`;

export function templateFiles(workerName: string): TemplateFile[] {
  if (!WORKER_NAME_RE.test(workerName)) throw new Error(`nama worker tidak valid: ${workerName}`);
  const pkg = {
    name: workerName,
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      build: "node scripts/site.mjs build",
      test: "node scripts/site.mjs build && node scripts/site.mjs check",
    },
  };
  const wrangler = [
    "{",
    '  "$schema": "node_modules/wrangler/config-schema.json",',
    `  "name": "${workerName}",`,
    '  "compatibility_date": "2025-10-01",',
    '  "assets": { "directory": "dist" }',
    "}",
    "",
  ].join("\n");
  return [
    { path: ".github/workflows/ci.yml", content: CI_YML },
    { path: "package.json", content: `${JSON.stringify(pkg, null, 2)}\n` },
    { path: "wrangler.jsonc", content: wrangler },
    { path: "scripts/site.mjs", content: SITE_MJS },
  ];
}

/** Hanya file yang belum ada di main yang dibuat; file yang sudah ada tidak pernah ditimpa. */
export function missingFiles(files: readonly TemplateFile[], existing: ReadonlySet<string>): TemplateFile[] {
  return files.filter((f) => !existing.has(f.path));
}
