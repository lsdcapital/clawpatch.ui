import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { CommandResult } from "../../src/shared/types";
import {
  ClawpatchRunner,
  buildClawpatchArgs,
  makeClawpatchRunnerLayer,
} from "../../src/main/services/clawpatchRunner";

describe("buildClawpatchArgs", () => {
  it("builds allowed command args without shell input", () => {
    expect(buildClawpatchArgs({ command: "status" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "status",
    ]);
    expect(buildClawpatchArgs({ command: "map" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "map",
    ]);
    expect(buildClawpatchArgs({ command: "review" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "review",
    ]);
    expect(buildClawpatchArgs({ command: "review", featureId: "feat-123" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "review",
      "--feature",
      "feat-123",
    ]);
    expect(buildClawpatchArgs({ command: "review", limit: 3 })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "review",
      "--limit",
      "3",
    ]);
    expect(buildClawpatchArgs({ command: "fix", findingId: "abc123" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "fix",
      "--finding",
      "abc123",
    ]);
    expect(buildClawpatchArgs({ command: "revalidate", findingId: "abc123" })).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "revalidate",
      "--finding",
      "abc123",
    ]);
  });

  it("builds native triage args with optional note", () => {
    expect(
      buildClawpatchArgs({
        command: "triage",
        findingId: "abc123",
        status: "wont-fix",
        note: "accepted risk",
      }),
    ).toEqual([
      "--json",
      "--no-color",
      "--no-input",
      "triage",
      "--finding",
      "abc123",
      "--status",
      "wont-fix",
      "--note",
      "accepted risk",
    ]);
  });

  it("rejects missing or suspicious finding ids", () => {
    expect(() => buildClawpatchArgs({ command: "fix", findingId: "" })).toThrow(
      "Missing findingId",
    );
    expect(() => buildClawpatchArgs({ command: "fix", findingId: "abc\nreport" })).toThrow(
      "Invalid findingId",
    );
    expect(() => buildClawpatchArgs({ command: "revalidate", findingId: "" })).toThrow(
      "Missing findingId",
    );
    expect(() => buildClawpatchArgs({ command: "revalidate", findingId: "abc\nreport" })).toThrow(
      "Invalid findingId",
    );
  });

  it("rejects suspicious review feature ids and limits", () => {
    expect(() => buildClawpatchArgs({ command: "review", featureId: "" })).toThrow(
      "Missing featureId",
    );
    expect(() => buildClawpatchArgs({ command: "review", featureId: "feat\nreport" })).toThrow(
      "Invalid featureId",
    );
    expect(() => buildClawpatchArgs({ command: "review", limit: 0 })).toThrow(
      "Invalid review limit",
    );
    expect(() => buildClawpatchArgs({ command: "review", limit: 1.5 })).toThrow(
      "Invalid review limit",
    );
  });

  it("rejects unsupported triage statuses", () => {
    expect(() =>
      buildClawpatchArgs({
        command: "triage",
        findingId: "abc123",
        status: "ignored" as never,
      }),
    ).toThrow("Unsupported triage status");
  });

  it("rejects overlapping command runs for the same repo", async () => {
    let finishFirstRun: ((result: CommandResult) => void) | undefined;
    const runtime = ManagedRuntime.make(
      makeClawpatchRunnerLayer(
        (input) =>
          new Promise<CommandResult>((resolve) => {
            finishFirstRun = resolve;
            input.onStream?.({ runId: input.runId, stream: "stdout", chunk: "started" });
          }),
      ),
    );
    const run = (repoPath: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.run(repoPath, { command: "status" });
        }),
      );
    const isRunning = (repoPath: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.isRunning(repoPath);
        }),
      );

    await expect(isRunning("/tmp/repo-a")).resolves.toBe(false);
    const first = run("/tmp/repo-a");
    await expect(isRunning("/tmp/repo-a")).resolves.toBe(true);
    await expect(isRunning("/tmp/repo-b")).resolves.toBe(false);
    await expect(run("/tmp/repo-a")).rejects.toThrow(
      "A Clawpatch command is already running for this repo",
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
      parsedJson: {},
    });
    await expect(first).resolves.toMatchObject({ exitCode: 0 });
    await expect(isRunning("/tmp/repo-a")).resolves.toBe(false);
    await runtime.dispose();
  });

  it("interrupts an active command and clears it after close", async () => {
    let finishRun: ((result: CommandResult) => void) | undefined;
    let interruptCount = 0;
    const runtime = ManagedRuntime.make(
      makeClawpatchRunnerLayer(
        (input) =>
          new Promise<CommandResult>((resolve) => {
            finishRun = resolve;
            input.registerInterrupt(() => {
              interruptCount += 1;
              return true;
            });
          }),
      ),
    );

    const run = runtime.runPromise(
      Effect.gen(function* () {
        const runner = yield* ClawpatchRunner;
        return yield* runner.run("/tmp/repo-a", { command: "status" });
      }),
    );

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.isRunning("/tmp/repo-a");
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.interrupt("/tmp/repo-a");
        }),
      ),
    ).resolves.toEqual({ interrupted: true });
    expect(interruptCount).toBe(1);

    const finish = finishRun;
    if (finish === undefined) {
      throw new Error("run did not start");
    }
    finish({
      runId: "run-test",
      command: "clawpatch",
      args: ["status"],
      cwd: "/tmp/repo-a",
      exitCode: 130,
      durationMs: 1,
      stdout: "",
      stderr: "",
      parsedJson: null,
    });
    await expect(run).resolves.toMatchObject({ exitCode: 130 });

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.isRunning("/tmp/repo-a");
        }),
      ),
    ).resolves.toBe(false);

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.interrupt("/tmp/repo-a");
        }),
      ),
    ).resolves.toEqual({ interrupted: false });
    await runtime.dispose();
  });

  it("returns not interrupted for an idle repo", async () => {
    const runtime = ManagedRuntime.make(
      makeClawpatchRunnerLayer(() => Promise.reject(new Error("should not run"))),
    );

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.interrupt("/tmp/repo-a");
        }),
      ),
    ).resolves.toEqual({ interrupted: false });
    await runtime.dispose();
  });
});
