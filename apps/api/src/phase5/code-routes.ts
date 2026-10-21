import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getProject, isUsable, scopeOf } from "../phase7/projects";
import { AgentOutputError, assertAgentPath } from "./code-parse";
import { MAX_INSTRUCTION_CHARS, dailyLimit, overDailyLimit, runCodeTask, validateInput, type CodeEnv } from "./code-task";

export const codeRoutes = new Hono<AppEnv>();

interface TaskRow {
  id: string;
  project: string | null;
  instruction: string;
  status: string;
  title: string | null;
  pr_number: number | null;
  pr_url: string | null;
  error: string | null;
  total_tokens: number | null;
  created_at: number;
}

// Riwayat 20 tugas terakhir.
codeRoutes.get("/", async (c) => {
  const env = c.env as unknown as CodeEnv;
  const { results } = await env.DB.prepare(
    "SELECT id, project, instruction, status, title, pr_number, pr_url, error, total_tokens, created_at FROM p5_code_tasks ORDER BY created_at DESC LIMIT 20",
  ).all<TaskRow>();
  return c.json({ tasks: results, daily_limit: dailyLimit(env) });
});

// Kirim tugas coding. Hasil: Pull Request (tidak pernah merge).
codeRoutes.post("/", async (c) => {
  const env = c.env as unknown as CodeEnv;
  let input;
  try {
    input = validateInput(await c.req.json().catch(() => null));
  } catch (err) {
    const msg = err instanceof AgentOutputError ? err.message : "input tidak valid";
    return c.json({ ok: false, step: "validate", error: msg }, 400);
  }
  const project = await getProject(env.DB, input.project);
  if (!project || !isUsable(project)) {
    return c.json({ ok: false, step: "project", error: `proyek tidak dikenal atau diarsipkan: ${input.project}` }, 400);
  }
  try {
    for (const p of input.paths) assertAgentPath(p, scopeOf(project));
  } catch (err) {
    const msg = err instanceof AgentOutputError ? err.message : "path tidak valid";
    return c.json({ ok: false, step: "validate", error: msg }, 400);
  }
  if (await overDailyLimit(env)) {
    return c.json({ ok: false, step: "limit", error: `batas harian ${dailyLimit(env)} tugas coding tercapai` }, 429);
  }
  const job = runCodeTask(env, input, project);
  try {
    c.executionCtx.waitUntil(job.then(() => undefined, () => undefined));
  } catch {
    // di luar runtime Workers: tidak ada executionCtx
  }
  const result = await job;
  return c.json(result, result.ok ? 200 : 502);
});

const PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tugas coding agent</title>
<style>
body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:16px;max-width:640px;margin:auto}
textarea{width:100%;box-sizing:border-box;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:16px}
button{font-size:16px;padding:12px 16px;border-radius:8px;border:0;background:#238636;color:#fff;margin-top:8px}
button:disabled{opacity:.5}
pre{white-space:pre-wrap;word-break:break-word;background:#161b22;padding:12px;border-radius:8px}
a{color:#58a6ff}.t{border-top:1px solid #30363d;padding:8px 0;font-size:14px}.m{color:#8b949e}
</style></head><body>
<h2>Tugas coding agent</h2>
<p class="m">AI menulis kode, bot membuat branch <code>agent/...</code> dan Pull Request. Tidak merge. Kamu yang menyetujui.</p>
<label>Proyek target</label>
<select id="j"></select>
<label>Instruksi (maks ${MAX_INSTRUCTION_CHARS} karakter)</label>
<textarea id="i" rows="6"></textarea>
<label>File konteks (opsional, satu path per baris, maks 3)</label>
<textarea id="p" rows="3" placeholder="docs/README.md"></textarea>
<button id="b">Kirim ke agent</button>
<pre id="o"></pre>
<h3>Riwayat</h3><div id="h"></div>
<script>
function row(t){
  var d=document.createElement("div");d.className="t";
  var s=document.createElement("div");
  s.textContent=(t.status==="pr_open"?"PR dibuka":t.status==="failed"?"Gagal":"Berjalan")+" - "+new Date(t.created_at).toLocaleString();
  d.appendChild(s);
  var n=document.createElement("div");n.textContent=(t.project?"["+t.project+"] ":"")+(t.title||t.instruction.slice(0,120));d.appendChild(n);
  if(t.pr_url){var a=document.createElement("a");a.href=t.pr_url;a.textContent="PR #"+t.pr_number;a.target="_blank";d.appendChild(a);}
  if(t.error){var e=document.createElement("div");e.className="m";e.textContent=t.error;d.appendChild(e);}
  if(t.total_tokens!=null){var k=document.createElement("div");k.className="m";k.textContent=t.total_tokens+" token";d.appendChild(k);}
  return d;
}
async function load(){
  var h=document.getElementById("h");
  try{var r=await fetch("/api/code-tasks");var j=await r.json();h.textContent="";
    j.tasks.forEach(function(t){h.appendChild(row(t));});}
  catch(e){h.textContent="Gagal memuat riwayat";}
}
async function loadProjects(){
  var s=document.getElementById("j");
  try{var r=await fetch("/api/projects");var q=await r.json();
    q.projects.filter(function(x){return x.status!=="archived";}).forEach(function(x){
      var o=document.createElement("option");o.value=x.name;o.textContent=x.name+" ("+x.repo+")";s.appendChild(o);});}
  catch(e){s.appendChild(new Option("gagal memuat proyek",""));}
}
document.getElementById("b").onclick=async function(){
  var b=this,o=document.getElementById("o");
  var paths=document.getElementById("p").value.split("\\n").map(function(s){return s.trim();}).filter(Boolean);
  b.disabled=true;o.textContent="Agent bekerja... (bisa 10-40 detik)";
  try{
    var r=await fetch("/api/code-tasks",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({project:document.getElementById("j").value,instruction:document.getElementById("i").value,paths:paths})});
    o.textContent=JSON.stringify(await r.json(),null,2);
  }catch(e){o.textContent="Gagal: "+e;}
  b.disabled=false;load();
};
loadProjects();load();
</script></body></html>`;

codeRoutes.get("/page", (c) => c.html(PAGE));
