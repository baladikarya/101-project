// Fase 5: autentikasi GitHub App (JWT RS256 -> installation token).
// Hanya memakai Web Crypto + fetch (tanpa dependensi tambahan).

export interface GithubEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_INSTALLATION_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

// Repo tes untuk tombol PR tes. Target tugas coding datang dari tabel p7_projects, bukan dari konstanta ini.
export const GITHUB_REPO = "baladikarya/101-project";
const GITHUB_API = "https://api.github.com";

export class GithubError extends Error {
  readonly step: string;
  readonly status: number | null;
  constructor(step: string, message: string, status: number | null = null) {
    super(message);
    this.step = step;
    this.status = status;
  }
}

export function assertSafeRepo(repo: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo.includes("..")) {
    throw new GithubError("validate", `nama repo tidak valid: ${repo}`);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  let v = n;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return [0x80 | out.length, ...out];
}

// GitHub menerbitkan kunci PKCS#1 ("BEGIN RSA PRIVATE KEY"); Web Crypto butuh PKCS#8.
export function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octetHead = [0x04, ...derLength(pkcs1.length)];
  const bodyLen = version.length + algId.length + octetHead.length + pkcs1.length;
  const head = [0x30, ...derLength(bodyLen)];
  const out = new Uint8Array(head.length + bodyLen);
  let p = 0;
  for (const part of [head, version, algId, octetHead]) {
    out.set(part, p);
    p += part.length;
  }
  out.set(pkcs1, p);
  return out;
}

export function pemToPkcs8(pem: string): Uint8Array {
  const text = pem.replace(/\\n/g, "\n");
  const isPkcs1 = text.includes("BEGIN RSA PRIVATE KEY");
  const b64 = text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return isPkcs1 ? wrapPkcs1AsPkcs8(raw) : raw;
}

export async function createAppJwt(env: GithubEnv, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new GithubError("config", "secret GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY belum diisi");
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      toArrayBuffer(pemToPkcs8(env.GITHUB_APP_PRIVATE_KEY)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new GithubError("private_key", "private key tidak valid (salin ulang isi .pem lengkap)");
  }
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(
    enc.encode(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: env.GITHUB_APP_ID })),
  );
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, toArrayBuffer(enc.encode(data)));
  return `${data}.${base64url(new Uint8Array(sig))}`;
}

function ghHeaders(bearer: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearer}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "101-project-agent",
  };
}

async function failFrom(res: Response, step: string): Promise<GithubError> {
  let msg = `GitHub membalas ${res.status}`;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string") msg = body.message;
  } catch {
    // abaikan body non-JSON
  }
  return new GithubError(step, msg, res.status);
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
}

export async function getInstallationToken(env: GithubEnv): Promise<InstallationToken> {
  if (!env.GITHUB_APP_INSTALLATION_ID) {
    throw new GithubError("config", "secret GITHUB_APP_INSTALLATION_ID belum diisi");
  }
  const jwt = await createAppJwt(env);
  const res = await fetch(
    `${GITHUB_API}/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID)}/access_tokens`,
    { method: "POST", headers: ghHeaders(jwt) },
  );
  if (!res.ok) throw await failFrom(res, "installation_token");
  const body = (await res.json()) as {
    token: string;
    expires_at: string;
    permissions?: Record<string, string>;
  };
  return { token: body.token, expiresAt: body.expires_at, permissions: body.permissions ?? {} };
}

export async function githubRequest<T>(
  token: string,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  step: string,
  body?: unknown,
): Promise<T> {
  const headers = ghHeaders(token);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${GITHUB_API}${path}`, init);
  if (!res.ok) throw await failFrom(res, step);
  return (await res.json()) as T;
}

export function githubGet<T>(token: string, path: string, step: string): Promise<T> {
  return githubRequest<T>(token, "GET", path, step);
}
