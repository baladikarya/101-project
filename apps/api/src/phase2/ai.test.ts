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

  it("createProvider menolak bila API key belum diset", () => {
    expect(() => createProvider({})).toThrow(AiError);
  });
});
