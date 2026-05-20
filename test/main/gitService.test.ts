import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { GitService, GitServiceLive } from "../../src/main/services/gitService";

const encoder = new TextEncoder();
const execFileAsync = promisify(execFile);

describe("GitService", () => {
  it("reads diffs through the Effect child process spawner", async () => {
    const commands: Array<{
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd: string | undefined;
    }> = [];
    const spawnerLayer = Layer.succeed(
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
    );
    const layer = GitServiceLive.pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
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

  it("parses porcelain status into staged, modified, untracked counts and branch", async () => {
    const porcelain = [
      "## main...origin/main",
      "M  src/staged.ts",
      " M src/modified.ts",
      "MM src/staged-and-modified.ts",
      "?? src/new-file.ts",
      "?? src/another-new.ts",
      "",
    ].join("\n");

    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.succeed(mockHandle({ stdout: porcelain }))),
    );
    const layer = GitServiceLive.pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
    );

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.readStatus("/tmp/repo-status");
      }).pipe(Effect.provide(layer)),
    );

    expect(status).toEqual({
      staged: 2,
      modified: 2,
      untracked: 2,
      branch: "main",
    });
  });

  it("kills an active git child process when the effect is interrupted", async () => {
    let killCount = 0;
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() =>
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
      ),
    );
    const layer = GitServiceLive.pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)),
    );
    const abortController = new AbortController();

    const readDiff = Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.readDiff("/tmp/repo-a");
      }).pipe(Effect.provide(layer)),
      { signal: abortController.signal },
    ).catch(() => undefined);

    await Promise.resolve();
    abortController.abort();
    await readDiff;

    expect(killCount).toBe(1);
  });

  it("requires a clean checkout before worktree fixes", async () => {
    const repoPath = await makeGitRepo();
    const layer = GitServiceLive.pipe(Layer.provide(NodeServices.layer));

    await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        yield* git.requireCleanCheckout(repoPath);
      }).pipe(Effect.provide(layer)),
    );

    await writeFile(join(repoPath, "dirty.txt"), "dirty\n", "utf8");

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitService;
          yield* git.requireCleanCheckout(repoPath);
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Registered checkout must be clean");
  });

  it("creates and reuses managed worktrees", async () => {
    const repoPath = await makeGitRepo();
    const worktreePath = join(await mkdtemp(join(tmpdir(), "clawpatch-worktrees-")), "fnd-1");
    const layer = GitServiceLive.pipe(Layer.provide(NodeServices.layer));

    await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        const created = yield* git.createOrReuseWorktree({
          repoPath,
          worktreePath,
          branchName: "clawpatch/fix/fnd-1",
          baseRef: "origin/main",
        });
        const reused = yield* git.createOrReuseWorktree({
          repoPath,
          worktreePath,
          branchName: "clawpatch/fix/fnd-1",
          baseRef: "origin/main",
        });
        expect(created).toBe(worktreePath);
        expect(reused).toBe(worktreePath);
      }).pipe(Effect.provide(layer)),
    );

    await expect(
      git(repoPath, ["rev-parse", "--verify", "clawpatch/fix/fnd-1"]),
    ).resolves.toBeTruthy();
    await expect(git(worktreePath, ["branch", "--show-current"])).resolves.toBe(
      "clawpatch/fix/fnd-1",
    );
  });

  it("creates managed worktrees from origin/main instead of the current checkout", async () => {
    const repoPath = await makeGitRepo();
    await addOriginRemote(repoPath);
    await git(repoPath, ["checkout", "-b", "feature"]);
    await writeFile(join(repoPath, "feature.txt"), "feature\n", "utf8");
    await git(repoPath, ["add", "feature.txt"]);
    await git(repoPath, ["commit", "-m", "feature"]);
    const worktreePath = join(await mkdtemp(join(tmpdir(), "clawpatch-worktrees-")), "fnd-1");
    const layer = GitServiceLive.pipe(Layer.provide(NodeServices.layer));

    await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        return yield* git.createOrReuseWorktree({
          repoPath,
          worktreePath,
          branchName: "clawpatch/fix/fnd-1",
          baseRef: "origin/main",
        });
      }).pipe(Effect.provide(layer)),
    );

    await expect(git(worktreePath, ["rev-parse", "HEAD"])).resolves.toBe(
      await git(repoPath, ["rev-parse", "origin/main"]),
    );
  });

  it("rebases existing managed worktrees onto latest origin/main before reuse", async () => {
    const repoPath = await makeGitRepo();
    await addOriginRemote(repoPath);
    const worktreePath = join(await mkdtemp(join(tmpdir(), "clawpatch-worktrees-")), "fnd-1");
    const layer = GitServiceLive.pipe(Layer.provide(NodeServices.layer));

    await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        yield* git.createOrReuseWorktree({
          repoPath,
          worktreePath,
          branchName: "clawpatch/fix/fnd-1",
          baseRef: "origin/main",
        });
      }).pipe(Effect.provide(layer)),
    );

    await writeFile(join(worktreePath, "README.md"), "candidate fix\n", "utf8");
    await writeFile(join(repoPath, "CHANGELOG.md"), "main moved\n", "utf8");
    await git(repoPath, ["add", "CHANGELOG.md"]);
    await git(repoPath, ["commit", "-m", "move main"]);
    await git(repoPath, ["push", "origin", "main"]);

    await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* GitService;
        yield* git.createOrReuseWorktree({
          repoPath,
          worktreePath,
          branchName: "clawpatch/fix/fnd-1",
          baseRef: "origin/main",
        });
      }).pipe(Effect.provide(layer)),
    );

    await expect(git(worktreePath, ["rev-parse", "HEAD"])).resolves.toBe(
      await git(repoPath, ["rev-parse", "origin/main"]),
    );
    await expect(readFile(join(worktreePath, "CHANGELOG.md"), "utf8")).resolves.toBe(
      "main moved\n",
    );
    await expect(readFile(join(worktreePath, "README.md"), "utf8")).resolves.toBe(
      "candidate fix\n",
    );
  });

  it("rejects existing branches that are not checked out at the managed path", async () => {
    const repoPath = await makeGitRepo();
    await git(repoPath, ["branch", "clawpatch/fix/fnd-1"]);
    const worktreePath = join(await mkdtemp(join(tmpdir(), "clawpatch-worktrees-")), "fnd-1");
    const layer = GitServiceLive.pipe(Layer.provide(NodeServices.layer));

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const gitService = yield* GitService;
          yield* gitService.createOrReuseWorktree({
            repoPath,
            worktreePath,
            branchName: "clawpatch/fix/fnd-1",
            baseRef: "origin/main",
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Fix branch already exists");
  });

  it("commits dirty fix worktrees before pushing and returns a GitHub PR URL", async () => {
    const commands: string[][] = [];
    const layer = makeMockGitLayer((args) => {
      commands.push([...args]);
      const key = args.join("\0");
      if (key === "rev-parse\0--is-inside-work-tree") {
        return "true\n";
      }
      if (key === "branch\0--show-current") {
        return "clawpatch/fix/fnd-1\n";
      }
      if (key === "remote\0get-url\0origin") {
        return "git@github.com:acme/repo.git\n";
      }
      if (key === "status\0--porcelain=v1\0--untracked-files=all") {
        return " M src/file.ts\n";
      }
      if (key === "rev-list\0--count\0origin/main..HEAD") {
        return "1\n";
      }
      if (key === "rev-parse\0HEAD") {
        return "abc123\n";
      }
      return "";
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gitService = yield* GitService;
        return yield* gitService.publishFix({
          repoPath: "/tmp/repo",
          worktreePath: "/tmp/worktree",
          branchName: "clawpatch/fix/fnd-1",
          baseBranch: "main",
          commitMessage: "Fix Null branch can throw",
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(commands).toContainEqual(["add", "-A"]);
    expect(commands).toContainEqual(["commit", "-m", "Fix Null branch can throw"]);
    expect(commands).toContainEqual(["push", "-u", "origin", "clawpatch/fix/fnd-1"]);
    expect(result).toEqual({
      worktreePath: "/tmp/worktree",
      branchName: "clawpatch/fix/fnd-1",
      baseBranch: "main",
      commitSha: "abc123",
      remoteName: "origin",
      prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-1?expand=1",
    });
  });

  it("skips committing clean fix worktrees that already have a commit", async () => {
    const commands: string[][] = [];
    const layer = makeMockGitLayer((args) => {
      commands.push([...args]);
      const key = args.join("\0");
      if (key === "rev-parse\0--is-inside-work-tree") {
        return "true\n";
      }
      if (key === "branch\0--show-current") {
        return "clawpatch/fix/fnd-1\n";
      }
      if (key === "remote\0get-url\0origin") {
        return "https://github.com/acme/repo.git\n";
      }
      if (key === "status\0--porcelain=v1\0--untracked-files=all") {
        return "";
      }
      if (key === "rev-list\0--count\0origin/main..HEAD") {
        return "1\n";
      }
      if (key === "rev-parse\0HEAD") {
        return "abc123\n";
      }
      return "";
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const gitService = yield* GitService;
        return yield* gitService.publishFix({
          repoPath: "/tmp/repo",
          worktreePath: "/tmp/worktree",
          branchName: "clawpatch/fix/fnd-1",
          baseBranch: "main",
          commitMessage: "Fix Null branch can throw",
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(commands).not.toContainEqual(["add", "-A"]);
    expect(commands.some((args) => args[0] === "commit")).toBe(false);
    expect(commands).toContainEqual(["push", "-u", "origin", "clawpatch/fix/fnd-1"]);
  });

  it("rejects clean fix worktrees with no commits to publish", async () => {
    const layer = makeMockGitLayer((args) => {
      const key = args.join("\0");
      if (key === "rev-parse\0--is-inside-work-tree") {
        return "true\n";
      }
      if (key === "branch\0--show-current") {
        return "clawpatch/fix/fnd-1\n";
      }
      if (key === "remote\0get-url\0origin") {
        return "https://github.com/acme/repo.git\n";
      }
      if (key === "status\0--porcelain=v1\0--untracked-files=all") {
        return "";
      }
      if (key === "rev-list\0--count\0origin/main..HEAD") {
        return "0\n";
      }
      return "";
    });

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const gitService = yield* GitService;
          return yield* gitService.publishFix({
            repoPath: "/tmp/repo",
            worktreePath: "/tmp/worktree",
            branchName: "clawpatch/fix/fnd-1",
            baseBranch: "main",
            commitMessage: "Fix Null branch can throw",
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("No fix changes to publish");
  });

  it("rejects publish when the managed worktree is on the wrong branch", async () => {
    const layer = makeMockGitLayer((args) => {
      const key = args.join("\0");
      if (key === "rev-parse\0--is-inside-work-tree") {
        return "true\n";
      }
      if (key === "branch\0--show-current") {
        return "feature/other\n";
      }
      return "";
    });

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const gitService = yield* GitService;
          return yield* gitService.publishFix({
            repoPath: "/tmp/repo",
            worktreePath: "/tmp/worktree",
            branchName: "clawpatch/fix/fnd-1",
            baseBranch: "main",
            commitMessage: "Fix Null branch can throw",
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("expected clawpatch/fix/fnd-1");
  });

  it("rejects non-GitHub origin remotes", async () => {
    const layer = makeMockGitLayer((args) => {
      const key = args.join("\0");
      if (key === "rev-parse\0--is-inside-work-tree") {
        return "true\n";
      }
      if (key === "branch\0--show-current") {
        return "clawpatch/fix/fnd-1\n";
      }
      if (key === "remote\0get-url\0origin") {
        return "https://gitlab.com/acme/repo.git\n";
      }
      return "";
    });

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const gitService = yield* GitService;
          return yield* gitService.publishFix({
            repoPath: "/tmp/repo",
            worktreePath: "/tmp/worktree",
            branchName: "clawpatch/fix/fnd-1",
            baseBranch: "main",
            commitMessage: "Fix Null branch can throw",
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("GitHub origin remotes only");
  });
});

function mockHandle(options: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode>;
  readonly isRunning?: Effect.Effect<boolean>;
  readonly kill?: ChildProcessSpawner.ChildProcessHandle["kill"];
}): ChildProcessSpawner.ChildProcessHandle {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: options.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(options.code ?? 0)),
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

function makeMockGitLayer(
  outputForArgs: (args: readonly string[]) => string,
): Layer.Layer<GitService, never, never> {
  const spawnerLayer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly args: ReadonlyArray<string>;
      };
      return Effect.succeed(mockHandle({ stdout: outputForArgs(childProcess.args) }));
    }),
  );
  return GitServiceLive.pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, spawnerLayer)));
}

async function makeGitRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "clawpatch-git-"));
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
  await writeFile(join(repoPath, "README.md"), "test\n", "utf8");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  return repoPath;
}

async function addOriginRemote(repoPath: string): Promise<string> {
  const remotePath = await mkdtemp(join(tmpdir(), "clawpatch-origin-"));
  await git(remotePath, ["init", "--bare", "-b", "main"]);
  await git(repoPath, ["remote", "add", "origin", remotePath]);
  await git(repoPath, ["push", "-u", "origin", "main"]);
  return remotePath;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd });
  return result.stdout.trim();
}
