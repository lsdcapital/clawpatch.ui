import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  DiffIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
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
import { FindingDetailPanel } from "../components/FindingDetailPanel";
import { FindingsTable } from "../components/FindingsTable";
import { RepoSidebar } from "../components/RepoSidebar";
import { ReviewCoveragePanel } from "../components/ReviewCoveragePanel";
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

type ActiveDrawer = "diff" | "output" | null;

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [commandLog, setCommandLog] = useState<LogEntry[]>([]);
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);
  const [findingFilters, setFindingFilters] = useState(defaultFindingFilters);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);

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
    setActiveDrawer("output");
    commandMutation.mutate({ repo: selectedRepo, request });
  };

  const toggleDrawer = (drawer: Exclude<ActiveDrawer, null>): void => {
    setActiveDrawer((current) => (current === drawer ? null : drawer));
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
          <div className="header-actions">
            <button
              className={
                activeDrawer === "diff"
                  ? "icon-button drawer-toggle active"
                  : "icon-button drawer-toggle"
              }
              disabled={selectedRepo === null}
              onClick={() => toggleDrawer("diff")}
              aria-pressed={activeDrawer === "diff"}
              aria-label="Toggle diff panel"
              title="Toggle diff panel"
            >
              <DiffIcon aria-hidden="true" />
            </button>
            <button
              className={
                activeDrawer === "output"
                  ? "icon-button drawer-toggle active"
                  : "icon-button drawer-toggle"
              }
              onClick={() => toggleDrawer("output")}
              aria-pressed={activeDrawer === "output"}
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
                      runCommand({ command: "map" });
                    }}
                  >
                    <RefreshCwIcon aria-hidden="true" />
                    Update map
                  </button>
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

        <div className={activeDrawer === null ? "workspace-body" : "workspace-body drawer-open"}>
          <div className="primary-workspace">
            <ReviewCoveragePanel
              snapshot={featureMapQuery.data ?? null}
              isLoading={featureMapQuery.isLoading}
              isBusy={commandMutation.isPending || triageMutation.isPending}
              isExpanded={isMapExpanded}
              onToggleExpanded={() => setIsMapExpanded((current) => !current)}
              onReviewAllPending={(limit) => runCommand({ command: "review", limit })}
              onReviewFeature={(featureId) => runCommand({ command: "review", featureId })}
            />
            <FindingsTable
              findings={filteredFindings}
              totalFindingCount={allFindings.length}
              selectedFindingId={selectedFinding?.findingId ?? null}
              isLoading={findingsQuery.isLoading}
              filters={findingFilters}
              filterOptions={findingFilterOptions}
              onFiltersChange={setFindingFilters}
              onSelectFinding={setSelectedFindingId}
            />
            <FindingDetailPanel
              finding={detailQuery.data ?? null}
              isLoading={detailQuery.isLoading}
              isBusy={triageMutation.isPending || commandMutation.isPending}
              onTriage={(status, note) => {
                if (selectedRepo !== null && selectedFinding !== null) {
                  setActiveDrawer("output");
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
            />
          </div>
          {activeDrawer !== null ? (
            <aside
              className="workspace-drawer"
              aria-label={activeDrawer === "diff" ? "Git diff" : "Command output"}
            >
              {activeDrawer === "diff" ? (
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
