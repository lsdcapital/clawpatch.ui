import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  ClawpatchCommandRequestSchema,
  ClawpatchStatusSchema,
  CommandResultSchema,
  CommandStreamEventSchema,
  UiMetadataSchema,
} from "../../src/shared/schemas";

describe("shared schemas", () => {
  it("decodes valid clawpatch status literals", () => {
    expect(Schema.decodeUnknownSync(ClawpatchStatusSchema)("open")).toBe("open");
    expect(Schema.decodeUnknownSync(ClawpatchStatusSchema)("wont-fix")).toBe("wont-fix");
  });

  it("rejects invalid clawpatch status literals", () => {
    expect(() => Schema.decodeUnknownSync(ClawpatchStatusSchema)("closed")).toThrow();
  });

  it("decodes triage command requests with status literals", () => {
    const request = {
      command: "triage",
      findingId: "f1",
      status: "open",
    };

    expect(Schema.decodeUnknownSync(ClawpatchCommandRequestSchema)(request)).toEqual(request);
  });

  it("decodes fix command requests with optional guidance", () => {
    const request = {
      command: "fix",
      findingId: "f1",
      status: "open",
      note: "prefer the smaller patch",
    };

    expect(Schema.decodeUnknownSync(ClawpatchCommandRequestSchema)(request)).toEqual(request);
  });

  it("decodes UI metadata with nullable status filters", () => {
    const metadata = {
      schemaVersion: 1,
      filters: {
        severity: null,
        status: "uncertain",
        search: "",
      },
      lastSelectedFindingId: null,
      updatedAt: "2026-05-19T00:00:00.000Z",
    };

    expect(Schema.decodeUnknownSync(UiMetadataSchema)(metadata)).toEqual(metadata);
  });

  it("decodes command stream event stream literals", () => {
    const event = {
      runId: "r1",
      stream: "stdout",
      chunk: "x",
    };

    expect(Schema.decodeUnknownSync(CommandStreamEventSchema)(event)).toEqual(event);
  });

  it("decodes command results with related command results", () => {
    const result = {
      runId: "run-fix",
      command: "clawpatch",
      args: ["fix"],
      cwd: "/tmp/repo-worktree",
      exitCode: 0,
      durationMs: 10,
      stdout: "{}",
      stderr: "",
      parsedJson: {},
      relatedResults: [
        {
          runId: "run-revalidate",
          command: "clawpatch",
          args: ["revalidate"],
          cwd: "/tmp/repo-worktree",
          exitCode: 0,
          durationMs: 5,
          stdout: "{}",
          stderr: "",
          parsedJson: {},
        },
      ],
    };

    expect(Schema.decodeUnknownSync(CommandResultSchema)(result)).toEqual(result);
  });

  it("rejects invalid command stream event stream literals", () => {
    expect(() =>
      Schema.decodeUnknownSync(CommandStreamEventSchema)({
        runId: "r1",
        stream: "stdin",
        chunk: "x",
      }),
    ).toThrow();
  });
});
