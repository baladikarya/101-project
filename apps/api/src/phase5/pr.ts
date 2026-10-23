// Fase 5: agent membuat branch terpisah + commit + Pull Request.
// Tidak pernah menyentuh main langsung dan tidak pernah merge.

import { GithubError, assertSafeRepo, getInstallationToken, githubRequest, type GithubEnv } from "./github-app";

export interface PrFile {
  path: string;
  content: string;
}

export interface PrInput {
  repo: string; // "pemilik/nama", dipilih dari p7_projects
  title: string;
  body: string;
  branch: string;
  files: PrFile[];
  base?: string;
  token?: string;
  /** Hanya Fase 7c (bootstrap CI): izinkan tepat satu file workflow, .github/workflows/ci.yml. */
  allowCiWorkflow?: boolean;
}

export interface PrResult {
  number: number;
  url: string;
  branch: string;
}

export function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
}

export function assertSafeBranch(branch: string): void {
  if (!/^agent\/[a-z0-9][a-z0-9._-]{0,80}$/.test(branch) || branch.includes("..")) {
    throw new GithubError("validate", "nama branch harus berbentuk agent/<huruf-kecil-angka-.-_>");
  }
}

export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

export function assertSafePath(path: string, allowCiWorkflow = false): void {
  const bad =
    path.length === 0 ||
    path.length > 200 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (bad) throw new GithubError("validate", `path file tidak aman: ${path}`);
  if (path.startsWith(".github/workflows/") && !(allowCiWorkflow && path === CI_WORKFLOW_PATH)) {
    throw new GithubError("validate", "agent tidak boleh mengubah .github/workflows");
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

interface ContentsResponse {
  type?: string;
  sha: string;
  content?: string;
  encoding?: string;
}

export function fromBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Baca file dari repo. Mengembalikan null kalau file belum ada.
export async function readRepoFile(
  token: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  assertSafeRepo(repo);
  try {
    const res = await githubRequest<ContentsResponse>(
      token,
      "GET",
      `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      "read_file",
    );
    if (res.type !== "file" || res.encoding !== "base64") {
      throw new GithubError("read_file", `bukan file biasa: ${path}`);
    }
    return { content: fromBase64Utf8(res.content ?? ""), sha: res.sha };
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) return null;
    throw err;
  }
}

export async function openPullRequest(env: GithubEnv, input: PrInput): Promise<PrResult> {
  assertSafeRepo(input.repo);
  assertSafeBranch(input.branch);
  if (input.files.length === 0) throw new GithubError("validate", "minimal satu file");
  for (const f of input.files) assertSafePath(f.path, input.allowCiWorkflow === true);
  const base = input.base ?? "main";

  const token = input.token ?? (await getInstallationToken(env)).token;
  const repo = `/repos/${input.repo}`;

  const ref = await githubRequest<{ object: { sha: string } }>(
    token,
    "GET",
    `${repo}/git/ref/heads/${encodeURIComponent(base)}`,
    "base_ref",
  );
  await githubRequest(token, "POST", `${repo}/git/refs`, "create_branch", {
    ref: `refs/heads/${input.branch}`,
    sha: ref.object.sha,
  });
  for (const f of input.files) {
    const existing = await readRepoFile(token, input.repo, f.path, input.branch);
    await githubRequest(token, "PUT", `${repo}/contents/${encodePath(f.path)}`, "commit_file", {
      message: `agent: ${input.title}`.slice(0, 200),
      content: toBase64Utf8(f.content),
      branch: input.branch,
      ...(existing ? { sha: existing.sha } : {}),
    });
  }
  const pr = await githubRequest<{ number: number; html_url: string }>(token, "POST", `${repo}/pulls`, "create_pr", {
    title: input.title,
    head: input.branch,
    base,
    body: input.body,
  });
  return { number: pr.number, url: pr.html_url, branch: input.branch };
}

/** Fase 7e: commit perbaikan ke branch agent/* yang sudah ada (PR yang sama ikut diperbarui). Tidak pernah ke main. */
export async function pushToBranch(
  env: GithubEnv,
  input: { repo: string; branch: string; files: PrFile[]; message: string; token?: string },
): Promise<{ sha: string }> {
  assertSafeRepo(input.repo);
  assertSafeBranch(input.branch);
  if (input.files.length === 0) throw new GithubError("validate", "minimal satu file");
  for (const f of input.files) assertSafePath(f.path);
  const token = input.token ?? (await getInstallationToken(env)).token;
  let sha = "";
  for (const f of input.files) {
    const existing = await readRepoFile(token, input.repo, f.path, input.branch);
    const res = await githubRequest<{ commit?: { sha?: string } }>(
      token,
      "PUT",
      `/repos/${input.repo}/contents/${encodePath(f.path)}`,
      "commit_file",
      {
        message: input.message.slice(0, 200),
        content: toBase64Utf8(f.content),
        branch: input.branch,
        ...(existing ? { sha: existing.sha } : {}),
      },
    );
    sha = res.commit?.sha ?? "";
  }
  if (!sha) throw new GithubError("commit_file", "GitHub tidak mengembalikan SHA commit");
  return { sha };
}

export async function commentOnPr(token: string, repo: string, number: number, body: string): Promise<void> {
  assertSafeRepo(repo);
  await githubRequest(token, "POST", `/repos/${repo}/issues/${number}/comments`, "pr_comment", { body: body.slice(0, 4000) });
}

/** Path file yang diubah PR (bukan yang dihapus). */
export async function listPrFiles(token: string, repo: string, number: number): Promise<string[]> {
  assertSafeRepo(repo);
  const res = await githubRequest<{ filename: string; status: string }[]>(
    token,
    "GET",
    `/repos/${repo}/pulls/${number}/files?per_page=30`,
    "pr_files",
  );
  return res.filter((f) => f.status !== "removed").map((f) => f.filename);
}
