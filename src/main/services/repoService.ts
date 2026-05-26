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
  AppSettings,
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandInterruptResult,
  CommandResult,
  CommandStreamEvent,
  FeatureMapSnapshot,
  FindingDetail,
  FindingListItem,
  FindingWorkStatus,
  GitStatusSummary,
  PublishFixResult,
  RepoSettings,
  RepoSnapshot,
  RepoSummary,
  TerminalOpenResult,
} from "../../shared/types";
import { emitCommandStream } from "../commandStream";
import { catchAll } from "../effectCompat";
import {
  CommandAlreadyRunningError,
  CommandExecutionError,
  CommandSpawnError,
  CommandValidationError,
  InvalidRepoPathError,
  RepoNotFoundError,
} from "../errors";
import { ClawpatchRunner, type ClawpatchRunnerError } from "./clawpatchRunner";
import {
  ClawpatchStateService,
  type ClawpatchStateError,
  type ClawpatchStateServiceShape,
} from "./clawpatchState";
import { GitService, type GitLifecycleEvent } from "./gitService";
import { AppSettingsService, type AppSettingsError } from "./appSettings";
import { RepoSettingsService, type RepoSettingsError } from "./repoSettings";
import { SetupScriptRunner, type SetupScriptRunnerShape } from "./setupScriptRunner";
import { TerminalLauncher, type TerminalLauncherError } from "./terminalLauncher";
import { UiMetadataService, type UiMetadataError } from "./uiMetadata";

interface RegistryRepo {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly updatedAt?: string;
}

interface RegistryFile {
  repos: RegistryRepo[];
}

const TARGET_BASE_REF = "origin/main";
const REPO_SERVICE_COLLECTION_CONCURRENCY = 4;

type ActiveWorktreePaths = Map<string, Map<string, string>>;
type RunningCommandPaths = Map<string, string>;

export type RepoServiceError =
  | InvalidRepoPathError
  | RepoNotFoundError
  | CommandValidationError
  | CommandExecutionError
  | CommandSpawnError
  | ClawpatchRunnerError
  | ClawpatchStateError
  | TerminalLauncherError
  | AppSettingsError
  | RepoSettingsError
  | UiMetadataError;

export interface RepoServiceShape {
  readonly getAppSettings: () => Effect.Effect<AppSettings, RepoServiceError>;
  readonly updateAppSettings: (
    settings: AppSettings,
  ) => Effect.Effect<AppSettings, RepoServiceError>;
  readonly listRepos: () => Effect.Effect<RepoSummary[], RepoServiceError>;
  readonly addRepo: (repoPath: string) => Effect.Effect<RepoSummary, RepoServiceError>;
  readonly refreshRepo: (repoId: string) => Effect.Effect<RepoSnapshot, RepoServiceError>;
  readonly doctor: (repoId: string) => Effect.Effect<CommandResult, RepoServiceError>;
  readonly getSettings: (repoId: string) => Effect.Effect<RepoSettings, RepoServiceError>;
  readonly updateSettings: (
    repoId: string,
    settings: RepoSettings,
  ) => Effect.Effect<RepoSettings, RepoServiceError>;
  readonly listFindings: (repoId: string) => Effect.Effect<FindingListItem[], RepoServiceError>;
  readonly listFindingWorkStatuses: (
    repoId: string,
  ) => Effect.Effect<FindingWorkStatus[], RepoServiceError>;
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
  readonly publishFix: (
    repoId: string,
    findingId: string,
  ) => Effect.Effect<PublishFixResult, RepoServiceError>;
  readonly openTerminal: (
    repoId: string,
    findingId?: string,
  ) => Effect.Effect<TerminalOpenResult, RepoServiceError>;
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
      const appSettings = yield* AppSettingsService;
      const repoSettings = yield* RepoSettingsService;
      const git = yield* GitService;
      const setupScripts = yield* SetupScriptRunner;
      const terminal = yield* TerminalLauncher;
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
          .pipe(catchAll(() => Effect.succeed(null)));
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
        }).pipe(catchAll(() => Effect.succeed({ repos: [] } satisfies RegistryFile)));
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
        registryUpdatedAt: string | undefined,
      ) {
        const activeWorktrees = yield* activeWorktreesForRepo(id, repoPath);
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
              catchAll((error: unknown) =>
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
          updatedAt: latestFindingUpdatedAt(findings, registryUpdatedAt),
        } satisfies RepoSummary;
      });

      const discoverActiveWorktreesForRepo = Effect.fn(
        "repoService.discoverActiveWorktreesForRepo",
      )(function* (repoIdValue: string, repoPath: string) {
        const worktreesRoot = path.join(appDataDir, "worktrees", repoIdValue);
        const names = yield* fs
          .readDirectory(worktreesRoot)
          .pipe(catchAll(() => Effect.succeed([])));
        const entries = yield* Effect.all(
          names.toSorted().map((name) =>
            Effect.gen(function* () {
              const slug = path.basename(name);
              if (slug !== name || slug === "") {
                return null;
              }

              const worktreePath = path.join(worktreesRoot, slug);
              const stats = yield* fs.stat(worktreePath).pipe(catchAll(() => Effect.succeed(null)));
              if (stats?.type !== "Directory") {
                return null;
              }

              const findings = yield* state
                .readFindingList(worktreePath)
                .pipe(catchAll(() => Effect.succeed([])));
              const finding = findings.find(
                (item) => sanitizeWorktreeFragment(item.findingId) === slug,
              );
              if (finding === undefined) {
                return null;
              }
              const isRetired = yield* isManagedWorktreeRetired(
                { id: repoIdValue, path: repoPath },
                finding.findingId,
                worktreePath,
              );
              if (isRetired) {
                return null;
              }
              return [finding.findingId, worktreePath] as const;
            }),
          ),
          { concurrency: REPO_SERVICE_COLLECTION_CONCURRENCY },
        );

        return new Map(
          entries.filter((entry): entry is readonly [string, string] => entry !== null),
        );
      });

      const hydrateDiscoveredWorktreesForRepo = Effect.fn(
        "repoService.hydrateDiscoveredWorktreesForRepo",
      )(function* (repoIdValue: string, repoPath: string) {
        const discovered = yield* discoverActiveWorktreesForRepo(repoIdValue, repoPath);
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

      const pruneRetiredActiveWorktreesForRepo = Effect.fn(
        "repoService.pruneRetiredActiveWorktreesForRepo",
      )(function* (repoIdValue: string, repoPath: string) {
        const paths = yield* Ref.get(activeWorktreePaths);
        const repoWorktrees = paths.get(repoIdValue);
        if (repoWorktrees === undefined || repoWorktrees.size === 0) {
          return;
        }

        const retiredFindingIds = yield* Effect.all(
          [...repoWorktrees.entries()].map(([findingId, worktreePath]) =>
            isManagedWorktreeRetired(
              { id: repoIdValue, path: repoPath },
              findingId,
              worktreePath,
            ).pipe(Effect.map((isRetired) => (isRetired ? findingId : null))),
          ),
          { concurrency: REPO_SERVICE_COLLECTION_CONCURRENCY },
        );
        const retired = new Set(
          retiredFindingIds.filter((findingId): findingId is string => findingId !== null),
        );
        if (retired.size === 0) {
          return;
        }

        yield* Ref.update(activeWorktreePaths, (currentPaths) => {
          const nextPaths = new Map(currentPaths);
          const nextRepoWorktrees = new Map(nextPaths.get(repoIdValue));
          for (const findingId of retired) {
            nextRepoWorktrees.delete(findingId);
          }
          if (nextRepoWorktrees.size === 0) {
            nextPaths.delete(repoIdValue);
          } else {
            nextPaths.set(repoIdValue, nextRepoWorktrees);
          }
          return nextPaths;
        });
      });

      const activeWorktreesForRepo = Effect.fn("repoService.activeWorktreesForRepo")(function* (
        repoIdValue: string,
        repoPath: string,
      ) {
        yield* hydrateDiscoveredWorktreesForRepo(repoIdValue, repoPath);
        yield* pruneRetiredActiveWorktreesForRepo(repoIdValue, repoPath);
        const paths = yield* Ref.get(activeWorktreePaths);
        return [...(paths.get(repoIdValue)?.entries() ?? [])]
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([findingId, path]) => ({
            findingId,
            path,
          }));
      });

      const activeWorktreePathForFinding = Effect.fn("repoService.activeWorktreePathForFinding")(
        function* (repoIdValue: string, repoPath: string, findingId: string | undefined) {
          if (findingId === undefined) {
            return null;
          }
          yield* hydrateDiscoveredWorktreesForRepo(repoIdValue, repoPath);
          yield* pruneRetiredActiveWorktreesForRepo(repoIdValue, repoPath);
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

      const isFindingCommandRunning = Effect.fn("repoService.isFindingCommandRunning")(function* (
        repoIdValue: string,
        findingId: string,
      ) {
        const paths = yield* Ref.get(runningFindingCommandPaths);
        return paths.has(findingCommandKey(repoIdValue, findingId));
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

      const isManagedWorktreeRetired = Effect.fn("repoService.isManagedWorktreeRetired")(function* (
        repo: Pick<RepoSummary, "id" | "path">,
        findingId: string,
        worktreePath: string,
      ) {
        if (yield* isFindingCommandRunning(repo.id, findingId)) {
          return false;
        }

        const { branchName } = managedWorktreeForFinding(repo, findingId);
        const status = yield* git
          .readStatus(worktreePath)
          .pipe(catchAll(() => Effect.succeed(null)));
        if (
          status === null ||
          status.branch !== branchName ||
          status.staged + status.modified + status.untracked > 0
        ) {
          return false;
        }

        return yield* git
          .isBranchAppliedToBase({
            repoPath: repo.path,
            branchName,
            baseRef: TARGET_BASE_REF,
          })
          .pipe(catchAll(() => Effect.succeed(false)));
      });

      const readFindingListWithActiveWorktrees = Effect.fn(
        "repoService.readFindingListWithActiveWorktrees",
      )(function* (repoIdValue: string, repoPath: string) {
        const baseFindings = yield* state
          .readFindingList(repoPath)
          .pipe(catchAll(() => Effect.succeed([])));
        const byId = new Map(baseFindings.map((finding) => [finding.findingId, finding]));
        const activeWorktrees = yield* activeWorktreesForRepo(repoIdValue, repoPath);

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
              catchAll(() => Effect.succeed([])),
            ),
          ),
          { concurrency: REPO_SERVICE_COLLECTION_CONCURRENCY },
        );

        return [...byId.values()];
      });

      const newestPrUrlForFinding = Effect.fn("repoService.newestPrUrlForFinding")(function* (
        repoPath: string,
        worktreePath: string,
        findingId: string,
      ) {
        const detail = yield* state.readFindingDetail(worktreePath, findingId).pipe(
          catchAll(() => state.readFindingDetail(repoPath, findingId)),
          catchAll(() => Effect.succeed(null)),
        );
        return detail?.patchAttempts.find((patch) => patch.git.prUrl !== null)?.git.prUrl ?? null;
      });

      const workStatusForActiveWorktree = Effect.fn("repoService.workStatusForActiveWorktree")(
        function* (repoPath: string, findingId: string, worktreePath: string) {
          const [statusResult, prUrl] = yield* Effect.all([
            git.readStatus(worktreePath).pipe(
              Effect.match({
                onFailure: (error) => ({
                  gitStatus: null,
                  error: errorMessage(error),
                }),
                onSuccess: (gitStatus) => ({
                  gitStatus,
                  error: null,
                }),
              }),
            ),
            newestPrUrlForFinding(repoPath, worktreePath, findingId),
          ]);

          return {
            findingId,
            worktreePath,
            gitStatus: statusResult.gitStatus,
            prUrl,
            error: statusResult.error,
          } satisfies FindingWorkStatus;
        },
      );

      const runCommandAtPath = Effect.fn("repoService.runCommandAtPath")(function* (
        repoIdValue: string,
        commandPath: string,
        request: ClawpatchCommandRequest,
        onStream?: (event: CommandStreamEvent) => void,
        findingId?: string,
      ) {
        return yield* runner.run(commandPath, request, (event) =>
          emitCommandStream(onStream, {
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

      const runFindingCommandLocked = Effect.fn("repoService.runFindingCommandLocked")(function* <
        A,
      >(
        repoIdValue: string,
        findingId: string,
        commandPath: string,
        effect: Effect.Effect<A, RepoServiceError>,
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

      const publishFixWorktree = Effect.fn("repoService.publishFixWorktree")(function* (
        repo: Pick<RepoSummary, "id" | "path">,
        findingId: string,
      ) {
        const activeWorktreePath = yield* activeWorktreePathForFinding(
          repo.id,
          repo.path,
          findingId,
        );
        if (activeWorktreePath === null) {
          return yield* new CommandValidationError({
            message: "Run fix before publishing a PR for this finding.",
          });
        }

        const { branchName } = managedWorktreeForFinding(repo, findingId);
        return yield* runFindingCommandLocked(
          repo.id,
          findingId,
          activeWorktreePath,
          Effect.gen(function* () {
            const [findingTitle, registeredStatus] = yield* Effect.all([
              readFindingTitleForCommit(state, activeWorktreePath, repo.path, findingId),
              git.readStatus(repo.path),
            ]);
            return yield* git.publishFix({
              repoPath: repo.path,
              worktreePath: activeWorktreePath,
              branchName,
              baseBranch: registeredStatus.branch,
              commitMessage: `Fix ${sanitizeCommitSubject(findingTitle)}`,
            });
          }),
        );
      });

      const createManagedWorktree = Effect.fn("repoService.createManagedWorktree")(function* (
        repo: Pick<RepoSummary, "id" | "path">,
        findingId: string,
        onLifecycle?: (event: GitLifecycleEvent) => void,
      ) {
        const { worktreePath, branchName } = managedWorktreeForFinding(repo, findingId);
        const result = yield* git.createOrReuseWorktree(
          { repoPath: repo.path, worktreePath, branchName, baseRef: TARGET_BASE_REF },
          onLifecycle,
        );
        yield* setActiveWorktreePath(repo.id, findingId, worktreePath);
        return result;
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
        const settings = yield* repoSettings.read(repo.id);
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
            const worktree = yield* createManagedWorktree(
              repo,
              request.findingId,
              emitGitLifecycle,
            );
            yield* runWorktreeSetupIfNeeded(
              setupScripts,
              worktree.worktreePath,
              worktree.created,
              settings.worktreeSetupScript,
              lifecycleMetadata,
              onStream,
            );
            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "fix:worktree-ready",
              message: `Managed worktree ready at ${worktree.worktreePath}.`,
              cwd: worktree.worktreePath,
            });

            if (status !== undefined) {
              emitLifecycle(onStream, lifecycleMetadata, {
                phase: "fix:triage-start",
                message: "Saving triage guidance before fix.",
                cwd: worktree.worktreePath,
              });
              yield* runCommandAtPath(
                repo.id,
                worktree.worktreePath,
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
                cwd: worktree.worktreePath,
              });
            }

            const result = yield* runCommandAtPath(
              repo.id,
              worktree.worktreePath,
              { command: "fix", findingId: request.findingId },
              onStream,
              request.findingId,
            );
            if (result.exitCode === 0) {
              emitLifecycle(onStream, lifecycleMetadata, {
                phase: "fix:revalidate-start",
                message: "Fix completed; starting revalidation.",
                cwd: worktree.worktreePath,
              });
              const revalidateResult = yield* runCommandAtPath(
                repo.id,
                worktree.worktreePath,
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
        const settings = yield* repoSettings.read(repo.id);
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
            const worktree = yield* createManagedWorktree(
              repo,
              request.findingId,
              emitGitLifecycle,
            );
            yield* runWorktreeSetupIfNeeded(
              setupScripts,
              worktree.worktreePath,
              worktree.created,
              settings.worktreeSetupScript,
              lifecycleMetadata,
              onStream,
            );
            emitLifecycle(onStream, lifecycleMetadata, {
              phase: "revalidate:worktree-ready",
              message: `Managed worktree ready at ${worktree.worktreePath}.`,
              cwd: worktree.worktreePath,
            });
            return yield* runCommandAtPath(
              repo.id,
              worktree.worktreePath,
              request,
              onStream,
              request.findingId,
            );
          }),
        );
      });

      return RepoService.of({
        getAppSettings: Effect.fn("repoService.getAppSettings")(function* () {
          return yield* appSettings.read();
        }),
        updateAppSettings: Effect.fn("repoService.updateAppSettings")(function* (settings) {
          return yield* appSettings.write(settings);
        }),
        listRepos: Effect.fn("repoService.listRepos")(function* () {
          const registry = yield* readRegistry();
          return yield* Effect.all(
            registry.repos.map((repo) => summarizeRepo(repo.path, repo.id, repo.updatedAt)),
            { concurrency: REPO_SERVICE_COLLECTION_CONCURRENCY },
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
          return yield* summarizeRepo(repo.path, repo.id, repo.updatedAt);
        }),
        refreshRepo: Effect.fn("repoService.refreshRepo")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          const repoMetadata = yield* metadata.read(repo.id, repo.path);
          const [summary, diff] = yield* Effect.all([
            summarizeRepo(repo.path, repo.id, repo.updatedAt),
            git.readDiff(repo.path),
          ]);
          const findings = yield* readFindingListWithActiveWorktrees(repo.id, repo.path);
          return {
            repo: {
              ...summary,
              findingCount: findings.length,
              openFindingCount: findings.filter((item) => item.status === "open").length,
            },
            findings,
            diff,
            metadata: repoMetadata,
          };
        }),
        getSettings: Effect.fn("repoService.getSettings")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* repoSettings.read(repo.id);
        }),
        doctor: Effect.fn("repoService.doctor")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* runTrackedRepoCommand(repo.id, repo.path, { command: "doctor" });
        }),
        updateSettings: Effect.fn("repoService.updateSettings")(function* (repoIdValue, settings) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* repoSettings.write(repo.id, settings);
        }),
        listFindings: Effect.fn("repoService.listFindings")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* readFindingListWithActiveWorktrees(repo.id, repo.path);
        }),
        listFindingWorkStatuses: Effect.fn("repoService.listFindingWorkStatuses")(
          function* (repoIdValue) {
            const repo = yield* requireRepo(repoIdValue);
            const activeWorktrees = yield* activeWorktreesForRepo(repo.id, repo.path);
            return yield* Effect.all(
              activeWorktrees.map(({ findingId, path: worktreePath }) =>
                workStatusForActiveWorktree(repo.path, findingId, worktreePath),
              ),
              { concurrency: REPO_SERVICE_COLLECTION_CONCURRENCY },
            );
          },
        ),
        readFeatureMap: Effect.fn("repoService.readFeatureMap")(function* (repoIdValue) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* state.readFeatureMap(repo.path);
        }),
        getFinding: Effect.fn("repoService.getFinding")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* state.readFindingDetail(
            (yield* activeWorktreePathForFinding(repo.id, repo.path, findingId)) ?? repo.path,
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
                  (yield* activeWorktreePathForFinding(repo.id, repo.path, findingId)) ??
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
          const result = yield* runTrackedRepoCommand(
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
          if (result.exitCode !== 0) {
            return yield* new CommandExecutionError({
              command: "triage",
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            });
          }
          return result;
        }),
        readDiff: Effect.fn("repoService.readDiff")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* git.readDiff(
            (yield* activeWorktreePathForFinding(repo.id, repo.path, findingId)) ?? repo.path,
          );
        }),
        readGitStatus: Effect.fn("repoService.readGitStatus")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* git.readStatus(
            (yield* activeWorktreePathForFinding(repo.id, repo.path, findingId)) ?? repo.path,
          );
        }),
        publishFix: Effect.fn("repoService.publishFix")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          return yield* publishFixWorktree(repo, findingId);
        }),
        openTerminal: Effect.fn("repoService.openTerminal")(function* (repoIdValue, findingId) {
          const repo = yield* requireRepo(repoIdValue);
          const appSettingsValue = yield* appSettings.read();
          const repoSettingsValue = yield* repoSettings.read(repo.id);
          return yield* terminal.open(
            (yield* activeWorktreePathForFinding(repo.id, repo.path, findingId)) ?? repo.path,
            {
              appName: appSettingsValue.terminalAppPath ?? appSettingsValue.terminalAppName,
              startupScript: repoSettingsValue.terminalStartupScript,
            },
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

function latestFindingUpdatedAt(
  findings: readonly FindingListItem[],
  fallbackUpdatedAt: string | undefined,
): string {
  if (findings.length === 0) {
    return fallbackUpdatedAt ?? new Date(0).toISOString();
  }
  let latestTimestamp = 0;
  let latestUpdatedAt = findings[0]?.updatedAt ?? new Date(0).toISOString();
  for (const finding of findings) {
    const findingTimestamp = timestamp(finding.updatedAt);
    if (findingTimestamp > latestTimestamp) {
      latestTimestamp = findingTimestamp;
      latestUpdatedAt = finding.updatedAt;
    }
  }
  return latestUpdatedAt;
}

function timestamp(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  emitCommandStream(onStream, {
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

function runWorktreeSetupIfNeeded(
  setupScripts: SetupScriptRunnerShape,
  worktreePath: string,
  created: boolean,
  script: string,
  metadata: ReturnType<typeof commandLifecycleMetadata>,
  onStream?: (event: CommandStreamEvent) => void,
): Effect.Effect<CommandResult | void, CommandSpawnError> {
  if (!created || script.trim() === "") {
    return Effect.void;
  }
  return setupScripts.run(worktreePath, script, metadata, onStream);
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

function readFindingTitleForCommit(
  state: ClawpatchStateServiceShape,
  worktreePath: string,
  repoPath: string,
  findingId: string,
): Effect.Effect<string, never> {
  return state.readFindingDetail(worktreePath, findingId).pipe(
    catchAll(() => state.readFindingDetail(repoPath, findingId)),
    Effect.map((finding) => finding.title),
    catchAll(() => Effect.succeed(findingId)),
  );
}

function sanitizeCommitSubject(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim() || "finding";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
