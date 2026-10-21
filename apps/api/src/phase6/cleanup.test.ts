import { describe, expect, it } from "vitest";
import {
  AUDIT_RETENTION_MS,
  EVENTS_RETENTION_MS,
  RATE_LIMIT_RETENTION_SEC,
  USAGE_RETENTION_MS,
  cutoffs,
  msExpr,
} from "./cleanup";

describe("cutoffs", () => {
  it("menghitung batas hapus dari waktu sekarang", () => {
    const now = 1_800_000_000_000;
    const c = cutoffs(now);
    expect(c.rateLimitBeforeSec).toBe(now / 1000 - RATE_LIMIT_RETENTION_SEC);
    expect(c.auditBeforeMs).toBe(now - AUDIT_RETENTION_MS);
  });
  it("audit disimpan 90 hari", () => {
    expect(AUDIT_RETENTION_MS).toBe(90 * 86_400_000);
  });
});

describe("retensi tabel lama", () => {
  it("event 30 hari, usage 90 hari", () => {
    const now = 1_800_000_000_000;
    const c = cutoffs(now);
    expect(c.eventsBeforeMs).toBe(now - EVENTS_RETENTION_MS);
    expect(c.usageBeforeMs).toBe(now - USAGE_RETENTION_MS);
    expect(EVENTS_RETENTION_MS).toBe(30 * 86_400_000);
    expect(USAGE_RETENTION_MS).toBe(90 * 86_400_000);
  });
});

describe("msExpr", () => {
  it("menormalkan detik dan milidetik ke milidetik", () => {
    const e = msExpr("created_at");
    expect(e).toContain("created_at > 100000000000");
    expect(e).toContain("created_at * 1000");
  });
});
