import { describe, expect, it } from "vitest";
import { clientId, windowStartSec } from "./rate-limit";

describe("windowStartSec", () => {
  it("membulatkan ke awal jendela", () => {
    expect(windowStartSec(125, 60)).toBe(120);
    expect(windowStartSec(120, 60)).toBe(120);
    expect(windowStartSec(179, 60)).toBe(120);
  });
});

describe("clientId", () => {
  it("memakai IP bila ada", () => {
    expect(clientId("1.2.3.4")).toBe("1.2.3.4");
  });
  it("jatuh ke unknown bila kosong atau terlalu panjang", () => {
    expect(clientId(null)).toBe("unknown");
    expect(clientId("")).toBe("unknown");
    expect(clientId("x".repeat(65))).toBe("unknown");
  });
});
