import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { CommandSpawnError } from "../errors";

export interface GitStatusSummary {
  readonly staged: number;
  readonly modified: number;
  readonly untracked: number;
  readonly branch: string | null;
}

export interface GitServiceShape {
  readonly readDiff: (repoPath: string) => Effect.Effect<string, CommandSpawnError>;
  readonly readStatus: (repoPath: string) => Effect.Effect<GitStatusSummary, CommandSpawnError>;
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
      readStatus: Effect.fn("git.readStatus")(function* (repoPath) {
        const output = yield* runGit(spawner, repoPath, [
          "status",
          "--porcelain=v1",
          "--branch",
          "--untracked-files=all",
        ]).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        return parseGitStatus(output);
      }),
    });
  }),
);

function parseGitStatus(output: string): GitStatusSummary {
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let branch: string | null = null;

  for (const line of output.split("\n")) {
    if (line === "") {
      continue;
    }
    if (line.startsWith("## ")) {
      const header = line.slice(3);
      const dotsIndex = header.indexOf("...");
      const spaceIndex = header.indexOf(" ");
      const end = dotsIndex >= 0 ? dotsIndex : spaceIndex >= 0 ? spaceIndex : header.length;
      branch = header.slice(0, end) || null;
      continue;
    }
    if (line.startsWith("??")) {
      untracked += 1;
      continue;
    }
    const indexStatus = line.charAt(0);
    const worktreeStatus = line.charAt(1);
    if (indexStatus !== " " && indexStatus !== "?") {
      staged += 1;
    }
    if (worktreeStatus !== " " && worktreeStatus !== "?") {
      modified += 1;
    }
  }

  return { staged, modified, untracked, branch };
}

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
