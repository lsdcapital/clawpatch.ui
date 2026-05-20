import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
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
        });
        const reused = yield* git.createOrReuseWorktree({
          repoPath,
          worktreePath,
          branchName: "clawpatch/fix/fnd-1",
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
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Fix branch already exists");
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

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd });
  return result.stdout.trim();
}
