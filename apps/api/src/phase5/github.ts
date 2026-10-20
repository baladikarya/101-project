import { Hono } from "hono";
import type { AppEnv } from "../env";
import { GITHUB_REPO, GithubError, getInstallationToken, githubGet, type GithubEnv } from "./github-app";

interface RepoInfo {
  full_name: string;
  private: boolean;
  default_branch: string;
}

export const githubRoutes = new Hono<AppEnv>();

// Tes koneksi GitHub App. Tidak pernah mengembalikan token.
githubRoutes.get("/status", async (c) => {
  const env = c.env as unknown as GithubEnv;
  try {
    const inst = await getInstallationToken(env);
    const repo = await githubGet<RepoInfo>(inst.token, `/repos/${GITHUB_REPO}`, "repo");
    return c.json({
      ok: true,
      repo: repo.full_name,
      private: repo.private,
      default_branch: repo.default_branch,
      permissions: inst.permissions,
      token_expires_at: inst.expiresAt,
    });
  } catch (err) {
    if (err instanceof GithubError) {
      return c.json({ ok: false, step: err.step, status: err.status, error: err.message }, 502);
    }
    console.error("github status:", err);
    return c.json({ ok: false, step: "unknown", status: null, error: "internal_error" }, 500);
  }
});
