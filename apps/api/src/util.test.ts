import { describe, expect, it } from "vitest";
import { isSameOrigin, randomToken, safeEqual, sha256Hex, toBase64Url } from "./util";

describe("util", () => {
  it("sha256Hex cocok dengan vektor uji standar", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("toBase64Url tidak memakai karakter + / =", () => {
    const out = toBase64Url(new Uint8Array([251, 255, 254, 0, 1]));
    expect(out).not.toMatch(/[+/=]/);
  });

  it("randomToken unik dan panjangnya sesuai", () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a.length).toBe(43);
  });

  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("isSameOrigin", () => {
    const requestUrl = "https://app.example.workers.dev/api/auth/logout";
    expect(isSameOrigin({ origin: "https://app.example.workers.dev", secFetchSite: null, requestUrl })).toBe(true);
    expect(isSameOrigin({ origin: "https://evil.example", secFetchSite: null, requestUrl })).toBe(false);
    expect(isSameOrigin({ origin: null, secFetchSite: "same-origin", requestUrl })).toBe(true);
    expect(isSameOrigin({ origin: null, secFetchSite: "cross-site", requestUrl })).toBe(false);
    expect(isSameOrigin({ origin: null, secFetchSite: null, requestUrl })).toBe(false);
  });
});
