// Adapter penyedia AI. Fase 2: Groq. Gemini / OpenRouter nanti tinggal tambah class baru.
// Angka token = apa adanya dari respons penyedia. Kalau tidak ada -> null (tidak ditebak).

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AiResult {
  text: string;
  usage: AiUsage;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface AiOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface AiProvider {
  readonly name: string;
  complete(messages: ChatMessage[], opts?: AiOptions): Promise<AiResult>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiError";
  }
}

interface GroqResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Daftar model Groq berubah-ubah (llama-3.x kini hanya Enterprise). Ganti lewat variabel GROQ_MODEL
// tanpa mengubah kode. Daftar resmi: console.groq.com/docs/models
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-20b";

export class GroqProvider implements AiProvider {
  readonly name = "groq";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = GROQ_DEFAULT_MODEL,
  ) {}

  async complete(
    messages: ChatMessage[],
    opts: AiOptions = {},
  ): Promise<AiResult> {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_completion_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.4,
          // Model penalar (gpt-oss) memakai sebagian token untuk "berpikir"; tekan agar jawaban tidak terpotong.
          ...(this.model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low" } : {}),
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      throw new AiError(
        `Groq tidak terjangkau: ${e instanceof Error ? e.message : String(e)}`,
        null,
        true,
      );
    }

    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      // 429 (rate limit) & 5xx layak dicoba ulang; 400/401/403/404 tidak.
      const retryable = res.status === 429 || res.status >= 500;
      const hint =
        res.status === 404 || body.includes("model_not_found")
          ? ` — model "${this.model}" tidak tersedia untuk kunci ini. Ganti variabel GROQ_MODEL (daftar: console.groq.com/docs/models).`
          : "";
      throw new AiError(`Groq ${res.status}: ${body}${hint}`, res.status, retryable);
    }

    const data = (await res.json()) as GroqResponse;
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text.trim()) {
      // Terpotong di batas token (mis. model penalar kehabisan token): mengulang tidak membantu.
      if (choice?.finish_reason === "length") {
        throw new AiError("Groq: jawaban terpotong di batas token sebelum selesai.", null, false);
      }
      throw new AiError("Groq: respons kosong", null, true);
    }

    return {
      text,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? null,
        completionTokens: data.usage?.completion_tokens ?? null,
        totalTokens: data.usage?.total_tokens ?? null,
      },
      provider: this.name,
      model: data.model ?? this.model,
      latencyMs: Date.now() - started,
    };
  }
}

export function createProvider(env: {
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
}): AiProvider {
  if (!env.GROQ_API_KEY) {
    throw new AiError("GROQ_API_KEY belum diset di Cloudflare.", null, false);
  }
  return new GroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL || GROQ_DEFAULT_MODEL);
}
