// Tipe minimal modul Node yang dipakai template.test.ts (paket @types/node tidak dipasang).
declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args: string[],
    options: { cwd: string; encoding: "utf8"; stdio: "pipe" },
  ): string;
}
declare module "node:fs" {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding?: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:path" {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}
