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
import { WorkflowSetupPanel } from "../components/WorkflowSetupPanel";
import { useCommandRunner } from "../hooks/useCommandRunner";
import { useDiffInspector } from "../hooks/useDiffInspector";
import { useFindingsWorkspace } from "../hooks/useFindingsWorkspace";
import { useRepoSidebarState } from "../hooks/useRepoSidebarState";
import { useSelectedRepo } from "../hooks/useSelectedRepo";
import type {
  AppSettings,
  ClawpatchConfig,
  FindingWorkStatus,
  PatchOpenPrResult,
  RepoSettings,
} from "../../../shared/types";
import type { ActiveInspector, ActiveWorkspace } from "../workspaceTypes";
import type { ReviewRunOptions } from "../components/ReviewMapPanel";

const REPO_SIDEBAR_ID = "repo-sidebar";

export function ClawpatchApp() {
  const queryClient = useQueryClient();
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace>("findings");
  const [activeInspector, setActiveInspector] = useState<ActiveInspector>(null);
  const [openedPr, setOpenedPr] = useState<{
    readonly findingId: string;
    readonly result: PatchOpenPrResult;
  } | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const { isRepoSidebarCollapsed, toggleRepoSidebar } = useRepoSidebarState();

  const reposQuery = useQuery({
    queryKey: clawpatchQueryKeys.repos(),
    queryFn: () => window.clawpatch.repo.list(),
  });
  const { selectedRepo, selectRepo } = useSelectedRepo(reposQuery.data);
  const stateRepo = selectedRepo?.hasClawpatch === true ? selectedRepo : null;
  const settingsRepo =
    settingsSection?.kind === "repo"
      ? (reposQuery.data?.find((repo) => repo.id === settingsSection.repoId) ?? null)
      : null;
  const settingsDoctorRepo = settingsSection?.kind === "general" ? selectedRepo : null;

  const findingsWorkspace = useFindingsWorkspace({ selectedRepo: stateRepo });
  const selectedFinding = findingsWorkspace.selectedFinding;

  const openDiff = useCallback((): void => setActiveInspector("diff"), []);
  const toggleInspector = (inspector: Exclude<ActiveInspector, null>): void => {
    setActiveInspector((current) => (current === inspector ? null : inspector));
  };

  const diffInspector = useDiffInspector({
    selectedRepo: stateRepo,
    selectedFinding,
    onOpenDiff: openDiff,
  });

  const commandRunner = useCommandRunner({
    selectedRepo,
    onRevealFirstChangedFile: diffInspector.revealFirstChangedFile,
  });
  const { runCommand } = commandRunner;

  const featureMapQuery = useQuery({
    queryKey: clawpatchQueryKeys.features(stateRepo?.id),
    queryFn: () => window.clawpatch.features.map(stateRepo!.id),
    enabled: stateRepo !== null,
  });
  const reviewQueueUnreviewedCount = featureMapQuery.data?.coverage.pendingReviewCount ?? 0;

  const openPrMutation = useMutation({
    mutationFn: ({ repoId, findingId }: { repoId: string; findingId: string }) =>
      window.clawpatch.patches.openPr(repoId, findingId),
    onMutate: ({ findingId }) => {
      setOpenedPr((current) => (current?.findingId === findingId ? null : current));
      setActiveInspector("output");
    },
    onSuccess: (result, variables) => {
      setOpenedPr({ findingId: variables.findingId, result });
      commandRunner.recordCommandResult(
        variables.repoId,
        { command: "open-pr", patchAttemptId: result.patchAttemptId, draft: true },
        result.commandResult,
      );
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
  const repoConfigQuery = useQuery({
    queryKey: clawpatchQueryKeys.repoConfig(settingsRepo?.id),
    queryFn: () => window.clawpatch.repo.getConfig(settingsRepo!.id),
    enabled: settingsRepo !== null,
  });

  const appSettingsQuery = useQuery({
    queryKey: clawpatchQueryKeys.appSettings(),
    queryFn: () => window.clawpatch.appSettings.get(),
    enabled: settingsSection?.kind === "general",
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
  const repoConfigMutation = useMutation({
    mutationFn: ({ repoId, config }: { repoId: string; config: ClawpatchConfig }) =>
      window.clawpatch.repo.updateConfig(repoId, config),
    onSuccess: (_config, variables) => {
      void queryClient.invalidateQueries({
        queryKey: clawpatchQueryKeys.repoConfig(variables.repoId),
      });
    },
  });

  const appSettingsMutation = useMutation({
    mutationFn: (settings: AppSettings) => window.clawpatch.appSettings.update(settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: clawpatchQueryKeys.appSettings(),
      });
    },
  });
  const terminalAppPickerMutation = useMutation({
    mutationFn: () => window.clawpatch.appSettings.pickTerminalApp(),
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
  const selectedFindingOpenPrResult =
    openedPr !== null && openedPr.findingId === selectedFindingId ? openedPr.result : null;
  const workStatusByFindingId = useMemo(() => {
    const nextStatuses = new Map(findingsWorkspace.workStatusByFindingId);
    if (openedPr !== null && openedPr.result.prUrl !== null) {
      const current = nextStatuses.get(openedPr.findingId);
      nextStatuses.set(openedPr.findingId, {
        findingId: openedPr.findingId,
        worktreePath: openedPr.result.worktreePath,
        gitStatus: current?.gitStatus ?? {
          staged: 0,
          modified: 0,
          untracked: 0,
          branch: null,
        },
        prUrl: openedPr.result.prUrl,
        error: current?.gitStatus === null ? null : (current?.error ?? null),
      } satisfies FindingWorkStatus);
    }
    return nextStatuses;
  }, [findingsWorkspace.workStatusByFindingId, openedPr]);
  const selectedFindingOpenPrError =
    openPrMutation.variables?.findingId === selectedFindingId ? openPrMutation.error : null;
  const selectedRepoReviewCompletion =
    commandRunner.lastReviewCompletion?.repoId === selectedRepo?.id
      ? commandRunner.lastReviewCompletion
      : null;
  const selectedFindingHasActiveWorktree =
    selectedRepo !== null &&
    selectedFindingId !== undefined &&
    selectedRepo.activeWorktrees.some((worktree) => worktree.findingId === selectedFindingId);
  const selectedFindingHasPatch =
    (findingsWorkspace.detailQuery.data?.patchAttempts.length ?? 0) > 0 ||
    (selectedFinding?.linkedPatchAttemptIds.length ?? 0) > 0;
  const canOpenSelectedPr = selectedFindingHasActiveWorktree && selectedFindingHasPatch;
  const openPrDisabledReason =
    selectedFindingHasActiveWorktree && !selectedFindingHasPatch
      ? "Run fix to create a Clawpatch patch before opening a PR"
      : null;

  const runReviewCommand = (options: ReviewRunOptions, featureId?: string): void => {
    runCommand({
      command: "review",
      ...(featureId !== undefined ? { featureId } : {}),
      ...options,
    });
  };

  return settingsSection !== null ? (
    <RepoSettingsPage
      repos={reposQuery.data ?? []}
      selectedRepo={settingsDoctorRepo}
      selectedSection={settingsSection}
      appSettings={appSettingsQuery.data}
      isAppSettingsLoading={appSettingsQuery.isLoading}
      isAppSettingsSaving={appSettingsMutation.isPending}
      isTerminalAppPickerOpen={terminalAppPickerMutation.isPending}
      appSettingsError={
        appSettingsQuery.error ?? appSettingsMutation.error ?? terminalAppPickerMutation.error
      }
      settings={repoSettingsQuery.data}
      config={repoConfigQuery.data}
      isLoading={repoSettingsQuery.isLoading || repoConfigQuery.isLoading}
      isSaving={repoSettingsMutation.isPending || repoConfigMutation.isPending}
      error={
        repoSettingsQuery.error ??
        repoSettingsMutation.error ??
        repoConfigQuery.error ??
        repoConfigMutation.error
      }
      doctorResult={repoDoctorQuery.data}
      isDoctorLoading={repoDoctorQuery.isLoading}
      doctorError={repoDoctorQuery.error}
      onBack={() => setSettingsSection(null)}
      onSelectGeneral={() => setSettingsSection({ kind: "general" })}
      onSelectRepo={(repoId) => setSettingsSection({ kind: "repo", repoId })}
      onPickTerminalApp={() => terminalAppPickerMutation.mutateAsync()}
      onSaveAppSettings={(settings) => appSettingsMutation.mutate(settings)}
      onSave={(repoId, settings, config) => {
        repoSettingsMutation.mutate({ repoId, settings });
        repoConfigMutation.mutate({ repoId, config });
      }}
    />
  ) : (
    <main className={isRepoSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      {isRepoSidebarCollapsed ? (
        <RepoSidebarRail
          id={REPO_SIDEBAR_ID}
          repos={reposQuery.data ?? []}
          selectedRepoId={selectedRepo?.id ?? null}
          onExpand={toggleRepoSidebar}
          onOpenSettings={() => setSettingsSection({ kind: "general" })}
          onSelectRepo={(repoId) => {
            selectRepo(repoId);
            findingsWorkspace.setSelectedFindingId(null);
          }}
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
          isOpeningTerminal={terminalMutation.isPending}
          reviewQueueUnreviewedCount={reviewQueueUnreviewedCount}
          onWorkspaceChange={setActiveWorkspace}
          onToggleInspector={toggleInspector}
          onOpenTerminal={openTerminal}
        />

        {selectedRepo?.lastError && selectedRepo.hasClawpatch ? (
          <div className="repo-error">{selectedRepo.lastError}</div>
        ) : null}
        {terminalError !== null ? <div className="repo-error">{terminalError}</div> : null}

        {stateRepo !== null && findingsWorkspace.gitStatusQuery.data !== undefined ? (
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
          {selectedRepo !== null && !selectedRepo.hasClawpatch ? (
            <WorkflowSetupPanel
              repo={selectedRepo}
              isBusy={commandRunner.runningRepoCommand !== null}
              runningCommandLabel={commandRunner.runningRepoCommand?.request.command}
              onRunCommand={(request) => {
                setActiveInspector("output");
                if (request.command === "review" || request.command === "map") {
                  setActiveWorkspace("reviewQueue");
                }
                runCommand(request);
              }}
            />
          ) : activeWorkspace === "findings" ? (
            <FindingsSplitPanel
              findings={findingsWorkspace.sortedFindings}
              totalFindingCount={findingsWorkspace.allFindings.length}
              selectedFindingId={selectedFinding?.findingId ?? null}
              isFindingsLoading={findingsWorkspace.findingsQuery.isLoading}
              filters={findingsWorkspace.findingFilters}
              filterOptions={findingsWorkspace.findingFilterOptions}
              sort={findingsWorkspace.findingSort}
              bulkRevalidationProgress={commandRunner.bulkRevalidationProgress}
              workStatusByFindingId={workStatusByFindingId}
              finding={findingsWorkspace.detailQuery.data ?? null}
              isDetailLoading={findingsWorkspace.detailQuery.isLoading}
              isBusy={
                commandRunner.isTriagePending ||
                isSelectedFindingRunning ||
                (openPrMutation.isPending &&
                  openPrMutation.variables?.findingId === selectedFindingId)
              }
              commandStateLabel={
                openPrMutation.isPending &&
                openPrMutation.variables?.findingId === selectedFindingId
                  ? "open-pr"
                  : commandRunner.isTriagePending
                    ? "triage"
                    : selectedFindingCommand?.request.command
              }
              fixDisabledReason={findingsWorkspace.fixDisabledReason}
              canOpenPr={canOpenSelectedPr}
              openPrDisabledReason={openPrDisabledReason}
              openPrResult={selectedFindingOpenPrResult}
              openPrError={selectedFindingOpenPrError}
              triageError={
                commandRunner.triageError !== null &&
                commandRunner.triageError.findingId === selectedFindingId
                  ? commandRunner.triageError.message
                  : null
              }
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
              onRevalidateShown={() =>
                commandRunner.revalidateFindings(findingsWorkspace.sortedFindings)
              }
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
              onOpenPr={() => {
                if (selectedRepo !== null && selectedFinding !== null) {
                  openPrMutation.mutate({
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
              runningReviewFeatureId={commandRunner.runningReviewFeatureId}
              queuedReviewFeatureIds={commandRunner.queuedReviewFeatureIds}
              lastReviewCompletion={selectedRepoReviewCompletion}
              onReviewFeature={(featureId, options) => runReviewCommand(options, featureId)}
              onUpdateMap={() => runCommand({ command: "map" })}
            />
          )}
        </WorkspaceInspector>
      </section>
    </main>
  );
}
