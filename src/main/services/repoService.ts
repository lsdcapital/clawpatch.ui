import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
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
  GitStatusSummary,
  RepoSnapshot,
  RepoSummary,
} from "../../shared/types";
import {
  CommandAlreadyRunningError,
  CommandValidationError,
  InvalidRepoPathError,
  RepoNotFoundError,
} from "../errors";
import { ClawpatchRunner, type ClawpatchRunnerError } from "./clawpatchRunner";
import { ClawpatchStateService, type ClawpatchStateError } from "./clawpatchState";
import { GitService, type GitLifecycleEvent } from "./gitService";
import { UiMetadataService, type UiMetadataError } from "./uiMetadata";

interface RegistryFile {
  repos: Array<Pick<RepoSummary, "id" | "name" | "path" | "updatedAt">>;
}

const TARGET_BASE_REF = "origin/main";

type ActiveWorktreePaths = Map<string, Map<string, string>>;
type RunningCommandPaths = Map<string, string>;

export type RepoServiceError =
  | InvalidRepoPathError
  | RepoNotFoundError
  | CommandValidationError
  | ClawpatchRunnerError
  | ClawpatchStateError
  | UiMetadataError;

export interface RepoServiceShape {
  readonly listRepos: () => Effect.Effect<RepoSummary[], RepoServiceError>;
  readonly addRepo: (repoPath: string) => Effect.Effect<RepoSummary, RepoServiceError>;
  readonly refreshRepo: (repoId: string) => Effect.Effect<RepoSnapshot, RepoServiceError>;
  readonly listFindings: (repoId: string) => Effect.Effect<FindingListItem[], RepoServiceError>;
  readonly readFeatureMap: (repoId: string) => Effect.Effect<FeatureMapSnapshot, RepoServiceError>;
  readonly getFinding: (
    repoId: string,
    findingId: string,
  ) => Effect.Effect<FindingDetail, RepoServiceError>;
  readonly runCommand: (
    repoId: string,
    request: ClawpatchCommandRequest,
    onStream?: (event: CommandStreamEvent) => void,
  ) => Effect.Effect<CommandResult, RepoServiceError>;
  readonly interruptCommand: (
    repoId: string,
    findingId?: string,
  ) => Effect.Effect<CommandInterruptResult, RepoServiceError>;
  readonly setTriage: (
    repoId: string,
    findingId: string,
    status: ClawpatchStatus,
    note?: string,
  ) => Effect.Effect<CommandResult, RepoServiceError>;
  readonly readDiff: (
    repoId: string,
    findingId?: string,
  ) => Effect.Effect<string, RepoServiceError>;
  readonly readGitStatus: (
    repoId: string,
    findingId?: string,
  ) => Effect.Effect<GitStatusSummary, RepoServiceError>;
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
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const registryPath = path.resolve(appDataDir, "repos.json");
      const registryMutationSemaphore = yield* Semaphore.make(1);
      const activeWorktreePaths = yield* Ref.make<ActiveWorktreePaths>(new Map());
      const runningRepoCommandPaths = yield* Ref.make<RunningCommandPaths>(new Map());
      const runningFindingCommandPaths = yield* Ref.make<RunningCommandPaths>(new Map());

      const readRegistry = Effect.fn("repoService.readRegistry")(function* () {
        const raw = yield* fs
          .readFileString(registryPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
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
        yield* fs.makeDirectory(path.dirname(registryPath), { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new InvalidRepoPathError({
                message: "Unable to create repo registry directory",
                path: registryPath,
                cause,
              }),
          ),
        );
        yield* fs.writeFileString(registryPath, `${JSON.stringify(registry, null, 2)}\n`).pipe(
          Effect.mapError(
            (cause) =>
              new InvalidRepoPathError({
                message: "Unable to write repo registry",
                path: registryPath,
                cause,
              }),
          ),
        );
      });

      const normalizeExistingDirectory = Effect.fn("repoService.normalizeExistingDirectory")(
        function* (inputPath: string) {
          if (typeof inputPath !== "string" || inputPath.trim() === "") {
            return yield* new InvalidRepoPathError({ message: "Repo path is required" });
          }
          if (inputPath.includes("\0") || inputPath.includes("\r") || inputPath.includes("\n")) {
            return yield* new InvalidRepoPathError({
              message: "Repo path contains invalid characters",
              path: inputPath,
            });
          }

          const normalized = path.resolve(expandHomePath(inputPath.trim(), path));
          const stats = yield* fs.stat(normalized).pipe(
            Effect.mapError(
              (cause) =>
                new InvalidRepoPathError({
                  message: "Repo path does not exist",
                  path: normalized,
                  cause,
                }),
            ),
          );
          if (stats.type !== "Directory") {
            return yield* new InvalidRepoPathError({
              message: "Repo path must be a directory",
              path: normalized,
            });
          }
          return normalized;
        },
      );

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
        const activeWorktrees = yield* activeWorktreesForRepo(id);
        const activeWorktreePath = activeWorktrees[0]?.path ?? null;
        const hasClawpatch = yield* state.detect(repoPath);
        let isValid = false;
        let lastError: string | null = null;
        let findings: FindingListItem[] = [];

        if (!hasClawpatch) {
          lastError = "No .clawpatch state found";
        } else {
          const isCommandRunning =
            (yield* isRepoCommandRunning(id)) ||
            (yield* hasRunningFindingCommand(id)) ||
            (yield* runner.isRunning(repoPath));
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
          findings = yield* readFindingListWithActiveWorktrees(id, repoPath);
        }

        return {
          id,
          name: path.basename(repoPath),
          path: repoPath,
          hasClawpatch,
          isValid,
          lastError,
          findingCount: findings.length,
          openFindingCount: findings.filter((item) => item.status === "open").length,
          activeWorktreePath,
          activeWorktrees,
          updatedAt: new Date().toISOString(),
        } satisfies RepoSummary;
      });

      const discoverActiveWorktreesForRepo = Effect.fn(
        "repoService.discoverActiveWorktreesForRepo",
      )(function* (repoIdValue: string) {
        const worktreesRoot = path.join(appDataDir, "worktrees", repoIdValue);
        const names = yield* fs
          .readDirectory(worktreesRoot)
          .pipe(Effect.catch(() => Effect.succeed([])));
        const entries = yield* Effect.all(
          names.toSorted().map((name) =>
            Effect.gen(function* () {
              const slug = path.basename(name);
              if (slug !== name || slug === "") {
                return null;
              }

              const worktreePath = path.join(worktreesRoot, slug);
              const stats = yield* fs
                .stat(worktreePath)
                .pipe(Effect.catch(() => Effect.succeed(null)));
              if (stats?.type !== "Directory") {
                return null;
              }

              const findings = yield* state
                .readFindingList(worktreePath)
                .pipe(Effect.catch(() => Effect.succeed([])));
              const finding = findings.find(
                (item) => sanitizeWorktreeFragment(item.findingId) === slug,
              );
              if (finding === undefined) {
                return null;
              }
              return [finding.findingId, worktreePath] as const;
            }),
          ),
          { concurrency: "unbounded" },
        );

        return new Map(
          entries.filter((entry): entry is readonly [string, string] => entry !== null),
        );
      });

      const hydrateDiscoveredWorktreesForRepo = Effect.fn(
        "repoService.hydrateDiscoveredWorktreesForRepo",
      )(function* (repoIdValue: string) {
        const discovered = yield* discoverActiveWorktreesForRepo(repoIdValue);
        if (discovered.size === 0) {
          return;
        }
        yield* Ref.update(activeWorktreePaths, (paths) => {
          const nextPaths = new Map(paths);
          const repoWorktrees = new Map(nextPaths.get(repoIdValue));
          for (const [findingId, worktreePath] of discovered) {
            repoWorktrees.set(findingId, worktreePath);
          }
          nextPaths.set(repoIdValue, repoWorktrees);
          return nextPaths;
        });
      });

      const activeWorktreesForRepo = Effect.fn("repoService.activeWorktreesForRepo")(function* (
        repoIdValue: string,
      ) {
        yield* hydrateDiscoveredWorktreesForRepo(repoIdValue);
        const paths = yield* Ref.get(activeWorktreePaths);
        return [...(paths.get(repoIdValue)?.entries() ?? [])]
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([findingId, path]) => ({
            findingId,
            path,
          }));
      });

      const activeWorktreePathForFinding = Effect.fn("repoService.activeWorktreePathForFinding")(
        function* (repoIdValue: string, findingId: string | undefined) {
          if (findingId === undefined) {
            return null;
          }
          yield* hydrateDiscoveredWorktreesForRepo(repoIdValue);
          const paths = yield* Ref.get(activeWorktreePaths);
          return paths.get(repoIdValue)?.get(findingId) ?? null;
        },
      );

      const setActiveWorktreePath = Effect.fn("repoService.setActiveWorktreePath")(function* (
        repoIdValue: string,
        findingId: string,
        worktreePath: string,
      ) {
        yield* Ref.update(activeWorktreePaths, (paths) => {
          const nextPaths = new Map(paths);
          const repoWorktrees = new Map(nextPaths.get(repoIdValue));
          repoWorktrees.set(findingId, worktreePath);
          nextPaths.set(repoIdValue, repoWorktrees);
          return nextPaths;
        });
      });

      const isRepoCommandRunning = Effect.fn("repoService.isRepoCommandRunning")(function* (
        repoIdValue: string,
      ) {
        const paths = yield* Ref.get(runningRepoCommandPaths);
        return paths.has(repoIdValue);
      });

      const repoCommandPathForRepo = Effect.fn("repoService.repoCommandPathForRepo")(function* (
        repoIdValue: string,
      ) {
        const paths = yield* Ref.get(runningRepoCommandPaths);
        return paths.get(repoIdValue) ?? null;
      });

      const hasRunningFindingCommand = Effect.fn("repoService.hasRunningFindingCommand")(function* (
        repoIdValue: string,
      ) {
        const paths = yield* Ref.get(runningFindingCommandPaths);
        return [...paths.keys()].some((key) => key.startsWith(`${repoIdValue}\0`));
      });

      const findingCommandPath = Effect.fn("repoService.findingCommandPath")(function* (
        repoIdValue: string,
        findingId: string,
      ) {
        const paths = yield* Ref.get(runningFindingCommandPaths);
        return paths.get(findingCommandKey(repoIdValue, findingId)) ?? null;
      });

      const managedWorktreeForFinding = (
        repo: Pick<RepoSummary, "id" | "path">,
        findingId: string,
      ): { worktreePath: string; branchName: string } => {
        const slug = sanitizeWorktreeFragment(findingId);
        return {
          worktreePath: path.join(appDataDir, "worktrees", repo.id, slug),
          branchName: `clawpatch/fix/${slug}`,
        };
      };

      const readFindingListWithActiveWorktrees = Effect.fn(
        "repoService.readFindingListWithActiveWorktrees",
      )(function* (repoIdValue: string, repoPath: string) {
        const baseFindings = yield* state
          .readFindingList(repoPath)
          .pipe(Effect.catch(() => Effect.succeed([])));
        const byId = new Map(baseFindings.map((finding) => [finding.findingId, finding]));
        const activeWorktrees = yield* activeWorktreesForRepo(repoIdValue);

        yield* Effect.all(
          activeWorktrees.map(({ findingId, path: worktreePath }) =>
            state.readFindingList(worktreePath).pipe(
              Effect.tap((worktreeFindings) =>
                Effect.sync(() => {
                  const finding = worktreeFindings.find((item) => item.findingId === findingId);
                  if (finding !== undefined) {
                    byId.set(finding.findingId, finding);
                  }
                }),
              ),
              Effect.catch(() => Effect.succeed([])),
            ),
          ),
          { concurrency: "unbounded" },
        );

        return [...byId.values()];
      });

      const runCommandAtPath = Effect.fn("repoService.runCommandAtPath")(function* (
        repoIdValue: string,
        commandPath: string,
        request: ClawpatchCommandRequest,
        onStream?: (event: CommandStreamEvent) => void,
        findingId?: string,
      ) {
        return yield* runner.run(commandPath, request, (event) =>
          onStream?.({
            ...event,
            repoId: repoIdValue,
            findingId,
            command: request.command,
          }),
        );
      });

      const runTrackedRepoCommand = Effect.fn("repoService.runTrackedRepoCommand")(function* (
        repoIdValue: string,
        commandPath: string,
        request: ClawpatchCommandRequest,
        onStream?: (event: CommandStreamEvent) => void,
      ) {
        const claimed = yield* Ref.modify(runningRepoCommandPaths, (paths) => {
          if (paths.has(repoIdValue)) {
            return [false, paths] as const;
          }
          const nextPaths = new Map(paths);
          nextPaths.set(repoIdValue, commandPath);
          return [true, nextPaths] as const;
        });
        if (!claimed) {
          return yield* new CommandAlreadyRunningError({ repoPath: commandPath });
        }
        return yield* runCommandAtPath(repoIdValue, commandPath, request, onStream).pipe(
          Effect.ensuring(
            Ref.update(runningRepoCommandPaths, (paths) => {
              const nextPaths = new Map(paths);
              nextPaths.delete(repoIdValue);
              return nextPaths;
            }),
          ),
        );
      });

      const runFindingCommandLocked = Effect.fn("repoService.runFindingCommandLocked")(function* (
        repoIdValue: string,
        findingId: string,
        commandPath: string,
        effect: Effect.Effect<CommandResult, RepoServiceError>,
      ) {
        const key = findingCommandKey(repoIdValue, findingId);
        const claimed = yield* Ref.modify(runningFindingCommandPaths, (paths) => {
          if (paths.has(key)) {
            return [false, paths] as const;
          }
          const nextPaths = new Map(paths);
          nextPaths.set(key, commandPath);
          return [true, nextPaths] as const;
        });
        if (!claimed) {
          return yield* new CommandAlreadyRunningError({ repoPath: commandPath });
        }
        return yield* effect.pipe(
          Effect.ensuring(
            Ref.update(runningFindingCommandPaths, (paths) => {
              const nextPaths = new Map(paths);
              nextPaths.delete(key);
              return nextPaths;
            }),
          ),
        );
      });

      const createManagedWorktree = Effect.fn("repoService.createManagedWorktree")(function* (
        repo: Pick<RepoSummary, "id" | "path">,
        findingId: string,
        onLifecycle?: (event: GitLifecycleEvent) => void,
      ) {
        const { worktreePath, branchName } = managedWorktreeForFinding(repo, findingId);
        yield* git.createOrReuseWorktree(
          { repoPath: repo.path, worktreePath, branchName, baseRef: TARGET_BASE_REF },
          onLifecycle,
        );
        yield* setActiveWorktreePath(repo.id, findingId, worktreePath);
        return worktreePath;
      });

      const runFixInManagedWorktree = Effect.fn("repoService.runFixInManagedWorktree")(function* (
        repo: Pick<RepoSummary, "id" | "path">,
        request: Extract<ClawpatchCommandRequest, { command: "fix" }>,
        onStream?: (event: CommandStreamEvent) => void,
      ) {
        const status = request.status;
        const note = request.note ?? "";
        if (status === undefined && note.trim() !== "") {
          return yield* new CommandValidationError({
            message: "Fix guidance note requires a finding status",
          });
        }

        const { worktreePath } = managedWorktreeForFinding(repo, request.findingId);
        const lifecycleMetadata = commandLifecycleMetadata(repo.id, request);
        const emitGitLifecycle = makeGitLifecycleEmitter(onStream, lifecycleMetadata);
        return yield* runFindingCommandLocked(
          repo.id,
          request.findingId,
          worktreePath,
          Effect.gen(function* () {
            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "fix:clean-check",
              message: "Checking registered checkout is clean.",
              cwd: repo.path,
            });
            yield* git.requireCleanCheckout(repo.path, emitGitLifecycle);
            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "fix:clean-ready",
              message: "Registered checkout is clean.",
              cwd: repo.path,
            });

            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "fix:worktree-prepare",
              message: `Preparing managed worktree at ${worktreePath}.`,
              cwd: repo.path,
            });
            const createdWorktreePath = yield* createManagedWorktree(
              repo,
              request.findingId,
              emitGitLifecycle,
            );
            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "fix:worktree-ready",
              message: `Managed worktree ready at ${createdWorktreePath}.`,
              cwd: createdWorktreePath,
            });

            if (status !== undefined) {
              emitLifecycle(onStream, lifecycleMetadata, {
                phase: "fix:triage-start",
                message: "Saving triage guidance before fix.",
                cwd: createdWorktreePath,
              });
              yield* runCommandAtPath(
                repo.id,
                createdWorktreePath,
                {
                  command: "triage",
                  findingId: request.findingId,
                  status,
                  note,
                },
                onStream,
                request.findingId,
              );
              emitLifecycle(onStream, lifecycleMetadata, {
                phase: "fix:triage-ready",
                message: "Triage guidance saved before fix.",
                cwd: createdWorktreePath,
              });
            }

            const result = yield* runCommandAtPath(
              repo.id,
              createdWorktreePath,
              { command: "fix", findingId: request.findingId },
              onStream,
              request.findingId,
            );
            if (result.exitCode === 0) {
              emitLifecycle(onStream, lifecycleMetadata, {
                phase: "fix:revalidate-start",
                message: "Fix completed; starting revalidation.",
                cwd: createdWorktreePath,
              });
              const revalidateResult = yield* runCommandAtPath(
                repo.id,
                createdWorktreePath,
                { command: "revalidate", findingId: request.findingId },
                onStream,
                request.findingId,
              );
              return { ...result, relatedResults: [revalidateResult] };
            }
            return result;
          }),
        );
      });

      const runRevalidateInManagedWorktree = Effect.fn(
        "repoService.runRevalidateInManagedWorktree",
      )(function* (
        repo: Pick<RepoSummary, "id" | "path">,
        request: Extract<ClawpatchCommandRequest, { command: "revalidate" }>,
        onStream?: (event: CommandStreamEvent) => void,
      ) {
        const { worktreePath } = managedWorktreeForFinding(repo, request.findingId);
        const lifecycleMetadata = commandLifecycleMetadata(repo.id, request);
        const emitGitLifecycle = makeGitLifecycleEmitter(onStream, lifecycleMetadata);
        return yield* runFindingCommandLocked(
          repo.id,
          request.findingId,
          worktreePath,
          Effect.gen(function* () {
            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "revalidate:worktree-prepare",
              message: `Preparing managed worktree at ${worktreePath}.`,
              cwd: repo.path,
            });
            const createdWorktreePath = yield* createManagedWorktree(
              repo,
              request.findingId,
              emitGitLifecycle,
            );
            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "revalidate:worktree-ready",
              message: `Managed worktree ready at ${createdWorktreePath}.`,
              cwd: createdWorktreePath,
            });
            return yield* runCommandAtPath(
              repo.id,
              createdWorktreePath,
              request,
              onStream,
              request.findingId,
            );
          }),
        );
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
                name: path.basename(normalized),
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
          const repoMetadata = yield* metadata.read(repo.id, repo.path);
          const [summary, diff] = yield* Effect.all([
            summarizeRepo(repo.path, repo.id),
            git.readDiff(repo.path),
          ]);
          const findings = yield* readFindingListWithActiveWorktrees(repo.id, repo.path);
          return {
            repo: {
              ...summary,
              findingCount: findings.length,
              openFindingCount: findings.filter((item) => item.status === "open").length,
            },
            status:
              summary.lastError === null &&
              !(yield* isRepoCommandRunning(repo.id)) &&
              !(yield* hasRunningFindingCommand(repo.id))
                ? (yield* runner.run(repo.path, { command: "status" })).parsedJson
                : null,
            findings,
            diff,
            metadata: repoMetadata,
          };
        }),
        listFindings: Effect.fn("repoService.listFindings")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* readFindingListWithActiveWorktrees(repo.id, repo.path);
        }),
        readFeatureMap: Effect.fn("repoService.readFeatureMap")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* state.readFeatureMap(repo.path);
        }),
        getFinding: Effect.fn("repoService.getFinding")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* state.readFindingDetail(
            (yield* activeWorktreePathForFinding(repo.id, findingId)) ?? repo.path,
            findingId,
          );
        }),
        runCommand: Effect.fn("repoService.runCommand")(function* (repoIdValue, request, onStream) {
          const repo = yield* requireRepo(repoIdValue);
          if (request.command === "fix") {
            return yield* runFixInManagedWorktree(repo, request, onStream);
          }
          if (request.command === "revalidate") {
            return yield* runRevalidateInManagedWorktree(repo, request, onStream);
          }
          return yield* runTrackedRepoCommand(repo.id, repo.path, request, onStream);
        }),
        interruptCommand: Effect.fn("repoService.interruptCommand")(
          function* (repoIdValue, findingId) {
            const repo = yield* requireRepo(repoIdValue);
            if (findingId !== undefined) {
              return yield* runner.interrupt(
                (yield* findingCommandPath(repo.id, findingId)) ??
                  (yield* activeWorktreePathForFinding(repo.id, findingId)) ??
                  repo.path,
              );
            }
            return yield* runner.interrupt((yield* repoCommandPathForRepo(repo.id)) ?? repo.path);
          },
        ),
        setTriage: Effect.fn("repoService.setTriage")(function* (
          repoIdValue,
          findingId,
          status,
          note = "",
        ) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* runTrackedRepoCommand(
            repo.id,
            repo.path,
            {
              command: "triage",
              findingId,
              status,
              note,
            },
            undefined,
          );
        }),
        readDiff: Effect.fn("repoService.readDiff")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* git.readDiff(
            (yield* activeWorktreePathForFinding(repo.id, findingId)) ?? repo.path,
          );
        }),
        readGitStatus: Effect.fn("repoService.readGitStatus")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* git.readStatus(
            (yield* activeWorktreePathForFinding(repo.id, findingId)) ?? repo.path,
          );
        }),
      });
    }),
  );

function expandHomePath(inputPath: string, path: Path.Path): string {
  if (inputPath === "~") {
    return homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.resolve(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function repoId(repoPath: string): string {
  return createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}

function commandLifecycleMetadata(
  repoId: string,
  request: ClawpatchCommandRequest,
): {
  readonly runId: string;
  readonly repoId: string;
  readonly findingId?: string;
  readonly command: string;
} {
  return {
    runId: randomUUID(),
    repoId,
    findingId: "findingId" in request ? request.findingId : undefined,
    command: request.command,
  };
}

function makeGitLifecycleEmitter(
  onStream: ((event: CommandStreamEvent) => void) | undefined,
  metadata: ReturnType<typeof commandLifecycleMetadata>,
): (event: GitLifecycleEvent) => void {
  return (event) =>
    emitLifecycle(onStream, metadata, {
      phase: event.phase,
      message: event.message,
      cwd: event.cwd,
      argv: event.argv,
    });
}

function emitLifecycle(
  onStream: ((event: CommandStreamEvent) => void) | undefined,
  metadata: ReturnType<typeof commandLifecycleMetadata>,
  event: {
    readonly phase: string;
    readonly message: string;
    readonly cwd: string;
    readonly argv?: readonly string[];
  },
): void {
  onStream?.({
    kind: "lifecycle",
    runId: metadata.runId,
    repoId: metadata.repoId,
    findingId: metadata.findingId,
    command: metadata.command,
    phase: event.phase,
    message: event.message,
    cwd: event.cwd,
    argv: event.argv === undefined ? undefined : [...event.argv],
  });
}

function findingCommandKey(repoIdValue: string, findingId: string): string {
  return `${repoIdValue}\0${findingId}`;
}

function sanitizeWorktreeFragment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80)
    .replace(/[._-]+$/g, "");
  return sanitized.length > 0 ? sanitized : "finding";
}
