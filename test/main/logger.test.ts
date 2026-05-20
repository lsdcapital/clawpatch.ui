import { describe, expect, it } from "vitest";
import { resolveLogLevel } from "../../src/main/logger";

describe("resolveLogLevel", () => {
  it("defaults to info when LOG_LEVEL is unset", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
  });

  it("accepts supported pino levels", () => {
    expect(resolveLogLevel("debug")).toBe("debug");
    expect(resolveLogLevel("trace")).toBe("trace");
    expect(resolveLogLevel("silent")).toBe("silent");
  });

  it("falls back to info for invalid levels", () => {
    expect(resolveLogLevel("verbose")).toBe("info");
    expect(resolveLogLevel("DEBUG")).toBe("info");
  });
});
