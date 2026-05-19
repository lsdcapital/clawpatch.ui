import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandInterruptResult,
  CommandResult,
  CommandStreamEvent,
  FeatureMapSnapshot,
  FindingDetail,
  FindingListItem,
  RepoSnapshot,
  RepoSummary,
} from "../../shared/types";
import { InvalidRepoPathError, RepoNotFoundError } from "../errors";
import { ClawpatchRunner } from "./clawpatchRunner";
import { ClawpatchStateService } from "./clawpatchState";
import { GitService } from "./gitService";
import { UiMetadataService } from "./uiMetadata";

interface RegistryFile {
  repos: Array<Pick<RepoSummary, "id" | "name" | "path" | "updatedAt">>;
}

export interface RepoServiceShape {
  readonly listRepos: () => Effect.Effect<RepoSummary[], unknown>;
  readonly addRepo: (repoPath: string) => Effect.Effect<RepoSummary, unknown>;
  readonly refreshRepo: (repoId: string) => Effect.Effect<RepoSnapshot, unknown>;
  readonly listFindings: (repoId: string) => Effect.Effect<FindingListItem[], unknown>;
  readonly readFeatureMap: (repoId: string) => Effect.Effect<FeatureMapSnapshot, unknown>;
  readonly getFinding: (repoId: string, findingId: string) => Effect.Effect<FindingDetail, unknown>;
  readonly runCommand: (
    repoId: string,
    request: ClawpatchCommandRequest,
    onStream?: (event: CommandStreamEvent) => void,
  ) => Effect.Effect<CommandResult, unknown>;
  readonly interruptCommand: (repoId: string) => Effect.Effect<CommandInterruptResult, unknown>;
  readonly setTriage: (
    repoId: string,
    findingId: string,
    status: ClawpatchStatus,
    note?: string,
  ) => Effect.Effect<CommandResult, unknown>;
  readonly readDiff: (repoId: string) => Effect.Effect<string, unknown>;
}

export class RepoService extends Context.Service<RepoService, RepoServiceShape>()(
  "clawpatch/RepoService",
) {}

export const RepoServiceLive = (appDataDir: string) =>
  Layer.effect(
    RepoService,
    Effect.gen(function* () {
      const runner = yield* ClawpatchRunner;
      const state = yield* ClawpatchStateService;
      const metadata = yield* UiMetadataService;
      const git = yield* GitService;
      const registryPath = resolve(appDataDir, "repos.json");
      const registryMutationSemaphore = yield* Semaphore.make(1);

      const readRegistry = Effect.fn("repoService.readRegistry")(function* () {
        const raw = yield* Effect.tryPromise(() => readFile(registryPath, "utf8")).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        if (raw === null) {
          return { repos: [] } satisfies RegistryFile;
        }

        return yield* Effect.try({
          try: () => {
            const parsed = JSON.parse(raw) as Partial<RegistryFile>;
            return {
              repos: Array.isArray(parsed.repos) ? parsed.repos : [],
            } satisfies RegistryFile;
          },
          catch: (cause) => cause,
        }).pipe(Effect.catch(() => Effect.succeed({ repos: [] } satisfies RegistryFile)));
      });

      const writeRegistry = Effect.fn("repoService.writeRegistry")(function* (
        registry: RegistryFile,
      ) {
        yield* Effect.tryPromise({
          try: () => mkdir(dirname(registryPath), { recursive: true }),
          catch: (cause) =>
            new InvalidRepoPathError({
              message: "Unable to create repo registry directory",
              path: registryPath,
              cause,
            }),
        });
        yield* Effect.tryPromise({
          try: () => writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8"),
          catch: (cause) =>
            new InvalidRepoPathError({
              message: "Unable to write repo registry",
              path: registryPath,
              cause,
            }),
        });
      });

      const requireRepo = Effect.fn("repoService.requireRepo")(function* (repoIdValue: string) {
        const registry = yield* readRegistry();
        const repo = registry.repos.find((item) => item.id === repoIdValue);
        if (repo === undefined) {
          return yield* new RepoNotFoundError({ repoId: repoIdValue });
        }
        yield* normalizeExistingDirectory(repo.path);
        return repo;
      });

      const summarizeRepo = Effect.fn("repoService.summarizeRepo")(function* (
        repoPath: string,
        id: string,
      ) {
        const hasClawpatch = yield* state.detect(repoPath);
        let isValid = false;
        let lastError: string | null = null;
        let findings: FindingListItem[] = [];

        if (!hasClawpatch) {
          lastError = "No .clawpatch state found";
        } else {
          const isCommandRunning = yield* runner.isRunning(repoPath);
          if (isCommandRunning) {
            isValid = true;
          } else {
            const status = yield* runner.run(repoPath, { command: "status" }).pipe(
              Effect.catch((error: unknown) =>
                Effect.succeed({
                  exitCode: 1,
                  stderr: error instanceof Error ? error.message : String(error),
                  stdout: "",
                }),
              ),
            );
            isValid = status.exitCode === 0;
            lastError = isValid
              ? null
              : status.stderr || status.stdout || "clawpatch status failed";
          }
          findings = yield* state
            .readFindingList(repoPath)
            .pipe(Effect.catch(() => Effect.succeed([])));
        }

        return {
          id,
          name: basename(repoPath),
          path: repoPath,
          hasClawpatch,
          isValid,
          lastError,
          findingCount: findings.length,
          openFindingCount: findings.filter((item) => item.status === "open").length,
          updatedAt: new Date().toISOString(),
        } satisfies RepoSummary;
      });

      return RepoService.of({
        listRepos: Effect.fn("repoService.listRepos")(function* () {
          const registry = yield* readRegistry();
          return yield* Effect.all(
            registry.repos.map((repo) => summarizeRepo(repo.path, repo.id)),
            { concurrency: "unbounded" },
          );
        }),
        addRepo: Effect.fn("repoService.addRepo")(function* (repoPath) {
          const normalized = yield* normalizeExistingDirectory(repoPath);
          const repo = yield* registryMutationSemaphore.withPermit(
            Effect.gen(function* () {
              const registry = yield* readRegistry();
              const existing = registry.repos.find((repo) => repo.path === normalized);
              if (existing !== undefined) {
                return existing;
              }

              const repo = {
                id: repoId(normalized),
                name: basename(normalized),
                path: normalized,
                updatedAt: new Date().toISOString(),
              };
              registry.repos.push(repo);
              yield* writeRegistry(registry);
              return repo;
            }),
          );
          return yield* summarizeRepo(repo.path, repo.id);
        }),
        refreshRepo: Effect.fn("repoService.refreshRepo")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          const repoMetadata = yield* metadata.read(repo.path);
          const [summary, diff] = yield* Effect.all([
            summarizeRepo(repo.path, repo.id),
            git.readDiff(repo.path),
          ]);
          const findings = yield* state.readFindingList(repo.path);
          return {
            repo: {
              ...summary,
              findingCount: findings.length,
              openFindingCount: findings.filter((item) => item.status === "open").length,
            },
            status:
              summary.lastError === null
                ? (yield* runner.run(repo.path, { command: "status" })).parsedJson
                : null,
            findings,
            diff,
            metadata: repoMetadata,
          };
        }),
        listFindings: Effect.fn("repoService.listFindings")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* state.readFindingList(repo.path);
        }),
        readFeatureMap: Effect.fn("repoService.readFeatureMap")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* state.readFeatureMap(repo.path);
        }),
        getFinding: Effect.fn("repoService.getFinding")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* state.readFindingDetail(repo.path, findingId);
        }),
        runCommand: Effect.fn("repoService.runCommand")(function* (repoIdValue, request, onStream) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* runner.run(repo.path, request, onStream);
        }),
        interruptCommand: Effect.fn("repoService.interruptCommand")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* runner.interrupt(repo.path);
        }),
        setTriage: Effect.fn("repoService.setTriage")(function* (
          repoIdValue,
          findingId,
          status,
          note = "",
        ) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* runner.run(repo.path, { command: "triage", findingId, status, note });
        }),
        readDiff: Effect.fn("repoService.readDiff")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* git.readDiff(repo.path);
        }),
      });
    }),
  );

const normalizeExistingDirectory = (inputPath: string) =>
  Effect.gen(function* () {
    if (typeof inputPath !== "string" || inputPath.trim() === "") {
      return yield* new InvalidRepoPathError({ message: "Repo path is required" });
    }
    if (inputPath.includes("\0") || inputPath.includes("\r") || inputPath.includes("\n")) {
      return yield* new InvalidRepoPathError({
        message: "Repo path contains invalid characters",
        path: inputPath,
      });
    }

    const normalized = resolve(expandHomePath(inputPath.trim()));
    const stats = yield* Effect.tryPromise({
      try: () => stat(normalized),
      catch: (cause) =>
        new InvalidRepoPathError({
          message: "Repo path does not exist",
          path: normalized,
          cause,
        }),
    });
    if (!stats.isDirectory()) {
      return yield* new InvalidRepoPathError({
        message: "Repo path must be a directory",
        path: normalized,
      });
    }
    return normalized;
  });

function expandHomePath(inputPath: string): string {
  if (inputPath === "~") {
    return homedir();
  }
  if (inputPath.startsWith("~/")) {
    return resolve(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function repoId(repoPath: string): string {
  return createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}
