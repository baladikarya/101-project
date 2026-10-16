export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Perbandingan string dengan waktu tetap (untuk nilai state OAuth). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Perlindungan CSRF untuk request yang mengubah data: harus berasal dari origin yang sama. */
export function isSameOrigin(opts: {
  origin: string | null;
  secFetchSite: string | null;
  requestUrl: string;
}): boolean {
  if (opts.origin) return opts.origin === new URL(opts.requestUrl).origin;
  return opts.secFetchSite === "same-origin";
}

export function isHttps(url: string): boolean {
  return new URL(url).protocol === "https:";
}
