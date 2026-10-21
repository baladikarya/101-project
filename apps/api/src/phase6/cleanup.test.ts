import { describe, expect, it } from "vitest";
import { AUDIT_RETENTION_MS, RATE_LIMIT_RETENTION_SEC, cutoffs } from "./cleanup";

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
