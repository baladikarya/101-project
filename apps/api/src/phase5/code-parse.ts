// Fase 5: aturan path + parser jawaban AI (format berpenanda, bukan JSON, agar kode tidak rusak oleh escaping).

export class AgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOutputError";
  }
}

export const MAX_FILES = 3;
export const MAX_FILE_CHARS = 30_000;

const ALLOWED_PREFIXES = ["apps/", "packages/", "docs/", "db/"];
const DENY_PREFIXES = ["apps/api/src/phase5/"];
const DENY_FILES = new Set(["apps/api/src/auth.ts"]);
const DENY_BASENAMES = new Set(["package.json", "package-lock.json", "wrangler.jsonc"]);

// "self" = repo platform ini (aturan ketat). "external" = proyek terpisah di p7_projects.
export type PathScope = "self" | "external";

const EXTERNAL_DENY_PREFIXES = [".github/", ".git/", "node_modules/"];
const EXTERNAL_DENY_BASENAMES = new Set(["yarn.lock", "pnpm-lock.yaml", ".gitmodules"]);

export function assertAgentPath(path: string, scope: PathScope = "self"): void {
  const segs = path.split("/");
  const malformed =
    path.length === 0 ||
    path.length > 200 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    segs.some((s) => s === "" || s === "." || s === "..");
  if (malformed) throw new AgentOutputError(`path tidak aman: ${path}`);
  const base = segs[segs.length - 1] ?? "";
  if (scope === "external") {
    const denied =
      EXTERNAL_DENY_PREFIXES.some((p) => path.startsWith(p)) ||
      DENY_BASENAMES.has(base) ||
      EXTERNAL_DENY_BASENAMES.has(base) ||
      base.startsWith(".env");
    if (denied) throw new AgentOutputError(`file terlarang untuk agent: ${path}`);
    return;
  }
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    throw new AgentOutputError(`path di luar apps/, packages/, docs/, db/: ${path}`);
  }
  if (DENY_BASENAMES.has(base) || base.startsWith(".env")) {
    throw new AgentOutputError(`file terlarang untuk agent: ${path}`);
  }
  if (DENY_FILES.has(path) || DENY_PREFIXES.some((p) => path.startsWith(p))) {
    throw new AgentOutputError(`file terlarang untuk agent: ${path}`);
  }
}

export interface AgentOutput {
  title: string;
  summary: string;
  files: { path: string; content: string }[];
}

function stripFence(s: string): string {
  const m = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(s);
  return m?.[1] ?? s;
}

export function parseAgentOutput(text: string, scope: PathScope = "self"): AgentOutput {
  const title = /^TITLE:[ \t]*(.+)$/m.exec(text)?.[1]?.trim().slice(0, 100);
  if (!title) throw new AgentOutputError("jawaban AI tanpa baris TITLE");
  const summary = (/^SUMMARY:[ \t]*(.+)$/m.exec(text)?.[1] ?? "").trim().slice(0, 500);

  const re = /^=== FILE: (.+?) ===[ \t]*\r?\n([\s\S]*?)\r?\n=== END FILE ===[ \t]*$/gm;
  const files: AgentOutput["files"] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const path = (m[1] ?? "").trim();
    assertAgentPath(path, scope);
    if (seen.has(path)) throw new AgentOutputError(`file ganda: ${path}`);
    seen.add(path);
    const content = `${stripFence(m[2] ?? "").replace(/\r\n/g, "\n")}\n`;
    if (content.length > MAX_FILE_CHARS) throw new AgentOutputError(`file terlalu besar: ${path}`);
    files.push({ path, content });
  }
  if (files.length === 0) throw new AgentOutputError("jawaban AI tanpa blok FILE");
  if (files.length > MAX_FILES) throw new AgentOutputError(`maksimal ${MAX_FILES} file`);
  return { title, summary, files };
}
