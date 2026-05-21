import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clawpatchQueryKeys, invalidateRepo } from "../clawpatchQueries";
import { visibleCommandLogEntries } from "../commandLogEntries";
import { FindingsSplitPanel } from "../components/FindingsSplitPanel";
import { GitStatusStrip } from "../components/GitStatusStrip";
import { RepoSettingsPage, type SettingsSection } from "../components/RepoSettingsPage";
import { RepoSidebar, RepoSidebarRail } from "../components/RepoSidebar";
import { ReviewMapPanel } from "../components/ReviewMapPanel";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { WorkspaceInspector } from "../components/WorkspaceInspector";
import { useCommandRunner } from "../hooks/useCommandRunner";
import { useDiffInspector } from "../hooks/useDiffInspector";
import { useFindingsWorkspace } from "../hooks/useFindingsWorkspace";
import { useRepoSidebarState } from "../hooks/useRepoSidebarState";
import { useSelectedRepo } from "../hooks/useSelectedRepo";
import type { FindingWorkStatus, PublishFixResult, RepoSettings } from "../../../shared/types";
import type { ActiveInspector, ActiveWorkspace } from "../workspaceTypes";

const REPO_SIDEBAR_ID = "repo-sidebar";

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("findings");
  const [activeInspector, setActiveInspector] = useState<ActiveInspector>(null);
  const [publishedFix, setPublishedFix] = useState<{
    readonly findingId: string;
    readonly result: PublishFixResult;
  } | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const { isRepoSidebarCollapsed, toggleRepoSidebar } = useRepoSidebarState();

  const reposQuery = useQuery({
    queryKey: clawpatchQueryKeys.repos(),
    queryFn: () => window.clawpatch.repo.list(),
  });
  const { selectedRepo, selectRepo } = useSelectedRepo(reposQuery.data);
  const settingsRepo =
    settingsSection?.kind === "repo"
      ? (reposQuery.data?.find((repo) => repo.id === settingsSection.repoId) ?? null)
      : null;
  const settingsDoctorRepo = settingsSection?.kind === "general" ? selectedRepo : null;

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

  const publishFixMutation = useMutation({
    mutationFn: ({ repoId, findingId }: { repoId: string; findingId: string }) =>
      window.clawpatch.git.publishFix(repoId, findingId),
    onMutate: ({ findingId }) => {
      setPublishedFix((current) => (current?.findingId === findingId ? null : current));
    },
    onSuccess: (result, variables) => {
      setPublishedFix({ findingId: variables.findingId, result });
      void invalidateRepo(queryClient, variables.repoId);
    },
  });

  const addRepoMutation = useMutation({
    mutationFn: (repoPath: string) => window.clawpatch.repo.add(repoPath),
    onSuccess: (repo) => {
      selectRepo(repo.id);
      void queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.repos() });
    },
  });

  const repoSettingsQuery = useQuery({
    queryKey: clawpatchQueryKeys.repoSettings(settingsRepo?.id),
    queryFn: () => window.clawpatch.repo.getSettings(settingsRepo!.id),
    enabled: settingsRepo !== null,
  });

  const repoDoctorQuery = useQuery({
    queryKey: clawpatchQueryKeys.repoDoctor(settingsDoctorRepo?.id),
    queryFn: () => window.clawpatch.repo.doctor(settingsDoctorRepo!.id),
    enabled: settingsDoctorRepo !== null,
  });

  const repoSettingsMutation = useMutation({
    mutationFn: ({ repoId, settings }: { repoId: string; settings: RepoSettings }) =>
      window.clawpatch.repo.updateSettings(repoId, settings),
    onSuccess: (_settings, variables) => {
      void queryClient.invalidateQueries({
        queryKey: clawpatchQueryKeys.repoSettings(variables.repoId),
      });
    },
  });

  const selectedFindingId = selectedFinding?.findingId;
  useEffect(() => {
    setTerminalError(null);
  }, [selectedRepo?.id]);

  const terminalMutation = useMutation({
    mutationFn: ({ repoId, findingId }: { repoId: string; findingId?: string }) =>
      window.clawpatch.terminal.open(repoId, findingId),
    onSuccess: () => setTerminalError(null),
    onError: (error) => {
      setTerminalError(error instanceof Error ? error.message : String(error));
    },
  });

  const openTerminal = useCallback((): void => {
    if (selectedRepo === null) {
      return;
    }
    terminalMutation.mutate({
      repoId: selectedRepo.id,
      findingId: selectedFinding?.findingId,
    });
  }, [selectedFinding?.findingId, selectedRepo, terminalMutation]);

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
  const selectedFindingPublishResult =
    publishedFix !== null && publishedFix.findingId === selectedFindingId
      ? publishedFix.result
      : null;
  const workStatusByFindingId = useMemo(() => {
    const nextStatuses = new Map(findingsWorkspace.workStatusByFindingId);
    if (publishedFix !== null) {
      const current = nextStatuses.get(publishedFix.findingId);
      nextStatuses.set(publishedFix.findingId, {
        findingId: publishedFix.findingId,
        worktreePath: publishedFix.result.worktreePath,
        gitStatus: current?.gitStatus ?? {
          staged: 0,
          modified: 0,
          untracked: 0,
          branch: publishedFix.result.branchName,
        },
        prUrl: publishedFix.result.prUrl,
        error: current?.gitStatus === null ? null : (current?.error ?? null),
      } satisfies FindingWorkStatus);
    }
    return nextStatuses;
  }, [findingsWorkspace.workStatusByFindingId, publishedFix]);
  const selectedFindingPublishError =
    publishFixMutation.variables?.findingId === selectedFindingId ? publishFixMutation.error : null;
  const canPublishSelectedFix =
    selectedRepo !== null &&
    selectedFindingId !== undefined &&
    selectedRepo.activeWorktrees.some((worktree) => worktree.findingId === selectedFindingId);

  return settingsSection !== null ? (
    <RepoSettingsPage
      repos={reposQuery.data ?? []}
      selectedRepo={settingsDoctorRepo}
      selectedSection={settingsSection}
      settings={repoSettingsQuery.data}
      isLoading={repoSettingsQuery.isLoading}
      isSaving={repoSettingsMutation.isPending}
      error={repoSettingsQuery.error ?? repoSettingsMutation.error}
      doctorResult={repoDoctorQuery.data}
      isDoctorLoading={repoDoctorQuery.isLoading}
      doctorError={repoDoctorQuery.error}
      onBack={() => setSettingsSection(null)}
      onSelectGeneral={() => setSettingsSection({ kind: "general" })}
      onSelectRepo={(repoId) => setSettingsSection({ kind: "repo", repoId })}
      onSave={(repoId, settings) => repoSettingsMutation.mutate({ repoId, settings })}
    />
  ) : (
    <main className={isRepoSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      {isRepoSidebarCollapsed ? (
        <RepoSidebarRail
          id={REPO_SIDEBAR_ID}
          onExpand={toggleRepoSidebar}
          onOpenSettings={() => setSettingsSection({ kind: "general" })}
        />
      ) : (
        <RepoSidebar
          id={REPO_SIDEBAR_ID}
          repos={reposQuery.data ?? []}
          selectedRepoId={selectedRepo?.id ?? null}
          isAdding={addRepoMutation.isPending}
          addError={addRepoMutation.error}
          onAddRepo={(repoPath) => addRepoMutation.mutate(repoPath)}
          onCollapse={toggleRepoSidebar}
          onOpenSettings={() => setSettingsSection({ kind: "general" })}
          onOpenRepoSettings={(repo) => setSettingsSection({ kind: "repo", repoId: repo.id })}
          onSelectRepo={(repoId) => {
            selectRepo(repoId);
            findingsWorkspace.setSelectedFindingId(null);
          }}
        />
      )}
      <section className="workspace">
        <WorkspaceHeader
          repo={selectedRepo}
          activeWorkspace={activeWorkspace}
          activeInspector={activeInspector}
          isRepoCommandBusy={commandRunner.isRepoCommandBusy}
          isOpeningTerminal={terminalMutation.isPending}
          onWorkspaceChange={setActiveWorkspace}
          onToggleInspector={toggleInspector}
          onOpenTerminal={openTerminal}
          onRunCommand={runCommand}
        />

        {selectedRepo?.lastError ? (
          <div className="repo-error">{selectedRepo.lastError}</div>
        ) : null}
        {terminalError !== null ? <div className="repo-error">{terminalError}</div> : null}

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
              workStatusByFindingId={workStatusByFindingId}
              finding={findingsWorkspace.detailQuery.data ?? null}
              isDetailLoading={findingsWorkspace.detailQuery.isLoading}
              isBusy={
                commandRunner.isTriagePending ||
                isSelectedFindingRunning ||
                (publishFixMutation.isPending &&
                  publishFixMutation.variables?.findingId === selectedFindingId)
              }
              commandStateLabel={
                publishFixMutation.isPending &&
                publishFixMutation.variables?.findingId === selectedFindingId
                  ? "publish"
                  : selectedFindingCommand?.request.command
              }
              fixDisabledReason={findingsWorkspace.fixDisabledReason}
              canPublishFix={canPublishSelectedFix}
              publishFixResult={selectedFindingPublishResult}
              publishFixError={selectedFindingPublishError}
              onInterrupt={
                isSelectedFindingRunning
                  ? () => {
                      if (selectedFinding !== null) {
                        commandRunner.interruptCommand(selectedFinding.findingId);
                      }
                    }
                  : undefined
              }
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
              onPublishFix={() => {
                if (selectedRepo !== null && selectedFinding !== null) {
                  publishFixMutation.mutate({
                    repoId: selectedRepo.id,
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
