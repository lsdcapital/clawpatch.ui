import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { CommandSpawnError } from "../errors";
import { childLogger } from "../logger";

const gitLogger = childLogger("git");
const DEFAULT_TARGET_REMOTE = "origin";
const DEFAULT_TARGET_BRANCH = "main";
const DEFAULT_TARGET_BASE_REF = `${DEFAULT_TARGET_REMOTE}/${DEFAULT_TARGET_BRANCH}`;

export interface GitStatusSummary {
  readonly staged: number;
  readonly modified: number;
  readonly untracked: number;
  readonly branch: string | null;
}

export interface GitLifecycleEvent {
  readonly phase: string;
  readonly message: string;
  readonly cwd: string;
  readonly argv: readonly string[];
}

export interface GitPublishFixResult {
  readonly worktreePath: string;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly commitSha: string;
  readonly remoteName: string;
  readonly prUrl: string;
}

export interface GitWorktreeResult {
  readonly worktreePath: string;
  readonly created: boolean;
}

export interface GitServiceShape {
  readonly readDiff: (
    repoPath: string,
    onLifecycle?: (event: GitLifecycleEvent) => void,
  ) => Effect.Effect<string, CommandSpawnError>;
  readonly readStatus: (
    repoPath: string,
    onLifecycle?: (event: GitLifecycleEvent) => void,
  ) => Effect.Effect<GitStatusSummary, CommandSpawnError>;
  readonly requireCleanCheckout: (
    repoPath: string,
    onLifecycle?: (event: GitLifecycleEvent) => void,
  ) => Effect.Effect<void, CommandSpawnError>;
  readonly createOrReuseWorktree: (
    input: {
      readonly repoPath: string;
      readonly worktreePath: string;
      readonly branchName: string;
      readonly baseRef: string;
    },
    onLifecycle?: (event: GitLifecycleEvent) => void,
  ) => Effect.Effect<GitWorktreeResult, CommandSpawnError>;
  readonly publishFix: (
    input: {
      readonly repoPath: string;
      readonly worktreePath: string;
      readonly branchName: string;
      readonly baseBranch: string | null;
      readonly commitMessage: string;
    },
    onLifecycle?: (event: GitLifecycleEvent) => void,
  ) => Effect.Effect<GitPublishFixResult, CommandSpawnError>;
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
      readDiff: Effect.fn("git.readDiff")(function* (repoPath, onLifecycle) {
        return yield* runGitOutput(spawner, repoPath, ["diff", "--no-color"], onLifecycle).pipe(
          Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })),
        );
      }),
      readStatus: Effect.fn("git.readStatus")(function* (repoPath, onLifecycle) {
        const output = yield* runGitOutput(
          spawner,
          repoPath,
          ["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        return parseGitStatus(output);
      }),
      requireCleanCheckout: Effect.fn("git.requireCleanCheckout")(
        function* (repoPath, onLifecycle) {
          const output = yield* runGitOutput(
            spawner,
            repoPath,
            ["status", "--porcelain=v1", "--untracked-files=all"],
            onLifecycle,
          ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
          if (output.trim() !== "") {
            return yield* new CommandSpawnError({
              repoPath,
              cause: new Error(
                "Registered checkout must be clean before running fix in a worktree. Commit, stash, or discard existing changes first.",
              ),
            });
          }
        },
      ),
      createOrReuseWorktree: Effect.fn("git.createOrReuseWorktree")(function* (
        { repoPath, worktreePath, branchName, baseRef },
        onLifecycle,
      ) {
        const resolvedBaseRef = yield* resolveTargetBaseRef(
          spawner,
          repoPath,
          baseRef,
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
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
          yield* assertExistingWorktree(spawner, repoPath, worktreePath, branchName, onLifecycle);
          yield* rebaseExistingWorktree(
            spawner,
            repoPath,
            worktreePath,
            resolvedBaseRef,
            onLifecycle,
          );
          return { worktreePath, created: false };
        }

        const branchExists = yield* localBranchExists(
          spawner,
          repoPath,
          branchName,
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        if (branchExists) {
          return yield* worktreeError(
            repoPath,
            `Fix branch already exists but is not checked out at the managed worktree path: ${branchName}`,
          );
        }

        yield* fs
          .makeDirectory(path.dirname(worktreePath), { recursive: true })
          .pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        yield* runGitOutput(
          spawner,
          repoPath,
          ["worktree", "add", "-b", branchName, worktreePath, resolvedBaseRef],
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        return { worktreePath, created: true };
      }),
      publishFix: Effect.fn("git.publishFix")(function* (
        { repoPath, worktreePath, branchName, baseBranch, commitMessage },
        onLifecycle,
      ) {
        yield* assertExistingWorktree(spawner, repoPath, worktreePath, branchName, onLifecycle);

        const resolvedBaseBranch = yield* resolvePublishBaseBranch(
          spawner,
          repoPath,
          baseBranch,
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        const remoteUrl = yield* readRequiredRemoteUrl(
          spawner,
          repoPath,
          DEFAULT_TARGET_REMOTE,
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        const githubUrl = parseGitHubRemoteUrl(remoteUrl);
        if (githubUrl === null) {
          return yield* worktreeError(repoPath, "Publish PR supports GitHub origin remotes only.");
        }

        const statusOutput = yield* runGitOutput(
          spawner,
          worktreePath,
          ["status", "--porcelain=v1", "--untracked-files=all"],
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        if (statusOutput.trim() !== "") {
          yield* runGitOutput(spawner, worktreePath, ["add", "-A"], onLifecycle).pipe(
            Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })),
          );
          yield* runGitOutput(
            spawner,
            worktreePath,
            ["commit", "-m", commitMessage],
            onLifecycle,
          ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        }

        const hasPublishableCommit = yield* branchHasPublishableCommit(
          spawner,
          worktreePath,
          resolvedBaseBranch,
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        if (!hasPublishableCommit) {
          return yield* worktreeError(repoPath, "No fix changes to publish.");
        }

        yield* runGitOutput(
          spawner,
          worktreePath,
          ["push", "-u", DEFAULT_TARGET_REMOTE, branchName],
          onLifecycle,
        ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
        const commitSha = yield* runGitOutput(spawner, worktreePath, ["rev-parse", "HEAD"]).pipe(
          Effect.map((output) => output.trim()),
          Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })),
        );

        return {
          worktreePath,
          branchName,
          baseBranch: resolvedBaseBranch,
          commitSha,
          remoteName: DEFAULT_TARGET_REMOTE,
          prUrl: `${githubUrl}/compare/${encodeCompareRef(resolvedBaseBranch)}...${encodeCompareRef(branchName)}?expand=1`,
        };
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
  onLifecycle?: (event: GitLifecycleEvent) => void,
) {
  return runGitResult(spawner, repoPath, args, onLifecycle).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) => {
      if (exitCode === 0) {
        return Effect.succeed(stdout || stderr);
      }
      gitLogger.debug(
        {
          repoPath,
          args,
          exitCode,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        },
        "Git command exited non-zero",
      );
      return Effect.fail(new Error(stderr || stdout || `git ${args.join(" ")} failed`));
    }),
  );
}

function runGitResult(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  args: readonly string[],
  onLifecycle?: (event: GitLifecycleEvent) => void,
) {
  let started = 0;
  return Effect.gen(function* () {
    started = Date.now();
    gitLogger.debug({ repoPath, args }, "Starting git command");
    const argv = ["git", ...args];
    onLifecycle?.({
      phase: "git:start",
      message: `$ ${formatArgv(argv)}`,
      cwd: repoPath,
      argv,
    });
    const child = yield* spawner.spawn(
      ChildProcess.make("git", args, { cwd: repoPath, shell: false }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [collectOutput(child.stdout), collectOutput(child.stderr), child.exitCode],
      { concurrency: "unbounded" },
    ).pipe(Effect.onInterrupt(() => interruptChild(child).pipe(Effect.asVoid)));
    const numericExitCode = Number(exitCode);
    gitLogger.debug(
      {
        repoPath,
        args,
        exitCode: numericExitCode,
        durationMs: Date.now() - started,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      },
      "Git command completed",
    );
    return { stdout, stderr, exitCode: numericExitCode };
  }).pipe(
    Effect.tapError((cause) =>
      Effect.sync(() => {
        gitLogger.error(
          {
            err: cause,
            repoPath,
            args,
            durationMs: started === 0 ? undefined : Date.now() - started,
          },
          "Git command failed",
        );
      }),
    ),
    Effect.scoped,
  );
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
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<boolean, unknown> {
  return runGitResult(
    spawner,
    repoPath,
    ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
    onLifecycle,
  ).pipe(
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

function resolveTargetBaseRef(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  preferredBaseRef: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    if (preferredBaseRef === DEFAULT_TARGET_BASE_REF) {
      const hasOrigin = yield* remoteExists(spawner, repoPath, DEFAULT_TARGET_REMOTE, onLifecycle);
      if (hasOrigin) {
        yield* runGitOutput(
          spawner,
          repoPath,
          [
            "fetch",
            DEFAULT_TARGET_REMOTE,
            `+refs/heads/${DEFAULT_TARGET_BRANCH}:refs/remotes/${DEFAULT_TARGET_REMOTE}/${DEFAULT_TARGET_BRANCH}`,
          ],
          onLifecycle,
        );
        yield* requireCommit(spawner, repoPath, preferredBaseRef, onLifecycle);
        return preferredBaseRef;
      }

      yield* requireCommit(spawner, repoPath, DEFAULT_TARGET_BRANCH, onLifecycle);
      return DEFAULT_TARGET_BRANCH;
    }

    yield* requireCommit(spawner, repoPath, preferredBaseRef, onLifecycle);
    return preferredBaseRef;
  });
}

function remoteExists(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  remoteName: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<boolean, unknown> {
  return runGitResult(spawner, repoPath, ["remote", "get-url", remoteName], onLifecycle).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) => {
      if (exitCode === 0) {
        return Effect.succeed(true);
      }
      if (exitCode === 2) {
        return Effect.succeed(false);
      }
      return Effect.fail(new Error(stderr || stdout || `Unable to inspect remote ${remoteName}`));
    }),
  );
}

function readRequiredRemoteUrl(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  remoteName: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<string, unknown> {
  return runGitResult(spawner, repoPath, ["remote", "get-url", remoteName], onLifecycle).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) => {
      if (exitCode === 0) {
        return Effect.succeed(stdout.trim());
      }
      if (exitCode === 2) {
        return Effect.fail(new Error(`Remote ${remoteName} is required before publishing a PR.`));
      }
      return Effect.fail(new Error(stderr || stdout || `Unable to inspect remote ${remoteName}`));
    }),
  );
}

function resolvePublishBaseBranch(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  preferredBaseBranch: string | null,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    if (
      preferredBaseBranch !== null &&
      preferredBaseBranch.trim() !== "" &&
      preferredBaseBranch !== "HEAD"
    ) {
      return preferredBaseBranch.trim();
    }

    const originHead = yield* runGitOutput(
      spawner,
      repoPath,
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      onLifecycle,
    ).pipe(
      Effect.map((output) => output.trim()),
      Effect.catch(() => Effect.succeed("")),
    );
    if (originHead.startsWith(`${DEFAULT_TARGET_REMOTE}/`)) {
      return originHead.slice(DEFAULT_TARGET_REMOTE.length + 1);
    }
    return DEFAULT_TARGET_BRANCH;
  });
}

function branchHasPublishableCommit(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  worktreePath: string,
  baseBranch: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<boolean, unknown> {
  return countCommitsAhead(
    spawner,
    worktreePath,
    `${DEFAULT_TARGET_REMOTE}/${baseBranch}`,
    onLifecycle,
  ).pipe(
    Effect.catch(() => countCommitsAhead(spawner, worktreePath, baseBranch, onLifecycle)),
    Effect.map((count) => count > 0),
  );
}

function countCommitsAhead(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  worktreePath: string,
  baseRef: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<number, unknown> {
  return runGitOutput(
    spawner,
    worktreePath,
    ["rev-list", "--count", `${baseRef}..HEAD`],
    onLifecycle,
  ).pipe(
    Effect.map((output) => Number.parseInt(output.trim(), 10)),
    Effect.flatMap((count) =>
      Number.isFinite(count)
        ? Effect.succeed(count)
        : Effect.fail(new Error(`Unable to count commits ahead of ${baseRef}`)),
    ),
  );
}

function requireCommit(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  ref: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<void, unknown> {
  return runGitResult(
    spawner,
    repoPath,
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    onLifecycle,
  ).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) => {
      if (exitCode === 0) {
        return Effect.void;
      }
      return Effect.fail(new Error(stderr || stdout || `Unable to resolve target base ${ref}`));
    }),
  );
}

function rebaseExistingWorktree(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  worktreePath: string,
  baseRef: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<void, CommandSpawnError> {
  return Effect.gen(function* () {
    const statusOutput = yield* runGitOutput(
      spawner,
      worktreePath,
      ["status", "--porcelain=v1", "--untracked-files=all"],
      onLifecycle,
    );
    if (statusOutput.trim() !== "") {
      onLifecycle?.({
        phase: "git:rebase-skip",
        message: "Skipping rebase because managed worktree has uncommitted changes.",
        cwd: worktreePath,
        argv: ["git", "rebase", baseRef],
      });
      return;
    }
    yield* runGitOutput(spawner, worktreePath, ["rebase", baseRef], onLifecycle).pipe(
      Effect.asVoid,
    );
  }).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
}

function assertExistingWorktree(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  repoPath: string,
  worktreePath: string,
  branchName: string,
  onLifecycle?: (event: GitLifecycleEvent) => void,
): Effect.Effect<void, CommandSpawnError> {
  return Effect.gen(function* () {
    const isWorktree = yield* runGitOutput(
      spawner,
      worktreePath,
      ["rev-parse", "--is-inside-work-tree"],
      onLifecycle,
    ).pipe(
      Effect.map((output) => output.trim() === "true"),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!isWorktree) {
      return yield* worktreeError(
        repoPath,
        `Expected worktree path exists but is not a Git worktree: ${worktreePath}`,
      );
    }

    const checkedOutBranch = yield* runGitOutput(
      spawner,
      worktreePath,
      ["branch", "--show-current"],
      onLifecycle,
    ).pipe(Effect.mapError((cause) => new CommandSpawnError({ repoPath, cause })));
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

function parseGitHubRemoteUrl(remoteUrl: string): string | null {
  const value = remoteUrl.trim().replace(/\.git$/, "");
  const httpsMatch = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/.exec(value);
  if (httpsMatch !== null) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/.exec(value);
  if (sshMatch !== null) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }

  const sshUrlMatch = /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+)$/.exec(value);
  if (sshUrlMatch !== null) {
    return `https://github.com/${sshUrlMatch[1]}/${sshUrlMatch[2]}`;
  }

  return null;
}

function encodeCompareRef(ref: string): string {
  return encodeURIComponent(ref).replaceAll("%2F", "/");
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

function formatArgv(argv: readonly string[]): string {
  return argv.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
