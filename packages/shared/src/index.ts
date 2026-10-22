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

// ---- Fase 3: tim multi-agent ----
export const RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "pausing",
  "paused",
  "completed",
  "failed",
  "rejected",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const STEP_STATUSES = ["pending", "running", "awaiting_approval", "completed", "failed", "rejected"] as const;
export const StepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatusSchema>;

/** ai = panggilan AI teks. pr = AI menulis kode lalu bot membuka Pull Request. ci = cek hasil CI Pull Request (tanpa AI). */
export const STEP_KINDS = ["ai", "pr", "ci"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface PipelineStepDef {
  agent: AgentId;
  title: string;
  /** Indeks langkah yang hasilnya dibutuhkan. Hanya boleh menunjuk langkah sebelumnya. */
  dependsOn: number[];
  needsApproval: boolean;
  /** Bawaan: "ai". */
  kind?: StepKind;
}

export interface PipelineTemplate {
  id: string;
  label: string;
  /** true = alur ini menghasilkan Pull Request, jadi wajib memilih proyek target (repo terpisah). */
  needsProject?: boolean;
  steps: PipelineStepDef[];
}

const step = (
  agent: AgentId,
  title: string,
  dependsOn: number[],
  needsApproval = false,
  kind: StepKind = "ai",
): PipelineStepDef => ({
  agent,
  title,
  dependsOn,
  needsApproval,
  kind,
});

export const stepKindOf = (s: { kind?: StepKind | undefined }): StepKind => s.kind ?? "ai";

export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    id: "standard",
    label: "Standar: Analyst → Architect → Backend → QA",
    steps: [
      step("analyst", "Analisis kebutuhan", []),
      step("architect", "Rancang arsitektur", [0], true),
      step("backend", "Tulis kode API dan database", [0, 1]),
      step("qa", "Review hasil dan usulan pengujian", [2], true),
    ],
  },
  {
    id: "ui",
    label: "Antarmuka: Analyst → Designer → Frontend → QA",
    steps: [
      step("analyst", "Analisis kebutuhan", []),
      step("designer", "Rancang antarmuka", [0], true),
      step("frontend", "Tulis kode antarmuka", [0, 1]),
      step("qa", "Review hasil dan usulan pengujian", [2], true),
    ],
  },
  {
    id: "full",
    label: "Lengkap: tujuh agent",
    steps: [
      step("analyst", "Analisis kebutuhan", []),
      step("architect", "Rancang arsitektur", [0], true),
      step("designer", "Rancang antarmuka", [0]),
      step("backend", "Tulis kode API dan database", [1]),
      step("frontend", "Tulis kode antarmuka", [1, 2]),
      step("qa", "Review hasil dan usulan pengujian", [3, 4], true),
      step("devops", "Tinjau build, deploy, dan keamanan", [3, 5]),
    ],
  },
  {
    id: "build",
    label: "Bangun → PR: Analyst → Architect → Developer (PR) → QA (cek CI)",
    needsProject: true,
    steps: [
      step("analyst", "Analisis kebutuhan", []),
      step("architect", "Rancang arsitektur", [0], true),
      step("backend", "Tulis kode dan buka Pull Request", [0, 1], false, "pr"),
      step("qa", "Cek hasil CI Pull Request", [2], false, "ci"),
    ],
  },
];

const nullNum = z.number().nullable();

export const RunListSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      template: z.string(),
      status: RunStatusSchema,
      attempts: z.number(),
      current_step: nullNum,
      error: z.string().nullable(),
      created_at: z.number(),
      updated_at: z.number(),
      project: z.string().nullish(),
      pr_number: z.number().nullish(),
      pr_url: z.string().nullish(),
      steps_total: z.number(),
      steps_done: z.number(),
      total_tokens: nullNum,
    }),
  ),
  limits: z.object({
    free_tier_only: z.boolean(),
    runs: z.object({ used: z.number(), limit: z.number() }),
    calls: z.object({ used: z.number(), limit: z.number() }),
    tokens: z.object({ used: z.number(), limit: z.number() }),
  }),
  templates: z.array(z.object({ id: z.string(), label: z.string(), needs_project: z.boolean().optional() })),
});
export type RunList = z.infer<typeof RunListSchema>;

export const RunDetailSchema = z.object({
  run: z.object({
    id: z.string(),
    title: z.string(),
    goal: z.string(),
    template: z.string(),
    status: RunStatusSchema,
    attempts: z.number(),
    current_step: nullNum,
    error: z.string().nullable(),
    created_at: z.number(),
    updated_at: z.number(),
    project: z.string().nullish(),
    branch: z.string().nullish(),
    pr_number: z.number().nullish(),
    pr_url: z.string().nullish(),
  }),
  steps: z.array(
    z.object({
      idx: z.number(),
      kind: z.enum(STEP_KINDS).optional(),
      agent: z.string(),
      title: z.string(),
      depends_on: z.array(z.number()),
      needs_approval: z.boolean(),
      status: StepStatusSchema,
      output: z.string().nullable(),
      approval_note: z.string().nullable(),
      provider: z.string().nullable(),
      model: z.string().nullable(),
      prompt_tokens: nullNum,
      completion_tokens: nullNum,
      total_tokens: nullNum,
      latency_ms: nullNum,
      error: z.string().nullable(),
    }),
  ),
  events: z.array(z.object({ id: z.string(), type: z.string(), message: z.string(), created_at: z.number() })),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

// ---- Fase 4: kantor (status agent nyata dari database) ----
export const AGENT_STATES = ["idle", "working", "waiting", "paused", "error"] as const;
export const AgentStateSchema = z.enum(AGENT_STATES);
export type AgentState = z.infer<typeof AgentStateSchema>;

export const OfficeSchema = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      state: AgentStateSchema,
      /** Judul langkah/tugas yang sedang dikerjakan (null bila idle). */
      activity: z.string().nullable(),
      /** Judul alur/tugas induknya. */
      context: z.string().nullable(),
      error: z.string().nullable(),
      last_active: nullNum,
      steps_done: z.number(),
      total_tokens: z.number(),
    }),
  ),
  generated_at: z.number(),
});
export type Office = z.infer<typeof OfficeSchema>;
export type OfficeAgent = Office["agents"][number];

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  idle: "Santai",
  working: "Bekerja",
  waiting: "Menunggu persetujuan",
  paused: "Dijeda",
  error: "Bermasalah",
};

// ---- Fase 7: proyek target ----
export const ProjectListSchema = z.object({
  projects: z.array(z.object({ name: z.string(), repo: z.string(), status: z.string(), kind: z.string() })),
});
export type ProjectList = z.infer<typeof ProjectListSchema>;
