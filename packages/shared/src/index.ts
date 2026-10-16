import { z } from "zod";

export const AGENT_ROLES = [
  { id: "manager", name: "AI Manager", job: "Mengoordinasikan seluruh proyek" },
  { id: "analyst", name: "Business Analyst", job: "Menyusun kebutuhan dan spesifikasi" },
  { id: "architect", name: "Software Architect", job: "Merancang arsitektur" },
  { id: "designer", name: "UI/UX Designer", job: "Membuat rancangan antarmuka" },
  { id: "frontend", name: "Frontend Developer", job: "Mengembangkan UI" },
  { id: "backend", name: "Backend Developer", job: "Mengembangkan API dan database" },
  { id: "qa", name: "QA Engineer", job: "Review dan pengujian" },
  { id: "devops", name: "DevOps & Security", job: "Build, deployment, dan keamanan" },
] as const;

export type AgentId = (typeof AGENT_ROLES)[number]["id"];

export const HealthSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  time: z.number(),
});
export type Health = z.infer<typeof HealthSchema>;

export const MeSchema = z.object({
  id: z.number(),
  login: z.string(),
  avatarUrl: z.string().nullable(),
});
export type Me = z.infer<typeof MeSchema>;
