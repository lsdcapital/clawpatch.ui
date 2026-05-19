import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect } from "vitest";
import type { ClawpatchCommandRequest, CommandResult } from "../../src/shared/types";
import { ClawpatchRunner } from "../../src/main/services/clawpatchRunner";
import { ClawpatchStateServiceLive } from "../../src/main/services/clawpatchState";
import { GitServiceLive } from "../../src/main/services/gitService";
import { GuiMetadataServiceLive } from "../../src/main/services/guiMetadata";
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
) {
  const appDataEffect =
    appData === undefined ? Effect.promise(() => makeTempDir()) : Effect.succeed(appData);
  return Layer.unwrap(
    Effect.gen(function* () {
      const appData = yield* appDataEffect;
      const runnerLayer = Layer.succeed(
        ClawpatchRunner,
        ClawpatchRunner.of({
          run: (repoPath, request) =>
            Effect.sync((): CommandResult => {
              calls.push({ repoPath, request });
              return {
                runId: "run-test",
                command: "clawpatch",
                args: [request.command],
                cwd,
                exitCode: 0,
                durationMs: 1,
                stdout: "{}",
                stderr: "",
                parsedJson: {},
              };
            }),
          interrupt: () => Effect.succeed({ interrupted: true }),
          isRunning: () => Effect.succeed(isRunning),
        }),
      );
      return RepoServiceLive(appData).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            runnerLayer,
            ClawpatchStateServiceLive,
            GuiMetadataServiceLive,
            GitServiceLive,
          ),
        ),
      );
    }),
  );
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawpatch-gui-"));
  tempDirs.push(dir);
  return dir;
}
