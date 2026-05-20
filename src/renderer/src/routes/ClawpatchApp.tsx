import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clawpatchQueryKeys } from "../clawpatchQueries";
import { visibleCommandLogEntries } from "../commandLogEntries";
import { FindingsSplitPanel } from "../components/FindingsSplitPanel";
import { GitStatusStrip } from "../components/GitStatusStrip";
import { RepoSidebar } from "../components/RepoSidebar";
import { ReviewMapPanel } from "../components/ReviewMapPanel";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { WorkspaceInspector } from "../components/WorkspaceInspector";
import { useCommandRunner } from "../hooks/useCommandRunner";
import { useDiffInspector } from "../hooks/useDiffInspector";
import { useFindingsWorkspace } from "../hooks/useFindingsWorkspace";
import { useRepoSidebarState } from "../hooks/useRepoSidebarState";
import { useSelectedRepo } from "../hooks/useSelectedRepo";
import type { ActiveInspector, ActiveWorkspace } from "../workspaceTypes";

const REPO_SIDEBAR_ID = "repo-sidebar";

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("findings");
  const [activeInspector, setActiveInspector] = useState<ActiveInspector>(null);
  const { isRepoSidebarCollapsed, toggleRepoSidebar } = useRepoSidebarState();

  const reposQuery = useQuery({
    queryKey: clawpatchQueryKeys.repos(),
    queryFn: () => window.clawpatch.repo.list(),
  });
  const { selectedRepo, selectRepo } = useSelectedRepo(reposQuery.data);

  const findingsWorkspace = useFindingsWorkspace({ selectedRepo });
  const selectedFinding = findingsWorkspace.selectedFinding;

  const openOutput = useCallback((): void => setActiveInspector("output"), []);
  const openDiff = useCallback((): void => setActiveInspector("diff"), []);
  const toggleInspector = (inspector: Exclude<ActiveInspector, null>): void => {
    setActiveInspector((current) => (current === inspector ? null : inspector));
  };

  const diffInspector = useDiffInspector({
    selectedRepo,
    selectedFinding,
    onOpenDiff: openDiff,
  });

  const commandRunner = useCommandRunner({
    selectedRepo,
    onOpenOutput: openOutput,
    onRevealFirstChangedFile: diffInspector.revealFirstChangedFile,
  });
  const { runCommand } = commandRunner;

  const featureMapQuery = useQuery({
    queryKey: clawpatchQueryKeys.features(selectedRepo?.id),
    queryFn: () => window.clawpatch.features.map(selectedRepo!.id),
    enabled: selectedRepo !== null,
  });

  const addRepoMutation = useMutation({
    mutationFn: (repoPath: string) => window.clawpatch.repo.add(repoPath),
    onSuccess: (repo) => {
      selectRepo(repo.id);
      void queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.repos() });
    },
  });

  const selectedFindingId = selectedFinding?.findingId;
  const selectedFindingCommand =
    selectedFindingId === undefined
      ? undefined
      : commandRunner.runningFindingCommands[selectedFindingId];
  const isSelectedFindingRunning = selectedFindingCommand !== undefined;
  const visibleCommandLog = useMemo(
    () =>
      visibleCommandLogEntries({
        entries: commandRunner.commandLog,
        selectedRepoId: selectedRepo?.id,
        selectedFindingId,
        activeWorkspace,
      }),
    [activeWorkspace, commandRunner.commandLog, selectedFindingId, selectedRepo?.id],
  );
  const isOutputCommandRunning =
    commandRunner.runningRepoCommand !== null ||
    (activeWorkspace === "findings" && (isSelectedFindingRunning || commandRunner.isTriagePending));

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
            findingsWorkspace.setSelectedFindingId(null);
          }}
        />
      )}
      <section className="workspace">
        <WorkspaceHeader
          repo={selectedRepo}
          repoSidebarId={REPO_SIDEBAR_ID}
          isRepoSidebarCollapsed={isRepoSidebarCollapsed}
          activeWorkspace={activeWorkspace}
          activeInspector={activeInspector}
          isRepoCommandBusy={commandRunner.isRepoCommandBusy}
          onToggleRepoSidebar={toggleRepoSidebar}
          onWorkspaceChange={setActiveWorkspace}
          onToggleInspector={toggleInspector}
          onRunCommand={runCommand}
        />

        {selectedRepo?.lastError ? (
          <div className="repo-error">{selectedRepo.lastError}</div>
        ) : null}

        {selectedRepo !== null && findingsWorkspace.gitStatusQuery.data !== undefined ? (
          <GitStatusStrip status={findingsWorkspace.gitStatusQuery.data} onViewDiff={openDiff} />
        ) : null}

        <WorkspaceInspector
          activeInspector={activeInspector}
          diff={diffInspector.diff}
          isDiffLoading={diffInspector.isDiffLoading}
          diffJump={diffInspector.diffJump}
          commandLog={visibleCommandLog}
          isCommandRunning={isOutputCommandRunning}
          onInterruptCommand={() =>
            commandRunner.interruptCommand(
              activeWorkspace === "findings"
                ? selectedFindingCommand?.request.findingId
                : undefined,
            )
          }
        >
          {activeWorkspace === "findings" ? (
            <FindingsSplitPanel
              findings={findingsWorkspace.sortedFindings}
              totalFindingCount={findingsWorkspace.allFindings.length}
              selectedFindingId={selectedFinding?.findingId ?? null}
              isFindingsLoading={findingsWorkspace.findingsQuery.isLoading}
              filters={findingsWorkspace.findingFilters}
              filterOptions={findingsWorkspace.findingFilterOptions}
              sort={findingsWorkspace.findingSort}
              finding={findingsWorkspace.detailQuery.data ?? null}
              isDetailLoading={findingsWorkspace.detailQuery.isLoading}
              isBusy={commandRunner.isTriagePending || isSelectedFindingRunning}
              commandStateLabel={selectedFindingCommand?.request.command}
              fixDisabledReason={findingsWorkspace.fixDisabledReason}
              onInterrupt={() => {
                if (selectedFinding !== null) {
                  commandRunner.interruptCommand(selectedFinding.findingId);
                }
              }}
              onFiltersChange={findingsWorkspace.setFindingFilters}
              onSortChange={findingsWorkspace.setFindingSort}
              onSelectFinding={findingsWorkspace.setSelectedFindingId}
              onTriage={(status, note) => {
                if (selectedFinding !== null) {
                  commandRunner.triageFinding(selectedFinding, status, note);
                }
              }}
              onFix={(status, note) => {
                if (selectedFinding !== null) {
                  commandRunner.runFixWithSavedGuidance(selectedFinding, status, note);
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
              onOpenDiffFile={diffInspector.openDiffFile}
              filesInDiff={diffInspector.filesInDiff}
            />
          ) : (
            <ReviewMapPanel
              snapshot={featureMapQuery.data ?? null}
              isLoading={featureMapQuery.isLoading}
              isBusy={commandRunner.isRepoCommandBusy}
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
