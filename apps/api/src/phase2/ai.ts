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
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";

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
          max_tokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.4,
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
      throw new AiError(`Groq ${res.status}: ${body}`, res.status, retryable);
    }

    const data = (await res.json()) as GroqResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new AiError("Groq: respons kosong", null, true);

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
