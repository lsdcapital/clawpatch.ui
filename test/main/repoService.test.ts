import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect } from "vitest";
import type {
  ClawpatchCommandRequest,
  CommandResult,
  CommandStreamEvent,
  GitStatusSummary,
} from "../../src/shared/types";
import { CommandSpawnError } from "../../src/main/errors";
import {
  ClawpatchRunner,
  type ClawpatchRunnerShape,
} from "../../src/main/services/clawpatchRunner";
import { ClawpatchConfigServiceLive } from "../../src/main/services/clawpatchConfig";
import { ClawpatchStateServiceLive } from "../../src/main/services/clawpatchState";
import {
  GitService,
  GitServiceLive,
  type GitServiceShape,
} from "../../src/main/services/gitService";
import {
  TerminalLauncher,
  type TerminalLauncherShape,
} from "../../src/main/services/terminalLauncher";
import { UiMetadataServiceLive } from "../../src/main/services/uiMetadata";
import { AppSettingsServiceLive } from "../../src/main/services/appSettings";
import { RepoSettingsServiceLive } from "../../src/main/services/repoSettings";
import {
  SetupScriptRunner,
  type SetupScriptRunnerShape,
} from "../../src/main/services/setupScriptRunner";
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

  it.effect("does not fail commands when stream publishing throws", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;
      const summary = yield* service.addRepo(fixtureRepo);

      const result = yield* service.runCommand(summary.id, { command: "map" }, () => {
        throw new Error("renderer send failed");
      });

      expect(result).toMatchObject({
        exitCode: 0,
        args: ["map"],
        cwd: fixtureRepo,
      });
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it.effect("summarizes repo updates from latest finding activity", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const repoDir = yield* Effect.promise(() => makeTempDir());
      yield* Effect.promise(() =>
        writeFinding(repoDir, {
          findingId: "fnd-old",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      yield* Effect.promise(() =>
        writeFinding(repoDir, {
          findingId: "fnd-new",
          updatedAt: "2026-03-01T00:00:00.000Z",
        }),
      );

      const service = yield* RepoService;
      const summary = yield* service.addRepo(repoDir);

      expect(summary.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it("falls back to the registry timestamp when a repo has no findings", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const repoDir = await makeTempDir();
    await mkdir(join(repoDir, ".clawpatch", "findings"), { recursive: true });
    await writeRepoRegistry(appData, "repo-empty", repoDir);
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      const repos = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listRepos();
        }),
      );

      expect(repos[0]?.updatedAt).toBe("2026-05-19T00:00:00.000Z");
    } finally {
      await runtime.dispose();
    }
  });

  it.effect("runs Doctor diagnostics for a registered repo", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const missingRepoError = yield* service.doctor("missing").pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => null,
        }),
      );
      const summary = yield* service.addRepo(fixtureRepo);
      const result = yield* service.doctor(summary.id);

      expect(missingRepoError).toMatchObject({ repoId: "missing" });
      expect(result.args).toEqual(["doctor"]);
      expect(calls).toContainEqual({ repoPath: fixtureRepo, request: { command: "doctor" } });
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it.effect("opens a terminal at the registered checkout by default", () => {
    const calls: RunnerCall[] = [];
    const terminalCwds: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const result = yield* service.openTerminal(summary.id);

      expect(result).toEqual({ cwd: fixtureRepo });
      expect(terminalCwds).toEqual([fixtureRepo]);
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(
          fixtureRepo,
          calls,
          undefined,
          false,
          undefined,
          undefined,
          makeTerminalMock(terminalCwds),
        ),
      ),
    );
  });

  it("opens a terminal with configured app settings and repo startup script", async () => {
    const calls: RunnerCall[] = [];
    const terminalCalls: Array<{
      readonly cwd: string;
      readonly appName: string | undefined;
      readonly startupScript: string | undefined;
    }> = [];
    const appData = await makeTempDir();
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(fixtureRepo, calls, appData, false, undefined, undefined, {
        open: (cwd, options) =>
          Effect.sync(() => {
            terminalCalls.push({
              cwd,
              appName: options?.appName,
              startupScript: options?.startupScript,
            });
            return { cwd };
          }),
      }),
    );

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const summary = yield* service.addRepo(fixtureRepo);
          yield* service.updateAppSettings({
            schemaVersion: 1,
            terminalAppName: "iTerm",
            terminalAppPath: "/Applications/iTerm.app",
            updatedAt: "2026-05-19T00:00:00.000Z",
          });
          yield* service.updateSettings(summary.id, {
            schemaVersion: 1,
            terminalStartupScript: "pnpm dev",
            worktreeSetupScript: "",
            updatedAt: "2026-05-19T00:00:00.000Z",
          });
          yield* service.openTerminal(summary.id);
        }),
      );

      expect(terminalCalls).toEqual([
        { cwd: fixtureRepo, appName: "/Applications/iTerm.app", startupScript: "pnpm dev" },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("falls back to default repo settings when the settings file is invalid", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      const settings = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const summary = yield* service.addRepo(fixtureRepo);
          yield* Effect.promise(() => mkdir(join(appData, "repo-settings"), { recursive: true }));
          yield* Effect.promise(() =>
            writeFile(join(appData, "repo-settings", `${summary.id}.json`), "{not-json", "utf8"),
          );
          return yield* service.getSettings(summary.id);
        }),
      );

      expect(settings).toMatchObject({
        terminalStartupScript: "",
        worktreeSetupScript: "",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("falls back to default app settings when the settings file is invalid", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      const settings = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          yield* Effect.promise(() => writeFile(join(appData, "app-settings.json"), "{not-json"));
          return yield* service.getAppSettings();
        }),
      );

      expect(settings).toMatchObject({
        terminalAppName: "Terminal",
        terminalAppPath: null,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("normalizes blank app terminal names", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      const settings = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.updateAppSettings({
            schemaVersion: 1,
            terminalAppName: "   ",
            terminalAppPath: "   ",
            updatedAt: "2026-05-19T00:00:00.000Z",
          });
        }),
      );

      expect(settings.terminalAppName).toBe("Terminal");
      expect(settings.terminalAppPath).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });

  it("reads existing repo settings files that include legacy terminal app names", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      const settings = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const summary = yield* service.addRepo(fixtureRepo);
          yield* Effect.promise(() => mkdir(join(appData, "repo-settings"), { recursive: true }));
          yield* Effect.promise(() =>
            writeFile(
              join(appData, "repo-settings", `${summary.id}.json`),
              JSON.stringify({
                schemaVersion: 1,
                terminalAppName: "iTerm",
                terminalStartupScript: "pnpm dev",
                worktreeSetupScript: "pnpm install",
                updatedAt: "2026-05-19T00:00:00.000Z",
              }),
              "utf8",
            ),
          );
          return yield* service.getSettings(summary.id);
        }),
      );

      expect(settings).toEqual({
        schemaVersion: 1,
        terminalStartupScript: "pnpm dev",
        worktreeSetupScript: "pnpm install",
        updatedAt: "2026-05-19T00:00:00.000Z",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("updates shared Clawpatch config and gitignore policy without dropping existing fields", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const repoDir = await makeTempDir();
    const configPath = join(repoDir, ".clawpatch", "config.json");
    const gitignorePath = join(repoDir, ".gitignore");
    await mkdir(join(repoDir, ".clawpatch"), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        include: ["src/**"],
        stateTracking: "team",
        git: { commit: false },
      }),
      "utf8",
    );
    await writeFile(gitignorePath, "node_modules/\n\n.DS_Store\n", "utf8");
    await writeRepoRegistry(appData, "repo-config", repoDir);
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      const updated = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const initial = yield* service.getConfig("repo-config");
          expect(initial).toEqual({ schemaVersion: 1, stateTracking: "team" });
          return yield* service.updateConfig("repo-config", {
            schemaVersion: 1,
            stateTracking: "audit",
          });
        }),
      );

      const persisted = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
      const gitignore = await readFile(gitignorePath, "utf8");
      expect(updated).toEqual({ schemaVersion: 1, stateTracking: "audit" });
      expect(persisted).toMatchObject({
        schemaVersion: 1,
        include: ["src/**"],
        stateTracking: "audit",
        git: { commit: false },
      });
      expect(gitignore).toContain("node_modules/");
      expect(gitignore).toContain(".DS_Store");
      expect(gitignore).toContain("# BEGIN Clawpatch state tracking");
      expect(gitignore).toContain(".clawpatch/*");
      expect(gitignore).toContain("!.clawpatch/config.json");
      expect(gitignore).toContain("!.clawpatch/features/**");
      expect(gitignore).toContain("!.clawpatch/findings/**");
      expect(gitignore).toContain("!.clawpatch/reports/**");
      expect(gitignore).toContain("!.clawpatch/patches/**");
    } finally {
      await runtime.dispose();
    }
  });

  it("replaces previous Clawpatch gitignore policy when state tracking changes", async () => {
    const calls: RunnerCall[] = [];
    const appData = await makeTempDir();
    const repoDir = await makeTempDir();
    const gitignorePath = join(repoDir, ".gitignore");
    await writeFile(
      gitignorePath,
      [
        "dist/",
        "",
        "# BEGIN Clawpatch state tracking",
        ".clawpatch/*",
        "!.clawpatch/",
        "!.clawpatch/config.json",
        "!.clawpatch/features/",
        "!.clawpatch/features/**",
        "!.clawpatch/findings/",
        "!.clawpatch/findings/**",
        "# END Clawpatch state tracking",
        "",
        "coverage/",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeRepoRegistry(appData, "repo-config", repoDir);
    const runtime = ManagedRuntime.make(makeRepoServiceTestLayer(fixtureRepo, calls, appData));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          yield* service.updateConfig("repo-config", {
            schemaVersion: 1,
            stateTracking: "local",
          });
        }),
      );

      const gitignore = await readFile(gitignorePath, "utf8");
      expect(gitignore).toContain("dist/");
      expect(gitignore).toContain("coverage/");
      expect(gitignore.match(/BEGIN Clawpatch state tracking/g)).toHaveLength(1);
      expect(gitignore).toContain("!.clawpatch/config.json");
      expect(gitignore).not.toContain("!.clawpatch/features/**");
      expect(gitignore).not.toContain("!.clawpatch/findings/**");
    } finally {
      await runtime.dispose();
    }
  });

  it("opens a terminal at an active finding worktree when present", async () => {
    const calls: RunnerCall[] = [];
    const terminalCwds: string[] = [];
    const appData = await makeTempDir();
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        appData,
        false,
        undefined,
        undefined,
        makeTerminalMock(terminalCwds),
      ),
    );

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const summary = yield* service.addRepo(fixtureRepo);
          const worktreePath = join(appData, "worktrees", summary.id, "fnd-1");
          yield* Effect.promise(() => writeFinding(worktreePath, { findingId: "fnd-1" }));

          const result = yield* service.openTerminal(summary.id, "fnd-1");

          expect(result).toEqual({ cwd: worktreePath });
          expect(terminalCwds).toEqual([worktreePath]);
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });

  it.effect("fails terminal opens for unknown repos", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const error = yield* service.openTerminal("missing-repo").pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => null,
        }),
      );

      expect(error).toMatchObject({ message: "Repo not found: missing-repo" });
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

  it.effect("rejects failed clawpatch triage results with command output", () => {
    const calls: RunnerCall[] = [];
    const runnerService: ClawpatchRunnerShape = {
      run: (repoPath, request) =>
        Effect.sync(() => {
          calls.push({ repoPath, request });
          return {
            ...makeCommandResult(repoPath, request.command),
            exitCode: 1,
            stdout: '{"error":"not saved"}',
            stderr: "triage failed",
          };
        }),
      interrupt: () => Effect.succeed({ interrupted: true }),
      interruptAll: () => Effect.succeed(0),
      isRunning: () => Effect.succeed(false),
    };

    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const error = yield* service.setTriage(summary.id, "fnd-1", "wont-fix", "").pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => null,
        }),
      );

      expect(error).toMatchObject({
        message:
          'clawpatch triage failed with exit 1\nstderr: triage failed\nstdout: {"error":"not saved"}',
      });
      expect(calls.at(-1)?.request).toMatchObject({
        command: "triage",
        findingId: "fnd-1",
        status: "wont-fix",
      });
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(fixtureRepo, calls, undefined, false, undefined, runnerService),
      ),
    );
  });

  it.effect("runs fixes in a managed worktree and reads follow-up diff there", () => {
    const calls: RunnerCall[] = [];
    const events: CommandStreamEvent[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseRef?: string;
    }> = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const result = yield* service.runCommand(
        summary.id,
        {
          command: "fix",
          findingId: "fnd-1",
          status: "open",
          note: "prefer parser helper",
        },
        (event) => events.push(event),
      );
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
        baseRef: "origin/main",
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
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "lifecycle", phase: "fix:clean-check" }),
          expect.objectContaining({ kind: "lifecycle", phase: "git:start" }),
          expect.objectContaining({ kind: "lifecycle", phase: "fix:worktree-ready" }),
          expect.objectContaining({
            kind: "lifecycle",
            phase: "clawpatch:start",
            command: "fix",
            cwd: result.cwd,
          }),
          expect.objectContaining({ kind: "lifecycle", phase: "fix:revalidate-start" }),
        ]),
      );
      expect(phaseIndex(events, "fix:clean-check")).toBeLessThan(phaseIndex(events, "git:start"));
      expect(phaseIndex(events, "fix:worktree-ready")).toBeLessThan(
        phaseIndex(events, "clawpatch:start", "fix"),
      );
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(fixtureRepo, calls, undefined, false, makeGitMock(gitCalls)),
      ),
    );
  });

  it.effect("prunes cached managed worktrees after their branch is applied to origin/main", () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseRef?: string;
    }> = [];
    let branchApplied = false;
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const result = yield* service.runCommand(summary.id, {
        command: "fix",
        findingId: "fnd-1",
      });
      expect(yield* service.readDiff(summary.id, "fnd-1")).toBe(`diff:${result.cwd}`);

      branchApplied = true;
      const repos = yield* service.listRepos();
      const diff = yield* service.readDiff(summary.id, "fnd-1");

      expect(repos[0]).toMatchObject({
        activeWorktreePath: null,
        activeWorktrees: [],
      });
      expect(diff).toBe(`diff:${fixtureRepo}`);
      expect(gitCalls).toContainEqual({
        kind: "applied",
        repoPath: fixtureRepo,
        branchName: "clawpatch/fix/fnd-1",
        baseRef: "origin/main",
      });
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(
          fixtureRepo,
          calls,
          undefined,
          false,
          makeGitMock(gitCalls, {
            readStatus: (repoPath) =>
              Effect.succeed({
                staged: 0,
                modified: 0,
                untracked: 0,
                branch: repoPath === fixtureRepo ? "main" : "clawpatch/fix/fnd-1",
              }),
            isBranchAppliedToBase: () => Effect.succeed(branchApplied),
          }),
        ),
      ),
    );
  });

  it("runs configured setup scripts once after creating a managed worktree", async () => {
    const calls: RunnerCall[] = [];
    const setupCalls: Array<{ readonly cwd: string; readonly script: string }> = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseRef?: string;
    }> = [];
    const appData = await makeTempDir();
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        appData,
        false,
        makeGitMock(gitCalls),
        undefined,
        undefined,
        {
          run: (cwd, script, metadata, onStream) =>
            Effect.sync(() => {
              setupCalls.push({ cwd, script });
              onStream?.({
                kind: "lifecycle",
                runId: metadata.runId ?? "setup",
                repoId: metadata.repoId,
                findingId: metadata.findingId,
                command: metadata.command,
                phase: "setup:start",
                message: "$ /bin/zsh -lc <worktree setup script>",
                cwd,
              });
              return makeCommandResult(cwd, "setup");
            }),
        },
      ),
    );

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const summary = yield* service.addRepo(fixtureRepo);
          yield* service.updateSettings(summary.id, {
            schemaVersion: 1,
            terminalStartupScript: "",
            worktreeSetupScript: "pnpm install",
            updatedAt: "2026-05-19T00:00:00.000Z",
          });
          yield* service.runCommand(summary.id, { command: "fix", findingId: "fnd-1" });
        }),
      );

      const worktreePath = gitCalls.find((call) => call.kind === "worktree")?.worktreePath;
      expect(setupCalls).toEqual([{ cwd: worktreePath ?? "", script: "pnpm install" }]);
      expect(calls.at(-2)).toMatchObject({
        repoPath: worktreePath,
        request: { command: "fix", findingId: "fnd-1" },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it.effect("skips setup scripts when a managed worktree is reused", () => {
    const calls: RunnerCall[] = [];
    const setupCalls: string[] = [];
    const gitService = makeGitMock([]);
    return Effect.gen(function* () {
      const service = yield* RepoService;
      const summary = yield* service.addRepo(fixtureRepo);
      yield* service.updateSettings(summary.id, {
        schemaVersion: 1,
        terminalStartupScript: "",
        worktreeSetupScript: "pnpm install",
        updatedAt: "2026-05-19T00:00:00.000Z",
      });
      yield* service.runCommand(summary.id, { command: "revalidate", findingId: "fnd-1" });

      expect(setupCalls).toEqual([]);
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(
          fixtureRepo,
          calls,
          undefined,
          false,
          {
            ...gitService,
            createOrReuseWorktree: (input, onLifecycle) =>
              gitService
                .createOrReuseWorktree(input, onLifecycle)
                .pipe(Effect.map((result) => ({ ...result, created: false }))),
          },
          undefined,
          undefined,
          {
            run: (cwd) =>
              Effect.sync(() => {
                setupCalls.push(cwd);
                return makeCommandResult(cwd, "setup");
              }),
          },
        ),
      ),
    );
  });

  it.effect("blocks fixes when the setup script fails", () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseRef?: string;
    }> = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;
      const summary = yield* service.addRepo(fixtureRepo);
      yield* service.updateSettings(summary.id, {
        schemaVersion: 1,
        terminalStartupScript: "",
        worktreeSetupScript: "exit 1",
        updatedAt: "2026-05-19T00:00:00.000Z",
      });
      const error = yield* service
        .runCommand(summary.id, { command: "fix", findingId: "fnd-1" })
        .pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => null,
          }),
        );

      expect(error).toMatchObject({ message: "Worktree setup script failed with exit code 1" });
      expect(calls.some((call) => call.request.command === "fix")).toBe(false);
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(
          fixtureRepo,
          calls,
          undefined,
          false,
          makeGitMock(gitCalls),
          undefined,
          undefined,
          {
            run: (cwd) =>
              Effect.fail(
                new CommandSpawnError({
                  repoPath: cwd,
                  cause: new Error("Worktree setup script failed with exit code 1"),
                }),
              ),
          },
        ),
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
      baseRef?: string;
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
        baseRef: "origin/main",
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

  it.effect("publishes a managed fix worktree for PR creation", () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseBranch?: string | null;
      baseRef?: string;
      commitMessage?: string;
    }> = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const fixResult = yield* service.runCommand(summary.id, {
        command: "fix",
        findingId: "fnd-1",
      });
      const publishResult = yield* service.publishFix(summary.id, "fnd-1");

      expect(publishResult).toMatchObject({
        worktreePath: fixResult.cwd,
        branchName: "clawpatch/fix/fnd-1",
        baseBranch: "main",
        commitSha: "abc123",
        remoteName: "origin",
      });
      expect(gitCalls).toContainEqual({
        kind: "publish",
        repoPath: fixtureRepo,
        worktreePath: fixResult.cwd,
        branchName: "clawpatch/fix/fnd-1",
        baseBranch: "main",
        commitMessage: "Fix Null branch can throw",
      });
    }).pipe(
      Effect.provide(
        makeRepoServiceTestLayer(fixtureRepo, calls, undefined, false, makeGitMock(gitCalls)),
      ),
    );
  });

  it.effect("rejects publishing before a fix worktree exists", () => {
    const calls: RunnerCall[] = [];
    return Effect.gen(function* () {
      const service = yield* RepoService;

      const summary = yield* service.addRepo(fixtureRepo);
      const error = yield* service.publishFix(summary.id, "fnd-1").pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => null,
        }),
      );

      expect(error).toMatchObject({ message: "Run fix before publishing a PR for this finding." });
    }).pipe(Effect.provide(makeRepoServiceTestLayer(fixtureRepo, calls)));
  });

  it("rediscovers managed worktrees by directory convention after restart", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    const appData = await makeTempDir();
    const repoId = "repo-fixture";
    const worktreePath = join(appData, "worktrees", repoId, "fnd-1");
    await writeRepoRegistry(appData, repoId);
    await writeFinding(worktreePath, {
      findingId: "fnd-1",
      title: "Fixed in worktree",
      status: "fixed",
      linkedPatchAttemptIds: ["pat-1"],
    });
    await writePatch(worktreePath, {
      patchAttemptId: "pat-1",
      findingIds: ["fnd-1"],
      prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-1?expand=1",
    });
    await writeFinding(worktreePath, {
      findingId: "fnd-unrelated",
      title: "Unrelated worktree finding",
      status: "open",
    });
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(fixtureRepo, calls, appData, false, makeGitMock(gitCalls)),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const repos = yield* service.listRepos();
          const findings = yield* service.listFindings(repoId);
          const detail = yield* service.getFinding(repoId, "fnd-1");
          const diff = yield* service.readDiff(repoId, "fnd-1");
          const status = yield* service.readGitStatus(repoId, "fnd-1");
          const workStatuses = yield* service.listFindingWorkStatuses(repoId);
          const unrelatedDiff = yield* service.readDiff(repoId, "fnd-unrelated");
          return { repos, findings, detail, diff, status, workStatuses, unrelatedDiff };
        }),
      );

      expect(result.repos[0]).toMatchObject({
        id: repoId,
        activeWorktreePath: worktreePath,
        activeWorktrees: [{ findingId: "fnd-1", path: worktreePath }],
        findingCount: 1,
        openFindingCount: 0,
      });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        findingId: "fnd-1",
        title: "Fixed in worktree",
        status: "fixed",
      });
      expect(result.detail).toMatchObject({
        findingId: "fnd-1",
        title: "Fixed in worktree",
        status: "fixed",
      });
      expect(result.diff).toBe(`diff:${worktreePath}`);
      expect(result.status.branch).toBe("main");
      expect(result.workStatuses).toEqual([
        {
          findingId: "fnd-1",
          worktreePath,
          gitStatus: { staged: 0, modified: 0, untracked: 0, branch: "main" },
          prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-1?expand=1",
          error: null,
        },
      ]);
      expect(result.unrelatedDiff).toBe(`diff:${fixtureRepo}`);
      expect(gitCalls).toContainEqual({ kind: "diff", repoPath: worktreePath });
      expect(gitCalls).toContainEqual({ kind: "status", repoPath: worktreePath });
      expect(gitCalls).toContainEqual({ kind: "diff", repoPath: fixtureRepo });
    } finally {
      await runtime.dispose();
    }
  });

  it("retires clean managed worktrees whose branch patch is applied to origin/main", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseRef?: string;
    }> = [];
    const appData = await makeTempDir();
    const repoId = "repo-fixture";
    const worktreePath = join(appData, "worktrees", repoId, "fnd-1");
    await writeRepoRegistry(appData, repoId);
    await writeFinding(worktreePath, {
      findingId: "fnd-1",
      title: "Fixed in worktree",
      status: "fixed",
      linkedPatchAttemptIds: ["pat-1"],
    });
    await writePatch(worktreePath, {
      patchAttemptId: "pat-1",
      findingIds: ["fnd-1"],
      prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-1?expand=1",
    });
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        appData,
        false,
        makeGitMock(gitCalls, {
          readStatus: (repoPath) =>
            Effect.succeed({
              staged: 0,
              modified: 0,
              untracked: 0,
              branch: repoPath === worktreePath ? "clawpatch/fix/fnd-1" : "main",
            }),
          isBranchAppliedToBase: () => Effect.succeed(true),
        }),
      ),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const repos = yield* service.listRepos();
          const findings = yield* service.listFindings(repoId);
          const detail = yield* service.getFinding(repoId, "fnd-1");
          const diff = yield* service.readDiff(repoId, "fnd-1");
          const status = yield* service.readGitStatus(repoId, "fnd-1");
          const workStatuses = yield* service.listFindingWorkStatuses(repoId);
          return { repos, findings, detail, diff, status, workStatuses };
        }),
      );

      expect(result.repos[0]).toMatchObject({
        id: repoId,
        activeWorktreePath: null,
        activeWorktrees: [],
        findingCount: 1,
        openFindingCount: 1,
      });
      expect(result.findings[0]).toMatchObject({
        findingId: "fnd-1",
        title: "Null branch can throw",
        status: "open",
      });
      expect(result.detail).toMatchObject({
        findingId: "fnd-1",
        title: "Null branch can throw",
        status: "open",
      });
      expect(result.diff).toBe(`diff:${fixtureRepo}`);
      expect(result.status.branch).toBe("main");
      expect(result.workStatuses).toEqual([]);
      expect(gitCalls).toContainEqual({
        kind: "applied",
        repoPath: fixtureRepo,
        branchName: "clawpatch/fix/fnd-1",
        baseRef: "origin/main",
      });
      expect(gitCalls).toContainEqual({ kind: "diff", repoPath: fixtureRepo });
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps clean managed worktrees active when their branch has unapplied commits", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseRef?: string;
    }> = [];
    const appData = await makeTempDir();
    const repoId = "repo-fixture";
    const worktreePath = join(appData, "worktrees", repoId, "fnd-1");
    await writeRepoRegistry(appData, repoId);
    await writeFinding(worktreePath, {
      findingId: "fnd-1",
      title: "Fixed in worktree",
      status: "fixed",
    });
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        appData,
        false,
        makeGitMock(gitCalls, {
          readStatus: (repoPath) =>
            Effect.succeed({
              staged: 0,
              modified: 0,
              untracked: 0,
              branch: repoPath === worktreePath ? "clawpatch/fix/fnd-1" : "main",
            }),
          isBranchAppliedToBase: () => Effect.succeed(false),
        }),
      ),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const repos = yield* service.listRepos();
          const findings = yield* service.listFindings(repoId);
          const diff = yield* service.readDiff(repoId, "fnd-1");
          return { repos, findings, diff };
        }),
      );

      expect(result.repos[0]).toMatchObject({
        activeWorktreePath: worktreePath,
        activeWorktrees: [{ findingId: "fnd-1", path: worktreePath }],
      });
      expect(result.findings[0]).toMatchObject({
        findingId: "fnd-1",
        title: "Fixed in worktree",
        status: "fixed",
      });
      expect(result.diff).toBe(`diff:${worktreePath}`);
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps managed worktrees active when applied-to-base detection fails", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
      baseRef?: string;
    }> = [];
    const appData = await makeTempDir();
    const repoId = "repo-fixture";
    const worktreePath = join(appData, "worktrees", repoId, "fnd-1");
    await writeRepoRegistry(appData, repoId);
    await writeFinding(worktreePath, {
      findingId: "fnd-1",
      title: "Fixed in worktree",
      status: "fixed",
    });
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        appData,
        false,
        makeGitMock(gitCalls, {
          readStatus: (repoPath) =>
            Effect.succeed({
              staged: 0,
              modified: 0,
              untracked: 0,
              branch: repoPath === worktreePath ? "clawpatch/fix/fnd-1" : "main",
            }),
          isBranchAppliedToBase: ({ repoPath }) =>
            Effect.fail(new CommandSpawnError({ repoPath, cause: new Error("cherry failed") })),
        }),
      ),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const repos = yield* service.listRepos();
          const diff = yield* service.readDiff(repoId, "fnd-1");
          return { repos, diff };
        }),
      );

      expect(result.repos[0]).toMatchObject({
        activeWorktreePath: worktreePath,
        activeWorktrees: [{ findingId: "fnd-1", path: worktreePath }],
      });
      expect(result.diff).toBe(`diff:${worktreePath}`);
    } finally {
      await runtime.dispose();
    }
  });

  it("returns work status entries when one worktree status read fails", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    const appData = await makeTempDir();
    const repoId = "repo-fixture";
    const firstWorktreePath = join(appData, "worktrees", repoId, "fnd-1");
    const secondWorktreePath = join(appData, "worktrees", repoId, "fnd-2");
    await writeRepoRegistry(appData, repoId);
    await writeFinding(firstWorktreePath, {
      findingId: "fnd-1",
      title: "First finding",
      status: "open",
    });
    await writeFinding(secondWorktreePath, {
      findingId: "fnd-2",
      title: "Second finding",
      status: "open",
    });
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(
        fixtureRepo,
        calls,
        appData,
        false,
        makeGitMock(gitCalls, {
          readStatus: (repoPath) =>
            repoPath === secondWorktreePath
              ? Effect.fail(
                  new CommandSpawnError({
                    repoPath,
                    cause: new Error("status failed"),
                  }),
                )
              : Effect.succeed({
                  staged: 0,
                  modified: 1,
                  untracked: 0,
                  branch: "clawpatch/fix/fnd-1",
                }),
        }),
      ),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          return yield* service.listFindingWorkStatuses(repoId);
        }),
      );

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        findingId: "fnd-1",
        worktreePath: firstWorktreePath,
        gitStatus: {
          staged: 0,
          modified: 1,
          untracked: 0,
          branch: "clawpatch/fix/fnd-1",
        },
        prUrl: null,
        error: null,
      });
      expect(result).toContainEqual({
        findingId: "fnd-2",
        worktreePath: secondWorktreePath,
        gitStatus: null,
        prUrl: null,
        error: "status failed",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("ignores invalid managed worktree candidates during rediscovery", async () => {
    const calls: RunnerCall[] = [];
    const gitCalls: Array<{
      kind: string;
      repoPath: string;
      worktreePath?: string;
      branchName?: string;
    }> = [];
    const appData = await makeTempDir();
    const repoId = "repo-fixture";
    const worktreesRoot = join(appData, "worktrees", repoId);
    await writeRepoRegistry(appData, repoId);
    await mkdir(join(worktreesRoot, "no-state"), { recursive: true });
    await writeFinding(join(worktreesRoot, "wrong-slug"), {
      findingId: "fnd-mismatch",
      title: "Wrong slug",
      status: "fixed",
    });
    await writeFile(join(worktreesRoot, "not-a-directory"), "ignored", "utf8");
    const runtime = ManagedRuntime.make(
      makeRepoServiceTestLayer(fixtureRepo, calls, appData, false, makeGitMock(gitCalls)),
    );

    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RepoService;
          const repos = yield* service.listRepos();
          const findings = yield* service.listFindings(repoId);
          const diff = yield* service.readDiff(repoId, "fnd-mismatch");
          return { repos, findings, diff };
        }),
      );

      expect(result.repos[0]).toMatchObject({
        id: repoId,
        activeWorktreePath: null,
        activeWorktrees: [],
        findingCount: 1,
        openFindingCount: 1,
      });
      expect(result.findings.map((finding) => finding.findingId)).toEqual(["fnd-1"]);
      expect(result.findings[0].title).toBe("Null branch can throw");
      expect(result.diff).toBe(`diff:${fixtureRepo}`);
      expect(gitCalls).toContainEqual({ kind: "diff", repoPath: fixtureRepo });
    } finally {
      await runtime.dispose();
    }
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
      interruptAll: () => Effect.succeed(0),
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
      interruptAll: () => Effect.succeed(0),
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
      interruptAll: () => Effect.succeed(0),
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
      expect(calls.filter((call) => call.request.command === "status")).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });
});

interface RunnerCall {
  readonly repoPath: string;
  readonly request: ClawpatchCommandRequest;
}

async function writeRepoRegistry(
  appData: string,
  repoId: string,
  repoPath = fixtureRepo,
): Promise<void> {
  await writeFile(
    join(appData, "repos.json"),
    JSON.stringify({
      repos: [
        {
          id: repoId,
          name: "clawpatch-repo",
          path: repoPath,
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
}

async function writeFinding(
  repoPath: string,
  overrides: {
    readonly findingId: string;
    readonly title?: string;
    readonly status?: string;
    readonly featureId?: string;
    readonly linkedPatchAttemptIds?: readonly string[];
    readonly updatedAt?: string;
  },
): Promise<void> {
  await mkdir(join(repoPath, ".clawpatch", "findings"), { recursive: true });
  await writeFile(
    join(repoPath, ".clawpatch", "findings", `${overrides.findingId}.json`),
    JSON.stringify(
      {
        findingId: overrides.findingId,
        featureId: overrides.featureId ?? "feat-1",
        title: overrides.title ?? overrides.findingId,
        category: "bug",
        severity: "high",
        confidence: "high",
        evidence: [],
        reasoning: "Reasoning",
        reproduction: null,
        recommendation: "Recommendation",
        status: overrides.status ?? "open",
        linkedPatchAttemptIds: overrides.linkedPatchAttemptIds ?? [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function writePatch(
  repoPath: string,
  overrides: {
    readonly patchAttemptId: string;
    readonly findingIds: readonly string[];
    readonly prUrl?: string | null;
    readonly createdAt?: string;
  },
): Promise<void> {
  await mkdir(join(repoPath, ".clawpatch", "patches"), { recursive: true });
  await writeFile(
    join(repoPath, ".clawpatch", "patches", `${overrides.patchAttemptId}.json`),
    JSON.stringify(
      {
        patchAttemptId: overrides.patchAttemptId,
        findingIds: overrides.findingIds,
        featureIds: ["feat-1"],
        status: "applied",
        plan: null,
        filesChanged: [],
        commandsRun: [],
        testResults: [],
        git: {
          baseSha: null,
          commitSha: null,
          branchName: "clawpatch/fix/fnd-1",
          prUrl: overrides.prUrl ?? null,
        },
        createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
        updatedAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
      },
      null,
      2,
    ),
    "utf8",
  );
}

function makeRepoServiceTestLayer(
  cwd: string,
  calls: RunnerCall[],
  appData?: string,
  isRunning = false,
  gitService?: GitServiceShape,
  runnerService?: ClawpatchRunnerShape,
  terminalLauncherService?: TerminalLauncherShape,
  setupScriptRunnerService?: SetupScriptRunnerShape,
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
            run: (repoPath, request, onStream) =>
              Effect.sync((): CommandResult => {
                calls.push({ repoPath, request });
                onStream?.({
                  kind: "lifecycle",
                  runId: "run-test",
                  phase: "clawpatch:start",
                  message: `$ clawpatch ${request.command}`,
                  cwd: repoPath,
                  argv: ["clawpatch", request.command],
                });
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
            interruptAll: () => Effect.succeed(0),
            isRunning: () => Effect.succeed(isRunning),
          },
        ),
      );
      return RepoServiceLive(appData).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            runnerLayer,
            ClawpatchConfigServiceLive,
            ClawpatchStateServiceLive,
            UiMetadataServiceLive(appData),
            AppSettingsServiceLive(appData),
            RepoSettingsServiceLive(appData),
            gitService === undefined
              ? GitServiceLive
              : Layer.succeed(GitService, GitService.of(gitService)),
            Layer.succeed(
              SetupScriptRunner,
              SetupScriptRunner.of(
                setupScriptRunnerService ?? {
                  run: (cwd) => Effect.succeed(makeCommandResult(cwd, "setup")),
                },
              ),
            ),
            Layer.succeed(
              TerminalLauncher,
              TerminalLauncher.of(
                terminalLauncherService ?? {
                  open: (cwd) => Effect.succeed({ cwd }),
                },
              ),
            ),
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

function makeTerminalMock(calls: string[]): TerminalLauncherShape {
  return {
    open: (cwd) =>
      Effect.sync(() => {
        calls.push(cwd);
        return { cwd };
      }),
  };
}

function makeGitMock(
  calls: Array<{
    kind: string;
    repoPath: string;
    worktreePath?: string;
    branchName?: string;
    baseBranch?: string | null;
    baseRef?: string;
    commitMessage?: string;
  }>,
  options: {
    readonly readStatus?: (repoPath: string) => Effect.Effect<GitStatusSummary, CommandSpawnError>;
    readonly isBranchAppliedToBase?: GitServiceShape["isBranchAppliedToBase"];
  } = {},
): GitServiceShape {
  return {
    readDiff: (repoPath) =>
      Effect.sync(() => {
        calls.push({ kind: "diff", repoPath });
        return `diff:${repoPath}`;
      }),
    readStatus: (repoPath) => {
      calls.push({ kind: "status", repoPath });
      return (
        options.readStatus?.(repoPath) ??
        Effect.succeed({ staged: 0, modified: 0, untracked: 0, branch: "main" })
      );
    },
    isBranchAppliedToBase: ({ repoPath, branchName, baseRef }, onLifecycle) => {
      calls.push({ kind: "applied", repoPath, branchName, baseRef });
      return (
        options.isBranchAppliedToBase?.({ repoPath, branchName, baseRef }, onLifecycle) ??
        Effect.succeed(false)
      );
    },
    requireCleanCheckout: (repoPath, onLifecycle) =>
      Effect.sync(() => {
        calls.push({ kind: "clean", repoPath });
        onLifecycle?.({
          phase: "git:start",
          message: "$ git status --porcelain=v1 --untracked-files=all",
          cwd: repoPath,
          argv: ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        });
      }),
    createOrReuseWorktree: ({ repoPath, worktreePath, branchName, baseRef }, onLifecycle) =>
      Effect.sync(() => {
        calls.push({ kind: "worktree", repoPath, worktreePath, branchName, baseRef });
        onLifecycle?.({
          phase: "git:start",
          message: `$ git worktree add -b ${branchName} ${worktreePath} ${baseRef}`,
          cwd: repoPath,
          argv: ["git", "worktree", "add", "-b", branchName, worktreePath, baseRef],
        });
        return { worktreePath, created: true };
      }),
    publishFix: ({ repoPath, worktreePath, branchName, baseBranch, commitMessage }) =>
      Effect.sync(() => {
        calls.push({
          kind: "publish",
          repoPath,
          worktreePath,
          branchName,
          baseBranch,
          commitMessage,
        });
        return {
          worktreePath,
          branchName,
          baseBranch: baseBranch ?? "main",
          commitSha: "abc123",
          remoteName: "origin",
          prUrl: `https://github.com/acme/repo/compare/${baseBranch ?? "main"}...${branchName}?expand=1`,
        };
      }),
  };
}

function phaseIndex(
  events: readonly CommandStreamEvent[],
  phase: string,
  command?: string,
): number {
  return events.findIndex(
    (event) =>
      event.kind === "lifecycle" &&
      event.phase === phase &&
      (command === undefined || event.command === command),
  );
}
