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

// ---- Fase 2: tugas AI Manager ----
export const TASK_STATUSES = ["queued", "running", "pausing", "paused", "completed", "failed"] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  attempts: z.number(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  total_tokens: z.number().nullable(),
});
export type TaskItem = z.infer<typeof TaskItemSchema>;

export const TaskListSchema = z.object({
  tasks: z.array(TaskItemSchema),
  today: z.object({ tasks: z.number(), tokens: z.number().nullable(), limit: z.number() }),
});
export type TaskList = z.infer<typeof TaskListSchema>;

export const TaskDetailSchema = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    prompt: z.string(),
    status: TaskStatusSchema,
    attempts: z.number(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    result: z.string().nullable(),
    error: z.string().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
  }),
  events: z.array(z.object({ id: z.string(), type: z.string(), message: z.string(), created_at: z.number() })),
  usage: z.array(
    z.object({
      attempt: z.number(),
      provider: z.string(),
      model: z.string(),
      prompt_tokens: z.number().nullable(),
      completion_tokens: z.number().nullable(),
      total_tokens: z.number().nullable(),
      latency_ms: z.number().nullable(),
      created_at: z.number(),
    }),
  ),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;
