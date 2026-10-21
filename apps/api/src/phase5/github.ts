import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listProjects, isUsable } from "../phase7/projects";
import { GITHUB_REPO, GithubError, assertSafeRepo, getInstallationToken, githubGet, type GithubEnv } from "./github-app";
import { openPullRequest } from "./pr";

interface RepoInfo {
  full_name: string;
  private: boolean;
  default_branch: string;
}

export const githubRoutes = new Hono<AppEnv>();

// Tes koneksi GitHub App ke setiap repo di p7_projects. Tidak pernah mengembalikan token.
githubRoutes.get("/status", async (c) => {
  const env = c.env as unknown as GithubEnv;
  try {
    const inst = await getInstallationToken(env);
    const projects = (await listProjects(c.env.DB)).filter(isUsable);
    const repos = await Promise.all(
      projects.map(async (p) => {
        const base = { project: p.name, worker: p.worker, project_status: p.status };
        try {
          assertSafeRepo(p.repo);
          const r = await githubGet<RepoInfo>(inst.token, `/repos/${p.repo}`, "repo");
          return { ...base, ok: true, repo: r.full_name, private: r.private, default_branch: r.default_branch };
        } catch (err) {
          const notFound = err instanceof GithubError && err.status === 404;
          const msg = err instanceof GithubError ? err.message : "internal_error";
          return {
            ...base,
            ok: false,
            repo: p.repo,
            error: notFound ? "repo tidak ada, atau GitHub App belum di-install di repo ini" : msg,
          };
        }
      }),
    );
    return c.json({
      ok: repos.length > 0 && repos.every((r) => r.ok),
      count: repos.length,
      repos,
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

const TEST_PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tes PR agent</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:16px}
button{font-size:16px;padding:12px 16px;border-radius:8px;border:0;background:#238636;color:#fff}
pre{white-space:pre-wrap;word-break:break-all;background:#161b22;padding:12px;border-radius:8px}</style></head>
<body><h2>Tes Pull Request agent</h2>
<p>Membuat branch <code>agent/test-...</code> + 1 file tes + PR ke main. Tidak merge.</p>
<button id="b">Buat PR tes</button><pre id="o"></pre>
<script>
document.getElementById("b").onclick=async function(){
  var o=document.getElementById("o");o.textContent="Memproses...";
  try{var r=await fetch("/api/github/pr-test",{method:"POST"});o.textContent=JSON.stringify(await r.json(),null,2);}
  catch(e){o.textContent="Gagal: "+e;}
};
</script></body></html>`;

githubRoutes.get("/pr-test-page", (c) => c.html(TEST_PAGE));

// Membuat PR tes sungguhan: branch terpisah, commit 1 file, buka Pull Request.
githubRoutes.post("/pr-test", async (c) => {
  const env = c.env as unknown as GithubEnv;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "z").toLowerCase();
  try {
    const pr = await openPullRequest(env, {
      repo: GITHUB_REPO,
      title: `Tes PR agent ${stamp}`,
      body: "PR tes otomatis dari agent (Fase 5). Aman ditutup atau di-merge oleh pemilik.",
      branch: `agent/test-${stamp}`,
      files: [
        {
          path: `docs/agent-tests/${stamp}.md`,
          content: `# Tes PR agent\n\nDibuat otomatis oleh GitHub App 101-project-agent pada ${stamp}.\n`,
        },
      ],
    });
    return c.json({ ok: true, pr_number: pr.number, pr_url: pr.url, branch: pr.branch });
  } catch (err) {
    if (err instanceof GithubError) {
      return c.json({ ok: false, step: err.step, status: err.status, error: err.message }, 502);
    }
    console.error("github pr-test:", err);
    return c.json({ ok: false, step: "unknown", status: null, error: "internal_error" }, 500);
  }
});
