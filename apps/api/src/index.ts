import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { auth, requireUser } from "./auth";
import type { AppEnv } from "./env";
import { taskRoutes } from "./phase2/routes";
import { runRoutes } from "./phase3/routes";
import { officeRoutes } from "./phase4/office";
import { githubRoutes } from "./phase5/github";
import { isSameOrigin } from "./util";

// Cloudflare Workflows: class harus diekspor dari entry Worker.
export { ManagerTaskWorkflow } from "./phase2/workflow";
export { PipelineRunWorkflow } from "./phase3/workflow";

const app = new Hono<AppEnv>();

app.use("/api/*", secureHeaders());

// CSRF: request yang mengubah data wajib berasal dari origin yang sama.
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const ok = isSameOrigin({
      origin: c.req.header("Origin") ?? null,
      secFetchSite: c.req.header("Sec-Fetch-Site") ?? null,
      requestUrl: c.req.url,
    });
    if (!ok) return c.json({ error: "forbidden_origin" }, 403);
  }
  await next();
});

app.get("/api/health", async (c) => {
  let db = false;
  try {
    await c.env.DB.prepare("SELECT 1").first();
    db = true;
  } catch (err) {
    console.error("health: db error", err);
  }
  return c.json({ ok: db, db, time: Date.now() }, db ? 200 : 503);
});

app.route("/api/auth", auth);

app.get("/api/me", requireUser, (c) => c.json(c.get("user")));

// Fase 2: tugas AI Manager (khusus pemilik yang sudah login).
app.use("/api/tasks", requireUser);
app.use("/api/tasks/*", requireUser);
app.route("/api/tasks", taskRoutes);

// Fase 3: alur tim multi-agent (khusus pemilik).
app.use("/api/runs", requireUser);
app.use("/api/runs/*", requireUser);
app.route("/api/runs", runRoutes);

// Fase 4: status agent untuk kantor (khusus pemilik).
app.use("/api/office", requireUser);
app.use("/api/office/*", requireUser);
app.route("/api/office", officeRoutes);

// Fase 5: koneksi GitHub App (khusus pemilik).
app.use("/api/github", requireUser);
app.use("/api/github/*", requireUser);
app.route("/api/github", githubRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
