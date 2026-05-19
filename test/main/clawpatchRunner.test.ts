import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { CommandResult } from "../../src/shared/types";
import {
  ClawpatchRunner,
  buildClawpatchArgs,
  makeClawpatchRunnerLayer
} from "../../src/main/services/clawpatchRunner";

describe("buildClawpatchArgs", () => {
  it("builds allowed command args without shell input", () => {
    expect(buildClawpatchArgs({ command: "status" })).toEqual(["--json", "--no-color", "--no-input", "status"]);
    expect(buildClawpatchArgs({ command: "map" })).toEqual(["--json", "--no-color", "--no-input", "map"]);
    expect(buildClawpatchArgs({ command: "review" })).toEqual(["--json", "--no-color", "--no-input", "review"]);
    expect(buildClawpatchArgs({ command: "review", featureId: "feat-123" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "review",
      "--feature",
      "feat-123"
    ]);
    expect(buildClawpatchArgs({ command: "review", limit: 3 })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "review",
      "--limit",
      "3"
    ]);
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

  it("rejects suspicious review feature ids and limits", () => {
    expect(() => buildClawpatchArgs({ command: "review", featureId: "" })).toThrow("Missing featureId");
    expect(() => buildClawpatchArgs({ command: "review", featureId: "feat\nreport" })).toThrow("Invalid featureId");
    expect(() => buildClawpatchArgs({ command: "review", limit: 0 })).toThrow("Invalid review limit");
    expect(() => buildClawpatchArgs({ command: "review", limit: 1.5 })).toThrow("Invalid review limit");
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

  it("rejects overlapping command runs for the same repo", async () => {
    let finishFirstRun: ((result: CommandResult) => void) | undefined;
    const runtime = ManagedRuntime.make(
      makeClawpatchRunnerLayer((input) =>
        new Promise<CommandResult>((resolve) => {
          finishFirstRun = resolve;
          input.onStream?.({ runId: input.runId, stream: "stdout", chunk: "started" });
        })
      )
    );
    const run = (repoPath: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.run(repoPath, { command: "status" });
        })
      );

    const first = run("/tmp/repo-a");
    await expect(run("/tmp/repo-a")).rejects.toThrow(
      "A Clawpatch command is already running for this repo"
    );

    const finish = finishFirstRun;
    if (finish === undefined) {
      throw new Error("first run did not start");
    }
    finish({
      runId: "run-test",
      command: "clawpatch",
      args: ["status"],
      cwd: "/tmp/repo-a",
      exitCode: 0,
      durationMs: 1,
      stdout: "{}",
      stderr: "",
      parsedJson: {}
    });
    await expect(first).resolves.toMatchObject({ exitCode: 0 });
    await runtime.dispose();
  });
});
