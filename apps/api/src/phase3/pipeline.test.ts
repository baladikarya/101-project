import { PIPELINE_TEMPLATES } from "@avo/shared";
import { describe, expect, it } from "vitest";
import {
  AGENT_SPECS,
  DEP_CHAR_LIMIT,
  buildMessages,
  checkBudget,
  getTemplate,
  isProviderAllowed,
  readLimits,
  truncate,
  validateSteps,
} from "./pipeline";

describe("template alur", () => {
  it.each(PIPELINE_TEMPLATES.map((t) => [t.id, t] as const))("%s valid & semua agent punya prompt", (_id, t) => {
    expect(validateSteps(t.steps)).toEqual([]);
    for (const s of t.steps) expect(AGENT_SPECS[s.agent]).toBeDefined();
  });

  it("alur standar: Analyst → Architect → Backend → QA", () => {
    expect(getTemplate("standard")?.steps.map((s) => s.agent)).toEqual(["analyst", "architect", "backend", "qa"]);
  });

  it("alur lengkap memakai ketujuh agent non-manager", () => {
    const agents = new Set(getTemplate("full")?.steps.map((s) => s.agent));
    expect([...agents].sort()).toEqual(["analyst", "architect", "backend", "designer", "devops", "frontend", "qa"]);
  });

  it("template tak dikenal -> undefined", () => {
    expect(getTemplate("nope")).toBeUndefined();
  });

  it("validateSteps menolak dependensi ke depan, diri sendiri, dobel, dan alur kosong", () => {
    const s = (dependsOn: number[]) => ({ agent: "qa" as const, title: "x", dependsOn, needsApproval: false });
    expect(validateSteps([])).not.toEqual([]);
    expect(validateSteps([s([0])])).not.toEqual([]);
    expect(validateSteps([s([]), s([2])])).not.toEqual([]);
    expect(validateSteps([s([]), s([0, 0])])).not.toEqual([]);
    expect(validateSteps([s([]), s([-1])])).not.toEqual([]);
    expect(validateSteps([s([]), s([0])])).toEqual([]);
  });
});

describe("batas pemakaian", () => {
  it("Free Tier Only aktif secara bawaan; hanya 'false' yang mematikan", () => {
    expect(readLimits({}).freeTierOnly).toBe(true);
    expect(readLimits({ FREE_TIER_ONLY: "" }).freeTierOnly).toBe(true);
    expect(readLimits({ FREE_TIER_ONLY: "true" }).freeTierOnly).toBe(true);
    expect(readLimits({ FREE_TIER_ONLY: "False " }).freeTierOnly).toBe(false);
  });

  it("angka batas dari variabel; nilai ngawur jatuh ke bawaan", () => {
    expect(readLimits({ MAX_RUNS_PER_DAY: "2", MAX_AI_CALLS_PER_DAY: "9", MAX_TOKENS_PER_DAY: "1000" })).toMatchObject({
      runsPerDay: 2,
      callsPerDay: 9,
      tokensPerDay: 1000,
    });
    expect(readLimits({ MAX_RUNS_PER_DAY: "abc", MAX_AI_CALLS_PER_DAY: "-3" })).toMatchObject({
      runsPerDay: 5,
      callsPerDay: 80,
    });
  });

  it("penyedia berbayar ditolak saat Free Tier Only, boleh saat dimatikan", () => {
    expect(isProviderAllowed("groq", true)).toBe(true);
    expect(isProviderAllowed("anthropic", true)).toBe(false);
    expect(isProviderAllowed("anthropic", false)).toBe(true);
  });

  const lim = { freeTierOnly: true, runsPerDay: 3, callsPerDay: 10, tokensPerDay: 500 };
  it("checkBudget: lolos, alur penuh, panggilan terlampaui, token habis", () => {
    expect(checkBudget({ runs: 0, calls: 0, tokens: 0 }, lim, 4, true)).toBeNull();
    expect(checkBudget({ runs: 3, calls: 0, tokens: 0 }, lim, 4, true)).toMatch(/alur\/hari/);
    expect(checkBudget({ runs: 3, calls: 0, tokens: 0 }, lim, 1, false)).toBeNull();
    expect(checkBudget({ runs: 0, calls: 7, tokens: 0 }, lim, 4, true)).toMatch(/panggilan AI/);
    expect(checkBudget({ runs: 0, calls: 10, tokens: 0 }, lim, 1, false)).toMatch(/panggilan AI/);
    expect(checkBudget({ runs: 0, calls: 0, tokens: 500 }, lim, 1, false)).toMatch(/token/);
  });
});

describe("buildMessages", () => {
  it("memuat tujuan, hasil dependensi, dan tugas; system berisi aturan jujur", () => {
    const { messages, maxTokens } = buildMessages({
      agent: "architect",
      title: "Rancang arsitektur",
      goal: "Aplikasi catatan",
      deps: [{ agent: "analyst", title: "Analisis kebutuhan", output: "KEBUTUHAN-1" }],
    });
    expect(maxTokens).toBe(AGENT_SPECS.architect?.maxTokens);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toMatch(/Jangan mengaku sudah menjalankan/);
    const user = messages[1]?.content ?? "";
    expect(user).toContain("Aplikasi catatan");
    expect(user).toContain("HASIL BUSINESS ANALYST");
    expect(user).toContain("KEBUTUHAN-1");
    expect(user).toContain("TUGASMU SEKARANG: Rancang arsitektur.");
    expect(user).not.toContain("DITOLAK");
  });

  it("output dependensi panjang dipotong", () => {
    const { messages } = buildMessages({
      agent: "qa",
      title: "t",
      goal: "g",
      deps: [{ agent: "backend", title: "k", output: "x".repeat(DEP_CHAR_LIMIT + 500) }],
    });
    expect(messages[1]?.content).toContain("dipotong, 500 karakter lagi");
  });

  it("hasil yang ditolak + catatan masuk prompt hanya bila keduanya ada", () => {
    const base = { agent: "architect", title: "t", goal: "g", deps: [] };
    const withNote = buildMessages({ ...base, previousOutput: "LAMA", note: "pakai D1 saja" }).messages[1]?.content;
    expect(withNote).toContain("LAMA");
    expect(withNote).toContain("pakai D1 saja");
    expect(buildMessages({ ...base, note: "orphan" }).messages[1]?.content).not.toContain("orphan");
  });

  it("agent tak dikenal -> error", () => {
    expect(() => buildMessages({ agent: "manager", title: "t", goal: "g", deps: [] })).toThrow();
  });

  it("truncate tidak mengubah teks pendek", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });
});
