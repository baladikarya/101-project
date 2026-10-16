import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { auth, requireUser } from "./auth";
import type { AppEnv } from "./env";
import { isSameOrigin } from "./util";

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

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
