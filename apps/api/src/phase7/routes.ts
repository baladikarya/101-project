import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listProjects } from "./projects";

export const projectRoutes = new Hono<AppEnv>();

// Daftar proyek target (tabel p7_projects).
projectRoutes.get("/", async (c) => c.json({ projects: await listProjects(c.env.DB) }));
