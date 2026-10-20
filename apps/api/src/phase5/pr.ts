// Fase 5: agent membuat branch terpisah + commit + Pull Request.
// Tidak pernah menyentuh main langsung dan tidak pernah merge.

import { GITHUB_REPO, GithubError, getInstallationToken, githubRequest, type GithubEnv } from "./github-app";

export interface PrFile {
  path: string;
  content: string;
}

export interface PrInput {
  title: string;
  body: string;
  branch: string;
  files: PrFile[];
  base?: string;
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

export function assertSafePath(path: string): void {
  const bad =
    path.length === 0 ||
    path.length > 200 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  if (bad) throw new GithubError("validate", `path file tidak aman: ${path}`);
  if (path.startsWith(".github/workflows/")) {
    throw new GithubError("validate", "agent tidak boleh mengubah .github/workflows");
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function openPullRequest(env: GithubEnv, input: PrInput): Promise<PrResult> {
  assertSafeBranch(input.branch);
  if (input.files.length === 0) throw new GithubError("validate", "minimal satu file");
  for (const f of input.files) assertSafePath(f.path);
  const base = input.base ?? "main";

  const { token } = await getInstallationToken(env);
  const repo = `/repos/${GITHUB_REPO}`;

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
    await githubRequest(token, "PUT", `${repo}/contents/${encodePath(f.path)}`, "commit_file", {
      message: `agent: ${input.title}`.slice(0, 200),
      content: toBase64Utf8(f.content),
      branch: input.branch,
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
