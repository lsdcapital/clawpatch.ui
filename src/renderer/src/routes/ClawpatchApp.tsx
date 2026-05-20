import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  FindingListItem,
  RepoSummary,
} from "../../../shared/types";
import { extractDiffFilePaths } from "../components/DiffViewer";
import { FindingsSplitPanel } from "../components/FindingsSplitPanel";
import { GitStatusStrip } from "../components/GitStatusStrip";
import { RepoSidebar } from "../components/RepoSidebar";
import { ReviewMapPanel } from "../components/ReviewMapPanel";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { WorkspaceInspector } from "../components/WorkspaceInspector";
import {
  defaultFindingFilters,
  defaultFindingSort,
  filterFindings,
  getFindingFilterOptions,
  resolveSelectedFindingId,
  sortFindings,
} from "../findingsFilters";
import { useSelectedRepo } from "../hooks/useSelectedRepo";
import type { ActiveInspector, ActiveWorkspace, CommandLogEntry } from "../workspaceTypes";
import { clawpatchStatuses } from "../../../shared/constants";

type FindingCommandRequest = Extract<ClawpatchCommandRequest, { command: "fix" | "revalidate" }>;
type RunningRepoCommand = {
  request: ClawpatchCommandRequest;
  invocationId: string;
};
type RunningFindingCommand = {
  request: FindingCommandRequest;
  invocationId: string;
};
const GIT_STATUS_REFETCH_INTERVAL_MS = 5_000;
const REPO_SIDEBAR_ID = "repo-sidebar";
const REPO_SIDEBAR_COLLAPSED_STORAGE_KEY = "clawpatch.repoSidebarCollapsed.v1";

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("findings");
  const [activeInspector, setActiveInspector] = useState<ActiveInspector>(null);
  const [findingFilters, setFindingFilters] = useState(defaultFindingFilters);
  const [findingSort, setFindingSort] = useState(defaultFindingSort);
  const [isRepoSidebarCollapsed, setIsRepoSidebarCollapsed] = useState(readStoredSidebarState);
  const [diffJump, setDiffJump] = useState<{ path: string; epoch: number } | null>(null);
  const [runningRepoCommand, setRunningRepoCommand] = useState<RunningRepoCommand | null>(null);
  const [runningFindingCommands, setRunningFindingCommands] = useState<
    Record<string, RunningFindingCommand>
  >({});
  const commandInvocationSeqRef = useRef(0);
  const runningRepoCommandRef = useRef<RunningRepoCommand | null>(null);
  const runningFindingCommandsRef = useRef<Record<string, RunningFindingCommand>>({});

  const reposQuery = useQuery({
    queryKey: ["repos"],
    queryFn: () => window.clawpatch.repo.list(),
  });

  const { selectedRepo, selectRepo } = useSelectedRepo(reposQuery.data);

  const findingsQuery = useQuery({
    queryKey: ["findings", selectedRepo?.id],
    queryFn: () => window.clawpatch.findings.list(selectedRepo!.id),
    enabled: selectedRepo !== null,
  });

  const allFindings = useMemo(() => findingsQuery.data ?? [], [findingsQuery.data]);
  const filteredFindings = useMemo(
    () => filterFindings(allFindings, findingFilters),
    [allFindings, findingFilters],
  );
  const sortedFindings = useMemo(
    () => sortFindings(filteredFindings, findingSort),
    [filteredFindings, findingSort],
  );
  const findingFilterOptions = useMemo(
    () => getFindingFilterOptions(allFindings, clawpatchStatuses),
    [allFindings],
  );

  const featureMapQuery = useQuery({
    queryKey: ["features", selectedRepo?.id],
    queryFn: () => window.clawpatch.features.map(selectedRepo!.id),
    enabled: selectedRepo !== null,
  });

  const selectedFinding = useMemo(
    () =>
      sortedFindings.find((finding) => finding.findingId === selectedFindingId) ??
      sortedFindings[0] ??
      null,
    [selectedFindingId, sortedFindings],
  );
  const selectedFindingWorktree = useMemo(
    () =>
      selectedRepo?.activeWorktrees.find(
        (worktree) => worktree.findingId === selectedFinding?.findingId,
      ) ?? null,
    [selectedFinding?.findingId, selectedRepo?.activeWorktrees],
  );
  const selectedFindingIdForWorkspace = selectedFinding?.findingId;
  const selectedFindingCommand =
    selectedFindingIdForWorkspace === undefined
      ? undefined
      : runningFindingCommands[selectedFindingIdForWorkspace];
  const firstRunningFindingId = Object.keys(runningFindingCommands)[0];
  const isSelectedFindingRunning = selectedFindingCommand !== undefined;

  useEffect(() => {
    if (findingsQuery.data === undefined) {
      return;
    }
    const nextSelectedFindingId = resolveSelectedFindingId(selectedFindingId, sortedFindings);
    if (nextSelectedFindingId !== selectedFindingId) {
      setSelectedFindingId(nextSelectedFindingId);
    }
  }, [findingsQuery.data, selectedFindingId, sortedFindings]);

  const detailQuery = useQuery({
    queryKey: ["finding", selectedRepo?.id, selectedFinding?.findingId],
    queryFn: () => window.clawpatch.findings.get(selectedRepo!.id, selectedFinding!.findingId),
    enabled: selectedRepo !== null && selectedFinding !== null,
  });

  const diffQuery = useQuery({
    queryKey: ["diff", selectedRepo?.id, selectedFinding?.findingId],
    queryFn: () => window.clawpatch.git.diff(selectedRepo!.id, selectedFinding?.findingId),
    enabled: selectedRepo !== null,
  });

  const filesInDiff = useMemo(() => extractDiffFilePaths(diffQuery.data ?? ""), [diffQuery.data]);

  const gitStatusQuery = useQuery({
    queryKey: ["gitStatus", selectedRepo?.id, selectedFinding?.findingId],
    queryFn: () => window.clawpatch.git.status(selectedRepo!.id, selectedFinding?.findingId),
    enabled: selectedRepo !== null,
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const registeredCheckoutStatusQuery = useQuery({
    queryKey: ["gitStatus", selectedRepo?.id, "registeredCheckout"],
    queryFn: () => window.clawpatch.git.status(selectedRepo!.id),
    enabled: selectedRepo !== null,
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const fixDisabledReason = useMemo(() => {
    if (selectedRepo === null) {
      return null;
    }
    if (registeredCheckoutStatusQuery.isError) {
      return "Unable to verify registered checkout status.";
    }
    const status = registeredCheckoutStatusQuery.data;
    if (status === undefined) {
      return "Checking registered checkout...";
    }
    const dirtyCount = status.staged + status.modified + status.untracked;
    return dirtyCount > 0
      ? "Commit, stash, or discard registered checkout changes before running fix."
      : null;
  }, [registeredCheckoutStatusQuery.data, registeredCheckoutStatusQuery.isError, selectedRepo]);

  useEffect(() => {
    return window.clawpatch.commands.onStream((event) => {
      setCommandLog((current) => [...current, { kind: "stream", event }]);
      void invalidateCommandProgress(queryClient);
    });
  }, [queryClient]);

  const addRepoMutation = useMutation({
    mutationFn: (repoPath: string) => window.clawpatch.repo.add(repoPath),
    onSuccess: (repo) => {
      selectRepo(repo.id);
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });

  const commandInterruptMutation = useMutation({
    mutationFn: ({ repo, findingId }: { repo: RepoSummary; findingId?: string }) =>
      window.clawpatch.commands.interrupt(repo.id, findingId),
    onError: (error) => {
      setCommandLog((current) => [
        ...current,
        { kind: "error", message: error instanceof Error ? error.message : String(error) },
      ]);
    },
  });

  const triageMutation = useMutation({
    mutationFn: ({
      repo,
      finding,
      status,
      note,
    }: {
      repo: RepoSummary;
      finding: FindingListItem;
      status: ClawpatchStatus;
      note: string;
    }) => window.clawpatch.triage.set(repo.id, finding.findingId, status, note),
    onSuccess: (result, variables) => {
      setCommandLog((current) => [
        ...current,
        {
          kind: "result",
          result,
          repoId: variables.repo.id,
          findingId: variables.finding.findingId,
          command: "triage",
        },
      ]);
      void invalidateRepo(queryClient, selectedRepo?.id ?? null);
    },
    onError: (error) => {
      setCommandLog((current) => [
        ...current,
        { kind: "error", message: error instanceof Error ? error.message : String(error) },
      ]);
    },
  });

  const isAnyCommandRunning =
    runningRepoCommand !== null ||
    Object.keys(runningFindingCommands).length > 0 ||
    triageMutation.isPending;
  const isRepoCommandBusy = runningRepoCommand !== null || triageMutation.isPending;

  useEffect(() => {
    if (!isAnyCommandRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void invalidateCommandProgress(queryClient);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isAnyCommandRunning, queryClient]);

  const runCommand = (request: ClawpatchCommandRequest): void => {
    if (selectedRepo === null) {
      return;
    }
    const repo = selectedRepo;
    setActiveInspector("output");
    if (request.command === "fix" || request.command === "revalidate") {
      runFindingCommand(repo, request);
      return;
    }
    runRepoCommand(repo, request);
  };

  const runRepoCommand = (repo: RepoSummary, request: ClawpatchCommandRequest): void => {
    if (runningRepoCommandRef.current !== null) {
      return;
    }
    const runningCommand = { request, invocationId: nextCommandInvocationId() };
    runningRepoCommandRef.current = runningCommand;
    setRunningRepoCommand(runningCommand);
    void window.clawpatch.commands
      .run(repo.id, request)
      .then((result) => {
        appendCommandResults(repo.id, request, result);
        void refreshAfterCommand(queryClient, repo.id, request, setActiveInspector, setDiffJump);
      })
      .catch((error: unknown) => {
        appendCommandError(repo.id, request, error);
      })
      .finally(() => {
        if (runningRepoCommandRef.current?.invocationId === runningCommand.invocationId) {
          runningRepoCommandRef.current = null;
          setRunningRepoCommand(null);
        }
      });
  };

  const runFindingCommand = (repo: RepoSummary, request: FindingCommandRequest): void => {
    if (runningFindingCommandsRef.current[request.findingId] !== undefined) {
      return;
    }
    const runningCommand = { request, invocationId: nextCommandInvocationId() };
    runningFindingCommandsRef.current = {
      ...runningFindingCommandsRef.current,
      [request.findingId]: runningCommand,
    };
    setRunningFindingCommands(runningFindingCommandsRef.current);
    void window.clawpatch.commands
      .run(repo.id, request)
      .then((result) => {
        appendCommandResults(repo.id, request, result);
        void refreshAfterCommand(queryClient, repo.id, request, setActiveInspector, setDiffJump);
      })
      .catch((error: unknown) => {
        appendCommandError(repo.id, request, error);
      })
      .finally(() => {
        if (
          runningFindingCommandsRef.current[request.findingId]?.invocationId ===
          runningCommand.invocationId
        ) {
          const next = { ...runningFindingCommandsRef.current };
          delete next[request.findingId];
          runningFindingCommandsRef.current = next;
          setRunningFindingCommands(next);
        }
      });
  };

  const nextCommandInvocationId = (): string => {
    commandInvocationSeqRef.current += 1;
    return String(commandInvocationSeqRef.current);
  };

  const appendCommandResults = (
    repoId: string,
    request: ClawpatchCommandRequest,
    result: CommandResult,
  ): void => {
    const findingId = "findingId" in request ? request.findingId : undefined;
    setCommandLog((current) => [
      ...current,
      { kind: "result", result, repoId, findingId, command: request.command },
      ...(result.relatedResults ?? []).map((relatedResult) => ({
        kind: "result" as const,
        result: relatedResult,
        repoId,
        findingId,
        command:
          relatedResult.args.at(-2) === "revalidate"
            ? "revalidate"
            : (relatedResult.args.at(-1) ?? request.command),
      })),
    ]);
  };

  const appendCommandError = (
    repoId: string,
    request: ClawpatchCommandRequest,
    error: unknown,
  ): void => {
    setCommandLog((current) => [
      ...current,
      {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        repoId,
        findingId: "findingId" in request ? request.findingId : undefined,
        command: request.command,
      },
    ]);
  };

  const interruptCommand = (findingId?: string): void => {
    if (selectedRepo === null) {
      return;
    }
    commandInterruptMutation.mutate({ repo: selectedRepo, findingId });
  };

  const runFixWithSavedGuidance = (
    finding: FindingListItem,
    status: ClawpatchStatus,
    note: string,
  ): void => {
    if (selectedRepo === null) {
      return;
    }

    const repo = selectedRepo;
    setActiveInspector("output");
    const shouldSaveGuidance = note.trim() !== "" || status !== finding.status;
    runFindingCommand(
      repo,
      shouldSaveGuidance
        ? { command: "fix", findingId: finding.findingId, status, note }
        : { command: "fix", findingId: finding.findingId },
    );
  };

  const toggleInspector = (inspector: Exclude<ActiveInspector, null>): void => {
    setActiveInspector((current) => (current === inspector ? null : inspector));
  };

  const openDiffFile = useCallback(
    (filePath: string): void => {
      setActiveInspector("diff");
      setDiffJump((prev) => ({ path: filePath, epoch: (prev?.epoch ?? 0) + 1 }));
      if (selectedRepo !== null) {
        void queryClient.invalidateQueries({ queryKey: ["diff", selectedRepo.id] });
      }
    },
    [queryClient, selectedRepo],
  );

  const toggleRepoSidebar = (): void => {
    setIsRepoSidebarCollapsed((current) => {
      const next = !current;
      persistSidebarState(next);
      return next;
    });
  };

  return (
    <main className={isRepoSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      {isRepoSidebarCollapsed ? null : (
        <RepoSidebar
          id={REPO_SIDEBAR_ID}
          repos={reposQuery.data ?? []}
          selectedRepoId={selectedRepo?.id ?? null}
          isAdding={addRepoMutation.isPending}
          addError={addRepoMutation.error}
          onAddRepo={(repoPath) => addRepoMutation.mutate(repoPath)}
          onSelectRepo={(repoId) => {
            selectRepo(repoId);
            setSelectedFindingId(null);
          }}
        />
      )}
      <section className="workspace">
        <WorkspaceHeader
          repo={selectedRepo}
          selectedFindingWorktree={selectedFindingWorktree}
          repoSidebarId={REPO_SIDEBAR_ID}
          isRepoSidebarCollapsed={isRepoSidebarCollapsed}
          activeWorkspace={activeWorkspace}
          activeInspector={activeInspector}
          isRepoCommandBusy={isRepoCommandBusy}
          onToggleRepoSidebar={toggleRepoSidebar}
          onWorkspaceChange={setActiveWorkspace}
          onToggleInspector={toggleInspector}
          onRunCommand={runCommand}
        />

        {selectedRepo?.lastError ? (
          <div className="repo-error">{selectedRepo.lastError}</div>
        ) : null}

        {selectedRepo !== null && gitStatusQuery.data !== undefined ? (
          <GitStatusStrip
            status={gitStatusQuery.data}
            onViewDiff={() => setActiveInspector("diff")}
          />
        ) : null}

        <WorkspaceInspector
          activeInspector={activeInspector}
          diff={diffQuery.data ?? ""}
          isDiffLoading={diffQuery.isLoading}
          diffJump={diffJump}
          commandLog={commandLog}
          isCommandRunning={isAnyCommandRunning}
          onInterruptCommand={() =>
            interruptCommand(selectedFindingCommand?.request.findingId ?? firstRunningFindingId)
          }
        >
          {activeWorkspace === "findings" ? (
            <FindingsSplitPanel
              findings={sortedFindings}
              totalFindingCount={allFindings.length}
              selectedFindingId={selectedFinding?.findingId ?? null}
              isFindingsLoading={findingsQuery.isLoading}
              filters={findingFilters}
              filterOptions={findingFilterOptions}
              sort={findingSort}
              finding={detailQuery.data ?? null}
              isDetailLoading={detailQuery.isLoading}
              isBusy={triageMutation.isPending || isSelectedFindingRunning}
              commandStateLabel={selectedFindingCommand?.request.command}
              fixDisabledReason={fixDisabledReason}
              onInterrupt={() => {
                if (selectedFinding !== null) {
                  interruptCommand(selectedFinding.findingId);
                }
              }}
              onFiltersChange={setFindingFilters}
              onSortChange={setFindingSort}
              onSelectFinding={setSelectedFindingId}
              onTriage={(status, note) => {
                if (selectedRepo !== null && selectedFinding !== null) {
                  setActiveInspector("output");
                  triageMutation.mutate({
                    repo: selectedRepo,
                    finding: selectedFinding,
                    status,
                    note,
                  });
                }
              }}
              onFix={(status, note) => {
                if (selectedFinding !== null) {
                  runFixWithSavedGuidance(selectedFinding, status, note);
                }
              }}
              onRevalidate={() => {
                if (selectedFinding !== null) {
                  runCommand({
                    command: "revalidate",
                    findingId: selectedFinding.findingId,
                  });
                }
              }}
              onOpenDiffFile={openDiffFile}
              filesInDiff={filesInDiff}
            />
          ) : (
            <ReviewMapPanel
              snapshot={featureMapQuery.data ?? null}
              isLoading={featureMapQuery.isLoading}
              isBusy={isRepoCommandBusy}
              onReviewFeature={(featureId) => runCommand({ command: "review", featureId })}
              onReviewPending={(limit) => runCommand({ command: "review", limit })}
              onUpdateMap={() => runCommand({ command: "map" })}
            />
          )}
        </WorkspaceInspector>
      </section>
    </main>
  );
}

function readStoredSidebarState(): boolean {
  let storedState: string | null;
  try {
    storedState = window.localStorage.getItem(REPO_SIDEBAR_COLLAPSED_STORAGE_KEY);
  } catch {
    return false;
  }

  return storedState === "true";
}

function persistSidebarState(isCollapsed: boolean): void {
  try {
    window.localStorage.setItem(REPO_SIDEBAR_COLLAPSED_STORAGE_KEY, String(isCollapsed));
  } catch {
    // The toggle should keep working even if local storage is unavailable.
  }
}

async function invalidateRepo(
  queryClient: ReturnType<typeof useQueryClient>,
  repoId: string | null,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["repos"] }),
    queryClient.invalidateQueries({ queryKey: ["features", repoId] }),
    queryClient.invalidateQueries({ queryKey: ["findings", repoId] }),
    queryClient.invalidateQueries({ queryKey: ["finding"] }),
    queryClient.invalidateQueries({ queryKey: ["diff", repoId] }),
    queryClient.invalidateQueries({ queryKey: ["gitStatus", repoId] }),
  ]);
}

async function invalidateCommandProgress(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["repos"] }),
    queryClient.invalidateQueries({ queryKey: ["features"] }),
    queryClient.invalidateQueries({ queryKey: ["findings"] }),
    queryClient.invalidateQueries({ queryKey: ["finding"] }),
    queryClient.invalidateQueries({ queryKey: ["diff"] }),
    queryClient.invalidateQueries({ queryKey: ["gitStatus"] }),
  ]);
}

async function refreshAfterCommand(
  queryClient: ReturnType<typeof useQueryClient>,
  repoId: string,
  request: ClawpatchCommandRequest,
  setActiveInspector: (value: ActiveInspector) => void,
  setDiffJump: (
    updater: (
      prev: { path: string; epoch: number } | null,
    ) => { path: string; epoch: number } | null,
  ) => void,
): Promise<void> {
  await invalidateRepo(queryClient, repoId);
  if (request.command === "fix") {
    await revealFirstChangedFile(
      queryClient,
      repoId,
      request.findingId,
      setActiveInspector,
      setDiffJump,
    );
  }
}

async function revealFirstChangedFile(
  queryClient: ReturnType<typeof useQueryClient>,
  repoId: string | null,
  findingId: string,
  setActiveInspector: (value: ActiveInspector) => void,
  setDiffJump: (
    updater: (
      prev: { path: string; epoch: number } | null,
    ) => { path: string; epoch: number } | null,
  ) => void,
): Promise<void> {
  if (repoId === null) {
    return;
  }
  try {
    const detail = await queryClient.fetchQuery({
      queryKey: ["finding", repoId, findingId],
      queryFn: () => window.clawpatch.findings.get(repoId, findingId),
    });
    const patches = detail.patchAttempts ?? [];
    const newest = patches[0];
    const firstFile = newest?.filesChanged?.[0];
    if (typeof firstFile === "string" && firstFile !== "") {
      setActiveInspector("diff");
      setDiffJump((prev) => ({ path: firstFile, epoch: (prev?.epoch ?? 0) + 1 }));
    }
  } catch {
    // Diff auto-reveal is best-effort.
  }
}
