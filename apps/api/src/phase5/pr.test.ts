import { describe, expect, it } from "vitest";
import { assertSafeBranch, assertSafePath, toBase64Utf8 } from "./pr";

describe("phase5 pr helpers", () => {
  it("menerima branch agent/* yang valid", () => {
    expect(() => assertSafeBranch("agent/test-123")).not.toThrow();
  });

  it("menolak branch di luar agent/*", () => {
    expect(() => assertSafeBranch("main")).toThrow();
    expect(() => assertSafeBranch("agent/../main")).toThrow();
    expect(() => assertSafeBranch("agent/Huruf Besar")).toThrow();
  });

  it("menolak path berbahaya", () => {
    expect(() => assertSafePath("docs/ok.md")).not.toThrow();
    expect(() => assertSafePath("../x")).toThrow();
    expect(() => assertSafePath("/etc/x")).toThrow();
    expect(() => assertSafePath("a//b")).toThrow();
    expect(() => assertSafePath(".github/workflows/ci.yml")).toThrow();
  });

  it("base64 UTF-8", () => {
    expect(toBase64Utf8("halo")).toBe("aGFsbw==");
    expect(toBase64Utf8("é")).toBe("w6k=");
  });
});
