import {
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
  StethoscopeIcon,
  TerminalSquareIcon,
} from "lucide-react";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  CommandStreamEvent,
  FindingListItem,
  RepoSummary,
} from "../../../shared/types";
import { CommandPanel } from "../components/CommandPanel";
import { DiffViewer } from "../components/DiffViewer";
import { FindingsSplitPanel } from "../components/FindingsSplitPanel";
import { RepoSidebar } from "../components/RepoSidebar";
import { ReviewMapPanel } from "../components/ReviewMapPanel";
import {
  defaultFindingFilters,
  filterFindings,
  getFindingFilterOptions,
  resolveSelectedFindingId,
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

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [commandLog, setCommandLog] = useState<LogEntry[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("findings");
  const [activeInspector, setActiveInspector] = useState<ActiveInspector>(null);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [isInspectorResizing, setIsInspectorResizing] = useState(false);
  const [findingFilters, setFindingFilters] = useState(defaultFindingFilters);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
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
    if (selectedRepoId === null && selectedRepo !== null) {
      setSelectedRepoId(selectedRepo.id);
    }
  }, [selectedRepo, selectedRepoId]);

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
      filteredFindings.find((finding) => finding.findingId === selectedFindingId) ??
      filteredFindings[0] ??
      null,
    [filteredFindings, selectedFindingId],
  );

  useEffect(() => {
    if (findingsQuery.data === undefined) {
      return;
    }
    const nextSelectedFindingId = resolveSelectedFindingId(selectedFindingId, filteredFindings);
    if (nextSelectedFindingId !== selectedFindingId) {
      setSelectedFindingId(nextSelectedFindingId);
    }
  }, [filteredFindings, findingsQuery.data, selectedFindingId]);

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

  useEffect(() => {
    return window.clawpatch.commands.onStream((event) => {
      setCommandLog((current) => [...current, { kind: "stream", event }]);
    });
  }, []);

  const addRepoMutation = useMutation({
    mutationFn: (repoPath: string) => window.clawpatch.repo.add(repoPath),
    onSuccess: (repo) => {
      setSelectedRepoId(repo.id);
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });

  const commandMutation = useMutation({
    mutationFn: ({ repo, request }: { repo: RepoSummary; request: ClawpatchCommandRequest }) =>
      window.clawpatch.commands.run(repo.id, request),
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

  const runCommand = (request: ClawpatchCommandRequest): void => {
    if (selectedRepo === null) {
      return;
    }
    setActiveInspector("output");
    commandMutation.mutate({ repo: selectedRepo, request });
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

  return (
    <main className="app-shell">
      <RepoSidebar
        repos={reposQuery.data ?? []}
        selectedRepoId={selectedRepo?.id ?? null}
        isAdding={addRepoMutation.isPending}
        addError={addRepoMutation.error}
        onAddRepo={(repoPath) => addRepoMutation.mutate(repoPath)}
        onSelectRepo={(repoId) => {
          setSelectedRepoId(repoId);
          setSelectedFindingId(null);
        }}
      />
      <section className="workspace">
        <header className="workspace-header">
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
                findings={filteredFindings}
                totalFindingCount={allFindings.length}
                selectedFindingId={selectedFinding?.findingId ?? null}
                isFindingsLoading={findingsQuery.isLoading}
                filters={findingFilters}
                filterOptions={findingFilterOptions}
                finding={detailQuery.data ?? null}
                isDetailLoading={detailQuery.isLoading}
                isBusy={triageMutation.isPending || commandMutation.isPending}
                onFiltersChange={setFindingFilters}
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
                onFix={() => {
                  if (selectedFinding !== null) {
                    runCommand({ command: "fix", findingId: selectedFinding.findingId });
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
                <DiffViewer diff={diffQuery.data ?? ""} isLoading={diffQuery.isLoading} />
              ) : (
                <CommandPanel
                  entries={commandLog}
                  isRunning={commandMutation.isPending || triageMutation.isPending}
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
  ]);
}
