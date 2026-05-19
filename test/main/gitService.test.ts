import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { GitService, GitServiceLive } from "../../src/main/services/gitService";

const encoder = new TextEncoder();

describe("GitService", () => {
  it("reads diffs through the Effect child process spawner", async () => {
    const commands: Array<{
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd: string | undefined;
    }> = [];
    const layer = GitServiceLive.pipe(
      Layer.provide(
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) => {
            const childProcess = command as unknown as {
              readonly command: string;
              readonly args: ReadonlyArray<string>;
              readonly options: { readonly cwd?: string };
            };
            commands.push({
              command: childProcess.command,
              args: childProcess.args,
              cwd: childProcess.options.cwd,
            });
            return Effect.succeed(mockHandle({ stdout: "diff --git a/file.ts b/file.ts\n" }));
          }),
        ),
      ),
    );

    const diff = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.readDiff("/tmp/repo-a");
      }).pipe(Effect.provide(layer)),
    );

    expect(diff).toBe("diff --git a/file.ts b/file.ts\n");
    expect(commands).toEqual([
      {
        command: "git",
        args: ["diff", "--no-color"],
        cwd: "/tmp/repo-a",
      },
    ]);
  });
});

function mockHandle(options: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
}): ChildProcessSpawner.ChildProcessHandle {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(options.stdout ?? "")),
    stderr: Stream.make(encoder.encode(options.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}
