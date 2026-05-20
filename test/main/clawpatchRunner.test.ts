import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import {
  ClawpatchRunner,
  buildClawpatchArgs,
  makeClawpatchRunnerLayer,
} from "../../src/main/services/clawpatchRunner";
import type { CommandStreamEvent } from "../../src/shared/types";

const encoder = new TextEncoder();

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
    expect(
      buildClawpatchArgs({
        command: "fix",
        findingId: "abc123",
        status: "open",
        note: "prefer small fix",
      }),
    ).toEqual(["--json", "--no-color", "--no-input", "fix", "--finding", "abc123"]);
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

  it("emits command start before process output", async () => {
    const events: CommandStreamEvent[] = [];
    const runtime = makeRunnerRuntime(() =>
      Effect.succeed(
        mockHandle({
          stdout: "started\n",
        }),
      ),
    );

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.run("/tmp/repo", { command: "fix", findingId: "fnd-1" }, (event) =>
            events.push(event),
          );
        }),
      ),
    ).resolves.toMatchObject({ exitCode: 0, stdout: "started\n" });

    const lifecycleIndex = events.findIndex((event) => event.kind === "lifecycle");
    const stdoutIndex = events.findIndex(
      (event) =>
        event.kind === "output" && event.stream === "stdout" && event.chunk === "started\n",
    );

    expect(events[lifecycleIndex]).toMatchObject({
      kind: "lifecycle",
      phase: "clawpatch:start",
      cwd: "/tmp/repo",
      argv: ["clawpatch", "--json", "--no-color", "--no-input", "fix", "--finding", "fnd-1"],
    });
    expect(events[stdoutIndex]).toMatchObject({
      kind: "output",
      stream: "stdout",
      chunk: "started\n",
    });
    expect(lifecycleIndex).toBeGreaterThanOrEqual(0);
    expect(stdoutIndex).toBeGreaterThan(lifecycleIndex);
    await runtime.dispose();
  });

  it("rejects overlapping command runs for the same repo", async () => {
    let finishFirstRun: ((result: CommandResult) => void) | undefined;
    const runtime = makeRunnerRuntime(() =>
      Effect.succeed(
        mockHandle({
          stdout: "started",
          exitCode: Effect.promise(
            () =>
              new Promise((resolve) => {
                finishFirstRun = (result) =>
                  resolve(ChildProcessSpawner.ExitCode(result.exitCode ?? 0));
              }),
          ),
          isRunning: Effect.succeed(true),
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

    if (finishFirstRun === undefined) {
      throw new Error("first run did not start");
    }
    finishFirstRun({
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

  it("allows overlapping command runs for different worktree paths", async () => {
    const finishers: Array<() => void> = [];
    const runtime = makeRunnerRuntime(() =>
      Effect.succeed(
        mockHandle({
          exitCode: Effect.promise(
            () =>
              new Promise((resolve) => {
                finishers.push(() => resolve(ChildProcessSpawner.ExitCode(0)));
              }),
          ),
          isRunning: Effect.succeed(true),
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

    const first = run("/tmp/repo-a/worktree-fnd-1");
    const second = run("/tmp/repo-a/worktree-fnd-2");

    await waitUntil(() => finishers.length === 2);
    finishers[0]?.();
    finishers[1]?.();

    await expect(first).resolves.toMatchObject({ exitCode: 0 });
    await expect(second).resolves.toMatchObject({ exitCode: 0 });
    await runtime.dispose();
  });

  it("interrupts all active commands for shutdown", async () => {
    const finishers: Array<() => void> = [];
    const killCounts = new Map<number, number>();
    let nextHandleId = 0;
    const runtime = makeRunnerRuntime(() => {
      const handleId = nextHandleId;
      nextHandleId += 1;
      return Effect.succeed(
        mockHandle({
          exitCode: Effect.promise(
            () =>
              new Promise((resolve) => {
                finishers.push(() => resolve(ChildProcessSpawner.ExitCode(130)));
              }),
          ),
          isRunning: Effect.succeed(true),
          kill: () =>
            Effect.sync(() => {
              killCounts.set(handleId, (killCounts.get(handleId) ?? 0) + 1);
            }),
        }),
      );
    });
    const run = (repoPath: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.run(repoPath, { command: "status" });
        }),
      );

    const first = run("/tmp/repo-a");
    const second = run("/tmp/repo-b");
    await waitUntil(() => finishers.length === 2);

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.interruptAll();
        }),
      ),
    ).resolves.toBe(2);
    expect(killCounts).toEqual(
      new Map([
        [0, 1],
        [1, 1],
      ]),
    );

    finishers[0]?.();
    finishers[1]?.();
    await expect(first).resolves.toMatchObject({ exitCode: 130 });
    await expect(second).resolves.toMatchObject({ exitCode: 130 });

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
          return yield* runner.isRunning("/tmp/repo-b");
        }),
      ),
    ).resolves.toBe(false);
    await runtime.dispose();
  });

  it("interrupts an active command and clears it after close", async () => {
    let finishRun: ((result: CommandResult) => void) | undefined;
    let killCount = 0;
    const runtime = makeRunnerRuntime(() =>
      Effect.succeed(
        mockHandle({
          exitCode: Effect.promise(
            () =>
              new Promise((resolve) => {
                finishRun = (result) => resolve(ChildProcessSpawner.ExitCode(result.exitCode ?? 0));
              }),
          ),
          isRunning: Effect.succeed(true),
          kill: () =>
            Effect.sync(() => {
              killCount += 1;
            }),
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
    expect(killCount).toBe(1);

    if (finishRun === undefined) {
      throw new Error("run did not start");
    }
    finishRun({
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
    const runtime = makeRunnerRuntime(() => Effect.die("should not run"));

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

  it("kills the active process and clears active state when the effect is interrupted", async () => {
    let killCount = 0;
    const runtime = makeRunnerRuntime(() =>
      Effect.succeed(
        mockHandle({
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () =>
            Effect.sync(() => {
              killCount += 1;
            }),
        }),
      ),
    );
    const abortController = new AbortController();

    const run = runtime
      .runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.run("/tmp/repo-a", { command: "status" });
        }),
        { signal: abortController.signal },
      )
      .catch(() => undefined);

    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.isRunning("/tmp/repo-a");
        }),
      ),
    ).resolves.toBe(true);

    abortController.abort();
    await run;

    expect(killCount).toBe(1);
    await expect(
      runtime.runPromise(
        Effect.gen(function* () {
          const runner = yield* ClawpatchRunner;
          return yield* runner.isRunning("/tmp/repo-a");
        }),
      ),
    ).resolves.toBe(false);

    await runtime.dispose();
  });
});

type CommandResult = import("../../src/shared/types").CommandResult;

async function waitUntil(assertion: () => boolean): Promise<void> {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started > 1000) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function makeRunnerRuntime(
  spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"],
): ManagedRuntime.ManagedRuntime<ClawpatchRunner, never> {
  return ManagedRuntime.make(
    makeClawpatchRunnerLayer().pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(spawn)),
      ),
    ),
  );
}

function mockHandle(options: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode>;
  readonly isRunning?: Effect.Effect<boolean>;
  readonly kill?: ChildProcessSpawner.ChildProcessHandle["kill"];
}): ChildProcessSpawner.ChildProcessHandle {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: options.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: options.isRunning ?? Effect.succeed(false),
    kill: options.kill ?? (() => Effect.void),
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(options.stdout ?? "")),
    stderr: Stream.make(encoder.encode(options.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}
