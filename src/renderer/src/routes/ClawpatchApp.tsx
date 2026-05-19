import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  DiffIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  StethoscopeIcon,
  TerminalSquareIcon,
} from "lucide-react";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  CommandStreamEvent,
  FindingListItem,
  GitStatusSummary,
  RepoSummary,
} from "../../../shared/types";
import { CommandPanel } from "../components/CommandPanel";
import { DiffViewer, extractDiffFilePaths } from "../components/DiffViewer";
import { FindingsSplitPanel } from "../components/FindingsSplitPanel";
import { RepoSidebar } from "../components/RepoSidebar";
import { ReviewMapPanel } from "../components/ReviewMapPanel";
import {
  defaultFindingFilters,
  defaultFindingSort,
  filterFindings,
  getFindingFilterOptions,
  resolveSelectedFindingId,
  sortFindings,
} from "../findingsFilters";
import { clawpatchStatuses } from "../../../shared/constants";

type LogEntry =
  | { kind: "stream"; event: CommandStreamEvent }
  | { kind: "result"; result: CommandResult }
  | { kind: "error"; message: string };

type ActiveWorkspace = "findings" | "reviewQueue";
type ActiveInspector = "diff" | "output" | null;

const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 720;
const INSPECTOR_DEFAULT_WIDTH = 440;
const INSPECTOR_KEYBOARD_STEP = 24;
const INSPECTOR_RESIZE_TRACK_WIDTH = 8;
const PRIMARY_MIN_WIDTH = 520;
const REPO_SIDEBAR_ID = "repo-sidebar";
const REPO_SIDEBAR_COLLAPSED_STORAGE_KEY = "clawpatch.repoSidebarCollapsed.v1";
const SELECTED_REPO_STORAGE_KEY = "clawpatch.selectedRepoId.v1";

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(readStoredSelectedRepoId);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [commandLog, setCommandLog] = useState<LogEntry[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("findings");
  const [activeInspector, setActiveInspector] = useState<ActiveInspector>(null);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [isInspectorResizing, setIsInspectorResizing] = useState(false);
  const [findingFilters, setFindingFilters] = useState(defaultFindingFilters);
  const [findingSort, setFindingSort] = useState(defaultFindingSort);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [isRepoSidebarCollapsed, setIsRepoSidebarCollapsed] = useState(readStoredSidebarState);
  const [diffJump, setDiffJump] = useState<{ path: string; epoch: number } | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement>(null);

  const reposQuery = useQuery({
    queryKey: ["repos"],
    queryFn: () => window.clawpatch.repo.list(),
  });

  const selectedRepo = useMemo(
    () =>
      reposQuery.data?.find((repo) => repo.id === selectedRepoId) ?? reposQuery.data?.[0] ?? null,
    [reposQuery.data, selectedRepoId],
  );

  useEffect(() => {
    if (reposQuery.data === undefined) {
      return;
    }
    const nextRepoId =
      reposQuery.data.find((repo) => repo.id === selectedRepoId)?.id ??
      reposQuery.data[0]?.id ??
      null;
    if (nextRepoId !== selectedRepoId) {
      setSelectedRepoId(nextRepoId);
    }
    if (nextRepoId !== null) {
      persistSelectedRepoId(nextRepoId);
    }
  }, [reposQuery.data, selectedRepoId]);

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
    queryKey: ["diff", selectedRepo?.id],
    queryFn: () => window.clawpatch.git.diff(selectedRepo!.id),
    enabled: selectedRepo !== null,
  });

  const filesInDiff = useMemo(() => extractDiffFilePaths(diffQuery.data ?? ""), [diffQuery.data]);

  const gitStatusQuery = useQuery({
    queryKey: ["gitStatus", selectedRepo?.id],
    queryFn: () => window.clawpatch.git.status(selectedRepo!.id),
    enabled: selectedRepo !== null,
  });

  useEffect(() => {
    return window.clawpatch.commands.onStream((event) => {
      setCommandLog((current) => [...current, { kind: "stream", event }]);
      void invalidateCommandProgress(queryClient);
    });
  }, [queryClient]);

  const addRepoMutation = useMutation({
    mutationFn: (repoPath: string) => window.clawpatch.repo.add(repoPath),
    onSuccess: (repo) => {
      setSelectedRepoId(repo.id);
      persistSelectedRepoId(repo.id);
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });

  const commandMutation = useMutation({
    mutationFn: ({ repo, request }: { repo: RepoSummary; request: ClawpatchCommandRequest }) =>
      window.clawpatch.commands.run(repo.id, request),
    onSuccess: (result, variables) => {
      setCommandLog((current) => [...current, { kind: "result", result }]);
      void refreshAfterCommand(
        queryClient,
        variables.repo.id,
        variables.request,
        setActiveInspector,
        setDiffJump,
      );
    },
    onError: (error) => {
      setCommandLog((current) => [
        ...current,
        { kind: "error", message: error instanceof Error ? error.message : String(error) },
      ]);
    },
  });

  const commandInterruptMutation = useMutation({
    mutationFn: (repo: RepoSummary) => window.clawpatch.commands.interrupt(repo.id),
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
    onSuccess: (result) => {
      setCommandLog((current) => [...current, { kind: "result", result }]);
      void invalidateRepo(queryClient, selectedRepo?.id ?? null);
    },
    onError: (error) => {
      setCommandLog((current) => [
        ...current,
        { kind: "error", message: error instanceof Error ? error.message : String(error) },
      ]);
    },
  });

  const isCommandBusy = commandMutation.isPending || triageMutation.isPending;

  useEffect(() => {
    if (!isCommandBusy) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void invalidateCommandProgress(queryClient);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isCommandBusy, queryClient]);

  const runCommand = (request: ClawpatchCommandRequest): void => {
    if (selectedRepo === null) {
      return;
    }
    setActiveInspector("output");
    commandMutation.mutate({ repo: selectedRepo, request });
  };

  const interruptCommand = (): void => {
    if (selectedRepo === null) {
      return;
    }
    commandInterruptMutation.mutate(selectedRepo);
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
    void (async () => {
      try {
        if (note.trim() !== "" || status !== finding.status) {
          await triageMutation.mutateAsync({ repo, finding, status, note });
        }
        await commandMutation.mutateAsync({
          repo,
          request: { command: "fix", findingId: finding.findingId },
        });
      } catch {
        // The mutation callbacks already publish the command error to the output log.
      }
    })();
  };

  const inspectorMaxWidth = (): number => {
    const body = workspaceBodyRef.current;
    if (body === null) {
      return INSPECTOR_MAX_WIDTH;
    }
    const bodyWidth = body.getBoundingClientRect().width;
    if (bodyWidth === 0) {
      return INSPECTOR_MAX_WIDTH;
    }
    const availableWidth = bodyWidth - PRIMARY_MIN_WIDTH - INSPECTOR_RESIZE_TRACK_WIDTH;
    return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, availableWidth));
  };

  const clampInspectorWidth = (nextWidth: number): number =>
    Math.min(inspectorMaxWidth(), Math.max(INSPECTOR_MIN_WIDTH, nextWidth));

  const setClampedInspectorWidth = (nextWidth: number): void => {
    setInspectorWidth(clampInspectorWidth(nextWidth));
  };

  const updateInspectorWidthFromPointer = (clientX: number): void => {
    const body = workspaceBodyRef.current;
    if (body === null) {
      return;
    }
    const rect = body.getBoundingClientRect();
    setClampedInspectorWidth(rect.right - clientX);
  };

  const handleInspectorPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsInspectorResizing(true);
    updateInspectorWidthFromPointer(event.clientX);
    event.preventDefault();
  };

  const handleInspectorPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isInspectorResizing) {
      return;
    }
    updateInspectorWidthFromPointer(event.clientX);
  };

  const stopInspectorResizing = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsInspectorResizing(false);
  };

  const handleInspectorSeparatorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowLeft") {
      setClampedInspectorWidth(inspectorWidth + INSPECTOR_KEYBOARD_STEP);
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      setClampedInspectorWidth(inspectorWidth - INSPECTOR_KEYBOARD_STEP);
      event.preventDefault();
    } else if (event.key === "Home") {
      setClampedInspectorWidth(INSPECTOR_MIN_WIDTH);
      event.preventDefault();
    } else if (event.key === "End") {
      setClampedInspectorWidth(INSPECTOR_MAX_WIDTH);
      event.preventDefault();
    }
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
            setSelectedRepoId(repoId);
            persistSelectedRepoId(repoId);
            setSelectedFindingId(null);
          }}
        />
      )}
      <section className="workspace">
        <header className="workspace-header">
          <button
            className="icon-button sidebar-toggle"
            onClick={toggleRepoSidebar}
            aria-controls={REPO_SIDEBAR_ID}
            aria-expanded={!isRepoSidebarCollapsed}
            aria-label={
              isRepoSidebarCollapsed ? "Show repositories panel" : "Hide repositories panel"
            }
            title={isRepoSidebarCollapsed ? "Show repositories panel" : "Hide repositories panel"}
          >
            {isRepoSidebarCollapsed ? (
              <PanelLeftOpenIcon aria-hidden="true" />
            ) : (
              <PanelLeftCloseIcon aria-hidden="true" />
            )}
          </button>
          <div className="workspace-title">
            <h1>{selectedRepo?.name ?? "Clawpatch"}</h1>
            <p>{selectedRepo?.path ?? "Add a repository with .clawpatch state to begin."}</p>
          </div>
          <div className="workspace-switcher" role="tablist" aria-label="Workspace">
            <button
              className={activeWorkspace === "findings" ? "active" : ""}
              onClick={() => setActiveWorkspace("findings")}
              role="tab"
              aria-selected={activeWorkspace === "findings"}
            >
              Findings
            </button>
            <button
              className={activeWorkspace === "reviewQueue" ? "active" : ""}
              onClick={() => setActiveWorkspace("reviewQueue")}
              role="tab"
              aria-selected={activeWorkspace === "reviewQueue"}
            >
              Review Queue
            </button>
          </div>
          <div className="header-actions">
            <button
              className={
                activeInspector === "diff"
                  ? "icon-button drawer-toggle active"
                  : "icon-button drawer-toggle"
              }
              disabled={selectedRepo === null}
              onClick={() => toggleInspector("diff")}
              aria-pressed={activeInspector === "diff"}
              aria-label="Toggle diff panel"
              title="Toggle diff panel"
            >
              <DiffIcon aria-hidden="true" />
            </button>
            <button
              className={
                activeInspector === "output"
                  ? "icon-button drawer-toggle active"
                  : "icon-button drawer-toggle"
              }
              onClick={() => toggleInspector("output")}
              aria-pressed={activeInspector === "output"}
              aria-label="Toggle command output"
              title="Toggle command output"
            >
              <TerminalSquareIcon aria-hidden="true" />
            </button>
            <div className="command-menu">
              <button
                className="icon-button"
                disabled={selectedRepo === null || commandMutation.isPending}
                onClick={() => setIsCommandMenuOpen((current) => !current)}
                aria-expanded={isCommandMenuOpen}
                aria-haspopup="menu"
                aria-label="More commands"
                title="More commands"
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </button>
              {isCommandMenuOpen ? (
                <div className="command-menu-popover" role="menu" aria-label="Repository commands">
                  <button
                    role="menuitem"
                    disabled={selectedRepo === null || commandMutation.isPending}
                    onClick={() => {
                      setIsCommandMenuOpen(false);
                      runCommand({ command: "status" });
                    }}
                  >
                    <ActivityIcon aria-hidden="true" />
                    Status
                  </button>
                  <button
                    role="menuitem"
                    disabled={selectedRepo === null || commandMutation.isPending}
                    onClick={() => {
                      setIsCommandMenuOpen(false);
                      runCommand({ command: "report" });
                    }}
                  >
                    <FileTextIcon aria-hidden="true" />
                    Report
                  </button>
                  <button
                    role="menuitem"
                    disabled={selectedRepo === null || commandMutation.isPending}
                    onClick={() => {
                      setIsCommandMenuOpen(false);
                      runCommand({ command: "doctor" });
                    }}
                  >
                    <StethoscopeIcon aria-hidden="true" />
                    Doctor
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {selectedRepo?.lastError ? (
          <div className="repo-error">{selectedRepo.lastError}</div>
        ) : null}

        {selectedRepo !== null && gitStatusQuery.data !== undefined ? (
          <GitStatusStrip
            status={gitStatusQuery.data}
            onViewDiff={() => setActiveInspector("diff")}
          />
        ) : null}

        <div
          className={
            activeInspector === null
              ? "workspace-body"
              : isInspectorResizing
                ? "workspace-body inspector-open resizing"
                : "workspace-body inspector-open"
          }
          ref={workspaceBodyRef}
          style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
        >
          <div className="primary-workspace">
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
                isBusy={triageMutation.isPending || commandMutation.isPending}
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
                isBusy={commandMutation.isPending || triageMutation.isPending}
                onReviewFeature={(featureId) => runCommand({ command: "review", featureId })}
                onReviewPending={(limit) => runCommand({ command: "review", limit })}
                onUpdateMap={() => runCommand({ command: "map" })}
              />
            )}
          </div>
          {activeInspector !== null ? (
            <div
              aria-label="Resize inspector pane"
              aria-orientation="vertical"
              aria-valuemax={inspectorMaxWidth()}
              aria-valuemin={INSPECTOR_MIN_WIDTH}
              aria-valuenow={Math.round(inspectorWidth)}
              className="workspace-resize-handle"
              onKeyDown={handleInspectorSeparatorKeyDown}
              onPointerCancel={stopInspectorResizing}
              onPointerDown={handleInspectorPointerDown}
              onPointerMove={handleInspectorPointerMove}
              onPointerUp={stopInspectorResizing}
              role="separator"
              tabIndex={0}
            />
          ) : null}
          {activeInspector !== null ? (
            <aside className="workspace-inspector" aria-label={inspectorLabel(activeInspector)}>
              {activeInspector === "diff" ? (
                <DiffViewer
                  diff={diffQuery.data ?? ""}
                  isLoading={diffQuery.isLoading}
                  scrollToFilePath={diffJump?.path ?? null}
                  scrollToken={diffJump?.epoch ?? 0}
                />
              ) : (
                <CommandPanel
                  entries={commandLog}
                  isRunning={commandMutation.isPending || triageMutation.isPending}
                  onInterrupt={interruptCommand}
                />
              )}
            </aside>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function inspectorLabel(activeInspector: Exclude<ActiveInspector, null>): string {
  if (activeInspector === "diff") {
    return "Git diff";
  }
  return "Command output";
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

function readStoredSelectedRepoId(): string | null {
  let storedRepoId: string | null;
  try {
    storedRepoId = window.localStorage.getItem(SELECTED_REPO_STORAGE_KEY);
  } catch {
    return null;
  }

  return storedRepoId === null || storedRepoId.trim() === "" ? null : storedRepoId;
}

function persistSelectedRepoId(repoId: string): void {
  try {
    window.localStorage.setItem(SELECTED_REPO_STORAGE_KEY, repoId);
  } catch {
    // Repo selection should keep working even if local storage is unavailable.
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

function GitStatusStrip({
  status,
  onViewDiff,
}: {
  status: GitStatusSummary;
  onViewDiff: () => void;
}) {
  const dirty = status.staged + status.modified + status.untracked;
  return (
    <div className="git-status-strip" role="status">
      <span className="git-status-branch">
        {status.branch !== null ? `branch ${status.branch}` : "no branch"}
      </span>
      <span className="git-status-divider" aria-hidden="true">
        ·
      </span>
      {dirty === 0 ? (
        <span className="git-status-clean">Working tree clean</span>
      ) : (
        <span className="git-status-counts">{formatGitStatusCounts(status)}</span>
      )}
      {dirty > 0 ? (
        <button className="git-status-action" onClick={onViewDiff} type="button">
          View diff
        </button>
      ) : null}
    </div>
  );
}

function formatGitStatusCounts(status: GitStatusSummary): string {
  const parts: string[] = [];
  if (status.staged > 0) {
    parts.push(`${status.staged} staged`);
  }
  if (status.modified > 0) {
    parts.push(`${status.modified} modified`);
  }
  if (status.untracked > 0) {
    parts.push(`${status.untracked} untracked`);
  }
  return parts.join(" · ");
}
