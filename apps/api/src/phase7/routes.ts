import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { GithubEnv } from "../phase5/github-app";
import { bootstrapProject } from "./bootstrap";
import { getProject, isUsable, listProjects } from "./projects";

export const projectRoutes = new Hono<AppEnv>();

// Daftar proyek target (tabel p7_projects).
projectRoutes.get("/", async (c) => c.json({ projects: await listProjects(c.env.DB) }));

const PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bootstrap CI proyek</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:16px;max-width:640px;margin:auto}
input{width:100%;box-sizing:border-box;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:16px;margin:8px 0}
button{font-size:16px;padding:12px 16px;border-radius:8px;border:0;background:#238636;color:#fff}
pre{white-space:pre-wrap;word-break:break-all;background:#161b22;padding:12px;border-radius:8px}</style></head>
<body><h2>Bootstrap CI proyek baru</h2>
<p>Agent membuka PR berisi ci.yml, package.json, wrangler.jsonc, scripts/site.mjs di repo proyek. Tidak merge.</p>
<input id="p" value="demo-landing" autocapitalize="none">
<button id="b">Buat PR template CI</button><pre id="o"></pre>
<script>
document.getElementById("b").onclick=async function(){
  var o=document.getElementById("o");o.textContent="Memproses...";
  var n=document.getElementById("p").value.trim();
  try{var r=await fetch("/api/projects/"+encodeURIComponent(n)+"/bootstrap",{method:"POST"});o.textContent=JSON.stringify(await r.json(),null,2);}
  catch(e){o.textContent="Gagal: "+e;}
};
</script></body></html>`;

projectRoutes.get("/bootstrap-page", (c) => c.html(PAGE));

// Fase 7c: PR template CI di proyek eksternal. Hasil: Pull Request (tidak pernah merge).
projectRoutes.post("/:name/bootstrap", async (c) => {
  const project = await getProject(c.env.DB, c.req.param("name"));
  if (!project || !isUsable(project)) {
    return c.json({ ok: false, step: "project", error: "proyek tidak dikenal atau diarsipkan" }, 400);
  }
  const res = await bootstrapProject(c.env as unknown as GithubEnv, project);
  if (res.ok) {
    await c.env.DB.prepare("UPDATE p7_projects SET status = 'ci_pr', updated_at = ? WHERE name = ? AND status = 'new'")
      .bind(Date.now(), project.name)
      .run();
  }
  const { status, ...body } = res;
  return c.json(body, res.ok ? 200 : ((status ?? 502) as 400 | 409 | 412 | 500 | 502));
});
