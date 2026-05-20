import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect } from "vitest";
import type { ClawpatchCommandRequest, CommandResult } from "../../src/shared/types";
import {
  ClawpatchRunner,
  type ClawpatchRunnerShape,
} from "../../src/main/services/clawpatchRunner";
import { ClawpatchStateServiceLive } from "../../src/main/services/clawpatchState";
import {
  GitService,
  GitServiceLive,
  type GitServiceShape,
} from "../../src/main/services/gitService";
import { UiMetadataServiceLive } from "../../src/main/services/uiMetadata";
import { RepoService, RepoServiceLive } from "../../src/main/services/repoService";

const fixtureRepo = resolve("test/fixtures/clawpatch-repo");
const tempDirs: string[] = [];

describe("RepoService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it.effect("validates repo paths", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const emptyPathError = yield* service.addRepo("").pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => null,
        }),
      );
      const missingPathError = yield* service.addRepo(join(fixtureRepo, "missing")).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => null,
        }),
      );
      const validSummary = yield* service.addRepo(fixtureRepo);

      expect(emptyPathError).toMatchObject({ message: "Repo path is required" });
      expect(missingPathError).toMatchObject({ message: "Repo path does not exist" });
      expect(validSummary.path).toBe(fixtureRepo);
      expect(calls).toContainEqual({ repoPath: fixtureRepo, request: { command: "status" } });
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it.effect("expands shell-style home paths before validation", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const originalHome = process.env["HOME"];
      const homeDir = yield* Effect.promise(() => makeTempDir());
      const repoDir = join(homeDir, "src", "serova", "auth");
      yield* Effect.promise(() => mkdir(repoDir, { recursive: true }));
      process.env["HOME"] = homeDir;

      try {
        const service = yield* RepoService;
        const summary = yield* service.addRepo("~/src/serova/auth");
        expect(summary.path).toBe(repoDir);
      } finally {
        if (originalHome === undefined) {
          delete process.env["HOME"];
        } else {
          process.env["HOME"] = originalHome;
        }
      }
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it.effect("adds repos only after CLI status validation and reads findings", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const findings = yield* service.listFindings(summary.id);

      expect(summary.isValid).toBe(true);
      expect(summary.findingCount).toBe(1);
      expect(findings[0].findingId).toBe("fnd-1");
      expect(calls).toContainEqual({ repoPath: fixtureRepo, request: { command: "status" } });
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it("preserves concurrent repo additions", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const repoDirs = await Promise.all([
      makeTempDir(),
      makeTempDir(),
      makeTempDir(),
      makeTempDir(),
      makeTempDir(),
    ]);
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          yield* Effect.all(
            repoDirs.map((repoDir) => service.addRepo(repoDir)),
            {
              concurrency: "unbounded",
            },
          );
        }),
      );

      const repos = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listRepos();
        }),
      );

      expect(repos.map((repo) => repo.path).toSorted()).toEqual(repoDirs.toSorted());
    } finally {
      await runtime.dispose();
    }
  });

  it("skips background status validation while a command is running", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    await writeFile(
      join(appData, "repos.json"),
      JSON.stringify({
        repos: [
          {
            id: "repo-fixture",
            name: "clawpatch-repo",
            path: fixtureRepo,
            updatedAt: "2026-05-19T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(fixtureRepo, calls, appData, true),
    );

    try {
      const repos = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listRepos();
        }),
      );

      expect(repos[0]).toMatchObject({
        id: "repo-fixture",
        isValid: true,
        lastError: null,
        findingCount: 1,
      });
      expect(calls).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it.effect("reads feature map coverage through repo service", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const snapshot = yield* service.readFeatureMap(summary.id);

      expect(snapshot.features.map((feature) => feature.featureId)).toEqual(["feat-1"]);
      expect(snapshot.coverage.totalFeatures).toBe(1);
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it.effect("uses clawpatch triage for status changes", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      yield* service.setTriage(summary.id, "fnd-1", "uncertain", "needs product call");

      expect(calls.at(-1)).toEqual({
        repoPath: fixtureRepo,
        request: {
          command: "triage",
          findingId: "fnd-1",
          status: "uncertain",
          note: "needs product call",
        },
      });
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it.effect("runs fixes in a managed worktree and reads follow-up diff there", () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const result = yield* service.runCommand(summary.id, {
        command: "fix",
        findingId: "fnd-1",
        status: "open",
        note: "prefer parser helper",
      });
      const diff = yield* service.readDiff(summary.id, "fnd-1");
      const worktreeCall = gitCalls.find((call) => call.kind === "worktree");

      expect(worktreeCall?.worktreePath).toBe(result.cwd);
      expect(worktreeCall?.worktreePath).toContain(join("worktrees", summary.id, "fnd-1"));
      expect(diff).toBe(`diff:${result.cwd}`);
      expect(gitCalls).toContainEqual({ kind: "clean", repoPath: fixtureRepo });
      expect(worktreeCall).toMatchObject({
        kind: "worktree",
        repoPath: fixtureRepo,
        branchName: "clawpatch/fix/fnd-1",
      });
      expect(result.relatedResults).toMatchObject([
        {
          cwd: result.cwd,
          args: ["revalidate"],
        },
      ]);
      expect(calls.at(-3)).toEqual({
        repoPath: result.cwd,
        request: {
          command: "triage",
          findingId: "fnd-1",
          status: "open",
          note: "prefer parser helper",
        },
      });
      expect(calls.at(-2)).toEqual({
        repoPath: result.cwd,
        request: { command: "fix", findingId: "fnd-1" },
      });
      expect(calls.at(-1)).toEqual({
        repoPath: result.cwd,
        request: { command: "revalidate", findingId: "fnd-1" },
      });
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(fixtureRepo, calls, undefined, false, makeGitMock(gitCalls)),
      ),
    );
  });

  it.effect("runs manual revalidation in a managed worktree and reads follow-up diff there", () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const result = yield* service.runCommand(summary.id, {
        command: "revalidate",
        findingId: "fnd-1",
      });
      const diff = yield* service.readDiff(summary.id, "fnd-1");
      const worktreeCall = gitCalls.find((call) => call.kind === "worktree");

      expect(worktreeCall?.worktreePath).toBe(result.cwd);
      expect(worktreeCall?.worktreePath).toContain(join("worktrees", summary.id, "fnd-1"));
      expect(diff).toBe(`diff:${result.cwd}`);
      expect(gitCalls).not.toContainEqual({ kind: "clean", repoPath: fixtureRepo });
      expect(worktreeCall).toMatchObject({
        kind: "worktree",
        repoPath: fixtureRepo,
        branchName: "clawpatch/fix/fnd-1",
      });
      expect(calls.at(-1)).toEqual({
        repoPath: result.cwd,
        request: { command: "revalidate", findingId: "fnd-1" },
      });
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(fixtureRepo, calls, undefined, false, makeGitMock(gitCalls)),
      ),
    );
  });

  it("runs fixes for different findings concurrently in separate worktrees", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    const finishFixes = new Map<string, (result: CommandResult) => void>();
    const runnerService: ClawpatchRunnerShape = {
      run: (repoPath, request) =>
        Effect.sync(() => {
          calls.push({ repoPath, request });
          if (request.command !== "fix") {
            return makeCommandResult(repoPath, request.command);
          }
          return null;
        }).pipe(
          Effect.flatMap((result) => {
            if (result !== null) {
              return Effect.succeed(result);
            }
            const findingId = "findingId" in request ? request.findingId : "";
            return Effect.promise(
              () =>
                new Promise<CommandResult>((resolve) => {
                  finishFixes.set(findingId, resolve);
                }),
            );
          }),
        ),
      interrupt: () => Effect.succeed({ interrupted: true }),
      isRunning: () => Effect.succeed(false),
    };
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        undefined,
        false,
        makeGitMock(gitCalls),
        runnerService,
      ),
    );

    try {
      const summary = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.addRepo(fixtureRepo);
        }),
      );
      const first = runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.runCommand(summary.id, { command: "fix", findingId: "fnd-1" });
        }),
      );
      const second = runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.runCommand(summary.id, { command: "fix", findingId: "fnd-2" });
        }),
      );

      await waitUntil(() => finishFixes.size === 2);
      const firstPath = gitCalls.find((call) => call.worktreePath?.endsWith("fnd-1"))?.worktreePath;
      const secondPath = gitCalls.find((call) =>
        call.worktreePath?.endsWith("fnd-2"),
      )?.worktreePath;
      expect(firstPath).toBeDefined();
      expect(secondPath).toBeDefined();
      expect(firstPath).not.toBe(secondPath);

      finishFixes.get("fnd-1")?.(makeCommandResult(firstPath ?? "", "fix"));
      finishFixes.get("fnd-2")?.(makeCommandResult(secondPath ?? "", "fix"));

      await expect(first).resolves.toMatchObject({ cwd: firstPath });
      await expect(second).resolves.toMatchObject({ cwd: secondPath });
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects overlapping commands for the same finding worktree", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    let finishFix: ((result: CommandResult) => void) | undefined;
    const runnerService: ClawpatchRunnerShape = {
      run: (repoPath, request) =>
        Effect.sync(() => {
          calls.push({ repoPath, request });
          if (request.command !== "fix") {
            return makeCommandResult(repoPath, request.command);
          }
          return null;
        }).pipe(
          Effect.flatMap((result) => {
            if (result !== null) {
              return Effect.succeed(result);
            }
            return Effect.promise(
              () =>
                new Promise<CommandResult>((resolve) => {
                  finishFix = resolve;
                }),
            );
          }),
        ),
      interrupt: () => Effect.succeed({ interrupted: true }),
      isRunning: () => Effect.succeed(false),
    };
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        undefined,
        false,
        makeGitMock(gitCalls),
        runnerService,
      ),
    );

    try {
      const summary = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.addRepo(fixtureRepo);
        }),
      );
      const first = runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.runCommand(summary.id, { command: "fix", findingId: "fnd-1" });
        }),
      );

      await waitUntil(() => calls.some((call) => call.request.command === "fix"));
      await expect(
        runtime.runPromise(
          Effect.gen(function* () {
            const service = yield* RepoService;
            return yield* service.runCommand(summary.id, {
              command: "revalidate",
              findingId: "fnd-1",
            });
          }),
        ),
      ).rejects.toThrow("A Clawpatch command is already running for this repo");

      if (finishFix === undefined) {
        throw new Error("fix command did not start");
      }
      const worktreePath = gitCalls.find((call) => call.kind === "worktree")?.worktreePath;
      finishFix(makeCommandResult(worktreePath ?? "", "fix"));
      await expect(first).resolves.toMatchObject({ cwd: worktreePath });
    } finally {
      await runtime.dispose();
    }
  });

  it("interrupts a fix running in its managed worktree", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    let interruptPath: string | null = null;
    let finishFix: ((result: CommandResult) => void) | undefined;
    const runnerService: ClawpatchRunnerShape = {
      run: (repoPath, request) =>
        Effect.sync(() => {
          calls.push({ repoPath, request });
          if (request.command !== "fix") {
            return makeCommandResult(repoPath, request.command);
          }
          return null;
        }).pipe(
          Effect.flatMap((result) => {
            if (result !== null) {
              return Effect.succeed(result);
            }
            return Effect.promise(
              () =>
                new Promise<CommandResult>((resolve) => {
                  finishFix = resolve;
                }),
            );
          }),
        ),
      interrupt: (repoPath) =>
        Effect.sync(() => {
          interruptPath = repoPath;
          return { interrupted: true };
        }),
      isRunning: () => Effect.succeed(false),
    };
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        undefined,
        false,
        makeGitMock(gitCalls),
        runnerService,
      ),
    );

    try {
      const summary = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.addRepo(fixtureRepo);
        }),
      );
      const run = runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.runCommand(summary.id, { command: "fix", findingId: "fnd-1" });
        }),
      );

      await waitUntil(() => calls.some((call) => call.request.command === "fix"));
      const interrupt = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.interruptCommand(summary.id, "fnd-1");
        }),
      );
      const worktreePath = gitCalls.find((call) => call.kind === "worktree")?.worktreePath;

      expect(interrupt).toEqual({ interrupted: true });
      expect(interruptPath).toBe(worktreePath);

      if (finishFix === undefined) {
        throw new Error("fix command did not start");
      }
      finishFix(makeCommandResult(worktreePath ?? "", "fix"));
      await expect(run).resolves.toMatchObject({
        cwd: worktreePath,
        relatedResults: [{ cwd: worktreePath, args: ["revalidate"] }],
      });
    } finally {
      await runtime.dispose();
    }
  });

  it.effect("interrupts commands by repo id", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const result = yield* service.interruptCommand(summary.id);

      expect(result).toEqual({ interrupted: true });
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it("falls back to an empty registry when repos.json is malformed", async () => {
    const appData = await makeTempDir();
    await writeFile(join(appData, "repos.json"), "{not-json", "utf8");
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, [], appData));
    try {
      const repos = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listRepos();
        }),
      );

      expect(repos).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("reads UI metadata from app data by repo id when refreshing", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    await mkdir(join(appData, "ui-metadata"), { recursive: true });
    await writeFile(
      join(appData, "repos.json"),
      JSON.stringify({
        repos: [
          {
            id: "repo-fixture",
            name: "clawpatch-repo",
            path: fixtureRepo,
            updatedAt: "2026-05-19T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(appData, "ui-metadata", "repo-fixture.json"),
      JSON.stringify({
        schemaVersion: 1,
        filters: {
          severity: "high",
          status: "open",
          search: "auth",
        },
        lastSelectedFindingId: "fnd-1",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
      "utf8",
    );
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));
    try {
      const snapshot = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.refreshRepo("repo-fixture");
        }),
      );

      expect(snapshot.metadata).toMatchObject({
        filters: { severity: "high", status: "open", search: "auth" },
        lastSelectedFindingId: "fnd-1",
      });
    } finally {
      await runtime.dispose();
    }
  });
});

interface RunnerCall {
  readonly repoPath: string;
  readonly request: ClawpatchCommandRequest;
}

function makeRepoServiceTestLayer(
  cwd: string,
  calls: RunnerCall[],
  appData?: string,
  isRunning = false,
  gitService?: GitServiceShape,
  runnerService?: ClawpatchRunnerShape,
) {
  const appDataEffect =
    appData === undefined ? Effect.promise(() => makeTempDir()) : Effect.succeed(appData);
  return Layer.unwrap(
    Effect.gen(function* () {
      const appData = yield* appDataEffect;
      const runnerLayer = Layer.succeed(
        ClawpatchRunner,
        ClawpatchRunner.of(
          runnerService ?? {
            run: (repoPath, request) =>
              Effect.sync((): CommandResult => {
                calls.push({ repoPath, request });
                return {
                  runId: "run-test",
                  command: "clawpatch",
                  args: [request.command],
                  cwd: repoPath,
                  exitCode: 0,
                  durationMs: 1,
                  stdout: "{}",
                  stderr: "",
                  parsedJson: {},
                };
              }),
            interrupt: () => Effect.succeed({ interrupted: true }),
            isRunning: () => Effect.succeed(isRunning),
          },
        ),
      );
      return RepoServiceLive(appData).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            runnerLayer,
            ClawpatchStateServiceLive,
            UiMetadataServiceLive(appData),
            gitService === undefined
              ? GitServiceLive
              : Layer.succeed(GitService, GitService.of(gitService)),
          ),
        ),
        Layer.provide(NodeServices.layer),
      );
    }),
  );
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-ui-"));
  tempDirs.push(dir);
  return dir;
}

async function waitUntil(assertion: () => boolean): Promise<void> {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started > 1000) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function makeCommandResult(cwd: string, command: string): CommandResult {
  return {
    runId: "run-test",
    command: "clawpatch",
    args: [command],
    cwd,
    exitCode: 0,
    durationMs: 1,
    stdout: "{}",
    stderr: "",
    parsedJson: {},
  };
}

function makeGitMock(
  calls: Array<{ kind: string; repoPath: string; worktreePath?: string; branchName?: string }>,
): GitServiceShape {
  return {
    readDiff: (repoPath) => Effect.succeed(`diff:${repoPath}`),
    readStatus: () => Effect.succeed({ staged: 0, modified: 0, untracked: 0, branch: "main" }),
    requireCleanCheckout: (repoPath) =>
      Effect.sync(() => {
        calls.push({ kind: "clean", repoPath });
      }),
    createOrReuseWorktree: ({ repoPath, worktreePath, branchName }) =>
      Effect.sync(() => {
        calls.push({ kind: "worktree", repoPath, worktreePath, branchName });
        return worktreePath;
      }),
  };
}
