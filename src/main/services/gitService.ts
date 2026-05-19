import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { CommandSpawnError } from "../errors";

export interface GitServiceShape {
  readonly readDiff: (repoPath: string) => Effect.Effect<string, CommandSpawnError>;
}

export class GitService extends Context.Service<GitService, GitServiceShape>()(
  "clawpatch/GitService",
) {}

export const GitServiceLive = Layer.effect(
  GitService,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    return GitService.of({
      readDiff: Effect.fn("git.readDiff")(function* (repoPath) {
        return yield* runGit(spawner, repoPath, ["diff", "--no-color"]).pipe(
          Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })),
        );
      }),
    });
  }),
);

function runGit(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  args: readonly string[],
) {
  return Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make("git", args, { cwd: repoPath, shell: false }),
    );
    const [stdout, stderr] = yield* Effect.all(
      [collectOutput(child.stdout), collectOutput(child.stderr), child.exitCode],
      { concurrency: "unbounded" },
    );
    return stdout || stderr;
  }).pipe(Effect.scoped);
}

function collectOutput(stream: Stream.Stream<Uint8Array, unknown>): Effect.Effect<string, unknown> {
  return stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (output, chunk) => output + chunk,
    ),
  );
}
