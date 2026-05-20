import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
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
  readonly requireCleanCheckout: (repoPath: string) => Effect.Effect<void, CommandSpawnError>;
  readonly createOrReuseWorktree: (input: {
    readonly repoPath: string;
    readonly worktreePath: string;
    readonly branchName: string;
  }) => Effect.Effect<string, CommandSpawnError>;
}

export class GitService extends Context.Service<GitService, GitServiceShape>()(
  "clawpatch/GitService",
) {}

export const GitServiceLive = Layer.effect(
  GitService,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return GitService.of({
      readDiff: Effect.fn("git.readDiff")(function* (repoPath) {
        return yield* runGitOutput(spawner, repoPath, ["diff", "--no-color"]).pipe(
          Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })),
        );
      }),
      readStatus: Effect.fn("git.readStatus")(function* (repoPath) {
        const output = yield* runGitOutput(spawner, repoPath, [
          "status",
          "--porcelain=v1",
          "--branch",
          "--untracked-files=all",
        ]).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        return parseGitStatus(output);
      }),
      requireCleanCheckout: Effect.fn("git.requireCleanCheckout")(function* (repoPath) {
        const output = yield* runGitOutput(spawner, repoPath, [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
        ]).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        if (output.trim() !== "") {
          return yield* new CommandSpawnError({
            repoPath,
            cause: new Error(
              "Registered checkout must be clean before running fix in a worktree. Commit, stash, or discard existing changes first.",
            ),
          });
        }
      }),
      createOrReuseWorktree: Effect.fn("git.createOrReuseWorktree")(function* ({
        repoPath,
        worktreePath,
        branchName,
      }) {
        const existingStats = yield* fs.stat(worktreePath).pipe(
          Effect.map((stats) => stats),
          Effect.catch(() => Effect.succeed(null)),
        );

        if (existingStats !== null) {
          if (existingStats.type !== "Directory") {
            return yield* worktreeError(
              repoPath,
              `Expected worktree path exists but is not a directory: ${worktreePath}`,
            );
          }
          yield* assertExistingWorktree(spawner, repoPath, worktreePath, branchName);
          return worktreePath;
        }

        const branchExists = yield* localBranchExists(spawner, repoPath, branchName).pipe(
          Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })),
        );
        if (branchExists) {
          return yield* worktreeError(
            repoPath,
            `Fix branch already exists but is not checked out at the managed worktree path: ${branchName}`,
          );
        }

        yield* fs
          .makeDirectory(path.dirname(worktreePath), { recursive: true })
          .pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        yield* runGitOutput(spawner, repoPath, [
          "worktree",
          "add",
          "-b",
          branchName,
          worktreePath,
          "HEAD",
        ]).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        return worktreePath;
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

function runGitOutput(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  args: readonly string[],
) {
  return runGitResult(spawner, repoPath, args).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) => {
      if (exitCode === 0) {
        return Effect.succeed(stdout || stderr);
      }
      return Effect.fail(new Error(stderr || stdout || `git ${args.join(" ")} failed`));
    }),
  );
}

function runGitResult(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  args: readonly string[],
) {
  return Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make("git", args, { cwd: repoPath, shell: false }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [collectOutput(child.stdout), collectOutput(child.stderr), child.exitCode],
      { concurrency: "unbounded" },
    ).pipe(Effect.onInterrupt(() => interruptChild(child).pipe(Effect.asVoid)));
    return { stdout, stderr, exitCode: Number(exitCode) };
  }).pipe(Effect.scoped);
}

function interruptChild(child: ChildProcessSpawner.ChildProcessHandle): Effect.Effect<boolean> {
  let hasInterrupted = false;
  return Effect.gen(function* () {
    if (hasInterrupted) {
      return false;
    }
    const isRunning = yield* child.isRunning;
    if (!isRunning) {
      return false;
    }
    hasInterrupted = true;
    yield* child.kill({ killSignal: "SIGINT", forceKillAfter: "2 seconds" });
    return true;
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

function localBranchExists(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  branchName: string,
): Effect.Effect<boolean, unknown> {
  return runGitResult(spawner, repoPath, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) => {
      if (exitCode === 0) {
        return Effect.succeed(true);
      }
      if (exitCode === 1) {
        return Effect.succeed(false);
      }
      return Effect.fail(new Error(stderr || stdout || `Unable to inspect branch ${branchName}`));
    }),
  );
}

function assertExistingWorktree(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  worktreePath: string,
  branchName: string,
): Effect.Effect<void, CommandSpawnError> {
  return Effect.gen(function* () {
    const isWorktree = yield* runGitOutput(spawner, worktreePath, [
      "rev-parse",
      "--is-inside-work-tree",
    ]).pipe(
      Effect.map((output) => output.trim() === "true"),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!isWorktree) {
      return yield* worktreeError(
        repoPath,
        `Expected worktree path exists but is not a Git worktree: ${worktreePath}`,
      );
    }

    const checkedOutBranch = yield* runGitOutput(spawner, worktreePath, [
      "branch",
      "--show-current",
    ]).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
    if (checkedOutBranch.trim() !== branchName) {
      return yield* worktreeError(
        repoPath,
        `Managed worktree is checked out on ${checkedOutBranch.trim() || "detached HEAD"}, expected ${branchName}.`,
      );
    }
  });
}

function worktreeError(repoPath: string, message: string): Effect.Effect<never, CommandSpawnError> {
  return new CommandSpawnError({ repoPath, cause: new Error(message) });
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
