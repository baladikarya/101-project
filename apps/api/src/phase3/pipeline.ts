// Logika murni alur multi-agent (tanpa D1 / jaringan) supaya mudah dites.

import { PIPELINE_TEMPLATES, type PipelineStepDef, type PipelineTemplate } from "@avo/shared";

export function getTemplate(id: string): PipelineTemplate | undefined {
  return PIPELINE_TEMPLATES.find((t) => t.id === id);
}

/** Kembalikan daftar masalah ([] = valid). Dependensi hanya boleh menunjuk langkah sebelumnya. */
export function validateSteps(steps: readonly PipelineStepDef[]): string[] {
  const problems: string[] = [];
  if (steps.length === 0) problems.push("alur kosong");
  steps.forEach((s, i) => {
    const seen = new Set<number>();
    for (const d of s.dependsOn) {
      if (!Number.isInteger(d) || d < 0) problems.push(`langkah ${i}: dependensi ${d} tidak valid`);
      else if (d >= i) problems.push(`langkah ${i}: dependensi ${d} harus lebih kecil dari ${i}`);
      if (seen.has(d)) problems.push(`langkah ${i}: dependensi ${d} dobel`);
      seen.add(d);
    }
  });
  return problems;
}

// ---- Batas pemakaian ----

export interface UsageLimits {
  freeTierOnly: boolean;
  runsPerDay: number;
  callsPerDay: number;
  tokensPerDay: number;
}

function posInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Angka bawaan di bawah adalah batas konservatif milik aplikasi ini, BUKAN kuota resmi penyedia.
// Sesuaikan lewat variabel Cloudflare setelah mengecek halaman limit penyedia.
export function readLimits(env: {
  FREE_TIER_ONLY?: string;
  MAX_RUNS_PER_DAY?: string;
  MAX_AI_CALLS_PER_DAY?: string;
  MAX_TOKENS_PER_DAY?: string;
}): UsageLimits {
  return {
    freeTierOnly: env.FREE_TIER_ONLY?.trim().toLowerCase() !== "false",
    runsPerDay: posInt(env.MAX_RUNS_PER_DAY, 5),
    callsPerDay: posInt(env.MAX_AI_CALLS_PER_DAY, 80),
    tokensPerDay: posInt(env.MAX_TOKENS_PER_DAY, 200_000),
  };
}

/** Penyedia yang dianggap gratis. Penyedia berbayar harus ditambahkan sadar, bukan lewat default. */
export const FREE_PROVIDERS: readonly string[] = ["groq"];

export function isProviderAllowed(provider: string, freeTierOnly: boolean): boolean {
  return !freeTierOnly || FREE_PROVIDERS.includes(provider);
}

export interface DayUsage {
  runs: number;
  calls: number;
  tokens: number;
}

/** null = boleh lanjut; string = alasan ditolak. `needCalls` = jumlah panggilan AI yang akan dipakai. */
export function checkBudget(usage: DayUsage, limits: UsageLimits, needCalls: number, newRun: boolean): string | null {
  if (newRun && usage.runs >= limits.runsPerDay) {
    return `Batas ${limits.runsPerDay} alur/hari (UTC) tercapai.`;
  }
  if (usage.calls + needCalls > limits.callsPerDay) {
    return `Batas ${limits.callsPerDay} panggilan AI/hari (UTC) akan terlampaui (terpakai ${usage.calls}, butuh ${needCalls}).`;
  }
  if (usage.tokens >= limits.tokensPerDay) {
    return `Batas ${limits.tokensPerDay} token/hari (UTC) tercapai.`;
  }
  return null;
}

// ---- Prompt agent ----

const COMMON_RULES = `Aturan umum: balas dalam Bahasa Indonesia, ringkas, terstruktur. Kamu hanya menghasilkan teks. Jangan mengaku sudah menjalankan kode, menguji, mengubah file, atau deploy. Jangan mengarang data, angka, atau hasil uji; tulis asumsi sebagai asumsi. Pakai hasil agent sebelumnya sebagai dasar dan jangan menyalinnya ulang.`;

interface AgentSpec {
  name: string;
  system: string;
  maxTokens: number;
}

export const AGENT_SPECS: Record<string, AgentSpec> = {
  analyst: {
    name: "Business Analyst",
    maxTokens: 1500,
    system: `Kamu Business Analyst. Tugas: ubah tujuan proyek menjadi kebutuhan yang jelas.\nBagian: 1) Tujuan & pengguna, 2) Kebutuhan fungsional (daftar bernomor), 3) Kebutuhan non-fungsional, 4) Di luar cakupan, 5) Pertanyaan terbuka / asumsi.`,
  },
  architect: {
    name: "Software Architect",
    maxTokens: 1800,
    system: `Kamu Software Architect. Tugas: rancang arsitektur dari kebutuhan.\nBagian: 1) Ringkasan arsitektur, 2) Komponen & tanggung jawabnya, 3) Model data utama, 4) Endpoint/antarmuka utama, 5) Keputusan teknis + alasan singkat, 6) Risiko. Utamakan layanan gratis dan solusi sederhana.`,
  },
  designer: {
    name: "UI/UX Designer",
    maxTokens: 1500,
    system: `Kamu UI/UX Designer, mobile-first. Tugas: rancang antarmuka.\nBagian: 1) Alur pengguna, 2) Daftar layar + isi tiap layar, 3) Komponen & status (kosong, memuat, galat), 4) Catatan aksesibilitas.`,
  },
  frontend: {
    name: "Frontend Developer",
    maxTokens: 2500,
    system: `Kamu Frontend Developer (React + TypeScript + Tailwind). Tugas: tulis kode antarmuka sesuai rancangan.\nKeluaran: daftar file dengan path, lalu isi kode per file dalam blok kode. Singkat dan fokus; tandai bagian yang belum lengkap dengan TODO. Ingat: kode ini belum dijalankan siapa pun.`,
  },
  backend: {
    name: "Backend Developer",
    maxTokens: 2500,
    system: `Kamu Backend Developer (TypeScript, Cloudflare Workers + Hono + D1). Tugas: tulis kode API/database sesuai arsitektur.\nKeluaran: daftar file dengan path, lalu isi kode per file dalam blok kode, plus SQL bila perlu. Singkat dan fokus; tandai bagian yang belum lengkap dengan TODO. Ingat: kode ini belum dijalankan siapa pun.`,
  },
  qa: {
    name: "QA Engineer",
    maxTokens: 1800,
    system: `Kamu QA Engineer. Tugas: tinjau seluruh hasil sebelumnya (kebutuhan, rancangan, kode) sebagai REVIEW TEKS. Kamu tidak menjalankan tes.\nBagian: 1) Kesesuaian dengan kebutuhan (tabel singkat: kebutuhan → terpenuhi/sebagian/tidak), 2) Bug atau celah yang terlihat dari kode, 3) Kasus uji yang disarankan, 4) Keputusan: LAYAK / PERLU PERBAIKAN + alasan.`,
  },
  devops: {
    name: "DevOps & Security Engineer",
    maxTokens: 1800,
    system: `Kamu DevOps & Security Engineer. Tugas: tinjau hasil sebelumnya dari sisi build, deploy, dan keamanan (Cloudflare + GitHub Actions, free tier).\nBagian: 1) Langkah build & deploy yang disarankan, 2) Rahasia/variabel yang dibutuhkan, 3) Risiko keamanan (autentikasi, input, rahasia, CORS/CSRF), 4) Batas free tier yang perlu diwaspadai.`,
  },
};

export function agentName(agent: string): string {
  return AGENT_SPECS[agent]?.name ?? agent;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[…dipotong, ${text.length - max} karakter lagi]`;
}

export const DEP_CHAR_LIMIT = 6000;
export const PREV_CHAR_LIMIT = 3000;

export interface DepOutput {
  agent: string;
  title: string;
  output: string;
}

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

export function buildMessages(opts: {
  agent: string;
  title: string;
  goal: string;
  deps: readonly DepOutput[];
  previousOutput?: string | null;
  note?: string | null;
}): { messages: PromptMessage[]; maxTokens: number } {
  const spec = AGENT_SPECS[opts.agent];
  if (!spec) throw new Error(`Agent tidak dikenal: ${opts.agent}`);

  const parts: string[] = [`TUJUAN PROYEK:\n${opts.goal}`];
  for (const d of opts.deps) {
    parts.push(`HASIL ${agentName(d.agent).toUpperCase()} (${d.title}):\n${truncate(d.output, DEP_CHAR_LIMIT)}`);
  }
  if (opts.note && opts.previousOutput) {
    parts.push(
      `HASILMU SEBELUMNYA (ditolak pemilik):\n${truncate(opts.previousOutput, PREV_CHAR_LIMIT)}\n\nCATATAN PEMILIK:\n${opts.note}\nPerbaiki sesuai catatan.`,
    );
  }
  parts.push(`TUGASMU SEKARANG: ${opts.title}.`);

  return {
    messages: [
      { role: "system", content: `${spec.system}\n${COMMON_RULES}` },
      { role: "user", content: parts.join("\n\n") },
    ],
    maxTokens: spec.maxTokens,
  };
}
