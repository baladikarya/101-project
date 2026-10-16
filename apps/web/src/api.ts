import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

export async function getJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status);
  return schema.parse(await res.json());
}

export async function postJson(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST", credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status);
}
