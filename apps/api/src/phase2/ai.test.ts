import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, GroqProvider, createProvider } from "./ai";

const msgs = [{ role: "user" as const, content: "halo" }];

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("GroqProvider", () => {
  it("memakai angka token apa adanya dari respons", async () => {
    mockFetch(200, {
      model: "m-real",
      choices: [{ message: { content: "hai" } }],
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    });
    const r = await new GroqProvider("k", "m").complete(msgs);
    expect(r.text).toBe("hai");
    expect(r.model).toBe("m-real");
    expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
  });

  it("token null (bukan tebakan) bila penyedia tidak mengirim usage", async () => {
    mockFetch(200, { choices: [{ message: { content: "hai" } }] });
    const r = await new GroqProvider("k", "m").complete(msgs);
    expect(r.usage).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null });
  });

  it.each([
    [429, true],
    [500, true],
    [401, false],
    [400, false],
  ])("HTTP %i -> retryable=%s", async (status, retryable) => {
    mockFetch(status, "err");
    const err = await new GroqProvider("k", "m").complete(msgs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).retryable).toBe(retryable);
  });

  it("respons kosong dianggap error yang boleh dicoba ulang", async () => {
    mockFetch(200, { choices: [{ message: { content: "  " } }] });
    const err = await new GroqProvider("k", "m").complete(msgs).catch((e: unknown) => e);
    expect((err as AiError).retryable).toBe(true);
  });

  it("model default openai/gpt-oss-20b + reasoning_effort rendah + max_completion_tokens", async () => {
    mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    await createProvider({ GROQ_API_KEY: "k" }).complete(msgs);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBe(2048);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("GROQ_MODEL menimpa default; model non-penalar tidak dikirimi reasoning_effort", async () => {
    mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    await createProvider({ GROQ_API_KEY: "k", GROQ_MODEL: "qwen/qwen3.6-27b" }).complete(msgs);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen/qwen3.6-27b");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("404 model_not_found memberi petunjuk mengganti GROQ_MODEL dan tidak dicoba ulang", async () => {
    mockFetch(404, { error: { code: "model_not_found" } });
    const err = await new GroqProvider("k", "llama-x").complete(msgs).catch((e: unknown) => e);
    expect((err as AiError).retryable).toBe(false);
    expect((err as AiError).message).toMatch(/GROQ_MODEL/);
  });

  it("jawaban kosong karena finish_reason=length -> gagal permanen (bukan retry)", async () => {
    mockFetch(200, { choices: [{ message: { content: "" }, finish_reason: "length" }] });
    const err = await new GroqProvider("k", "m").complete(msgs).catch((e: unknown) => e);
    expect((err as AiError).retryable).toBe(false);
    expect((err as AiError).message).toMatch(/terpotong/);
  });

  it("createProvider menolak bila API key belum diset", () => {
    expect(() => createProvider({})).toThrow(AiError);
  });
});
