import { describe, expect, it } from "vitest";
import { clampLimit, shouldAudit } from "./audit";

describe("shouldAudit", () => {
  it("mencatat request yang mengubah data", () => {
    expect(shouldAudit("POST", "/api/tasks", 200)).toBe(true);
    expect(shouldAudit("DELETE", "/api/tasks/1", 200)).toBe(true);
  });
  it("mencatat semua /api/auth/*", () => {
    expect(shouldAudit("GET", "/api/auth/callback", 302)).toBe(true);
  });
  it("mencatat penolakan", () => {
    expect(shouldAudit("GET", "/api/tasks", 401)).toBe(true);
    expect(shouldAudit("GET", "/api/tasks", 429)).toBe(true);
  });
  it("tidak mencatat GET biasa yang sukses", () => {
    expect(shouldAudit("GET", "/api/health", 200)).toBe(false);
    expect(shouldAudit("GET", "/api/tasks", 200)).toBe(false);
  });
});

describe("clampLimit", () => {
  it("memakai default dan batas", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit("abc")).toBe(50);
    expect(clampLimit("0")).toBe(50);
    expect(clampLimit("10")).toBe(10);
    expect(clampLimit("9999")).toBe(200);
  });
});
