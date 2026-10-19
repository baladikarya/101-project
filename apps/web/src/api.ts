import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail?: string,
  ) {
    super(detail ?? `HTTP ${status}`);
  }
}

// Ambil pesan {error} dari server (mis. batas harian tercapai) bila ada.
async function failure(res: Response): Promise<ApiError> {
  let detail: string | undefined;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      detail = body.error;
    }
  } catch {
    // body bukan JSON
  }
  return new ApiError(res.status, detail);
}

export async function getJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!res.ok) throw await failure(res);
  return schema.parse(await res.json());
}

export async function postJson(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await failure(res);
}
