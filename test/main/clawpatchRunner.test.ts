import { describe, expect, it } from "vitest";
import { buildClawpatchArgs } from "../../src/main/services/clawpatchRunner";

describe("buildClawpatchArgs", () => {
  it("builds allowed command args without shell input", () => {
    expect(buildClawpatchArgs({ command: "status" })).toEqual(["--json", "--no-color", "--no-input", "status"]);
    expect(buildClawpatchArgs({ command: "fix", findingId: "abc123" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "fix",
      "--finding",
      "abc123"
    ]);
  });

  it("builds native triage args with optional note", () => {
    expect(buildClawpatchArgs({ command: "triage", findingId: "abc123", status: "wont-fix", note: "accepted risk" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "triage",
      "--finding",
      "abc123",
      "--status",
      "wont-fix",
      "--note",
      "accepted risk"
    ]);
  });

  it("rejects missing or suspicious finding ids", () => {
    expect(() => buildClawpatchArgs({ command: "fix", findingId: "" })).toThrow("Missing findingId");
    expect(() => buildClawpatchArgs({ command: "fix", findingId: "abc\nreport" })).toThrow("Invalid findingId");
  });

  it("rejects unsupported triage statuses", () => {
    expect(() =>
      buildClawpatchArgs({
        command: "triage",
        findingId: "abc123",
        status: "ignored" as never
      })
    ).toThrow("Unsupported triage status");
  });
});
