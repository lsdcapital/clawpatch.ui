import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ClawpatchCommandRequest,
  ClawpatchStatus,
  CommandResult,
  FindingListItem,
  RepoSummary,
} from "../../../shared/types";
import {
  appendCommandLogEntries,
  commandErrorLogEntry,
  commandResultLogEntries,
} from "../commandLogEntries";
import { clawpatchQueryKeys, invalidateCommandProgress, invalidateRepo } from "../clawpatchQueries";
import type { CommandLogEntry } from "../workspaceTypes";
import type { ReviewCompletionSummary, ReviewQueueState } from "../../../shared/reviewCompletion";

export type { ReviewCompletionSummary };

const EMPTY_REVIEW_QUEUE_STATE: ReviewQueueState = {
  runningRepoId: null,
  runningFeatureId: null,
  queued: [],
  lastCompletion: null,
};

type FindingCommandRequest = Extract<ClawpatchCommandRequest, { command: "fix" | "revalidate" }>;
type RunningRepoCommand = {
  request: ClawpatchCommandRequest;
  invocationId: string;
  repoId: string;
};
export type RunningFindingCommand = {
  request: FindingCommandRequest;
  invocationId: string;
  repoId: string;
};
export interface BulkRevalidationProgress {
  readonly current: number;
  readonly total: number;
}

const STREAM_INVALIDATE_THROTTLE_MS = 750;

export function useCommandRunner({
  selectedRepo,
  onRevealFirstChangedFile,
}: {
  selectedRepo: RepoSummary | null;
  onRevealFirstChangedFile: (findingId: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([]);
  const [runningRepoCommand, setRunningRepoCommand] = useState<RunningRepoCommand | null>(null);
  const [runningFindingCommands, setRunningFindingCommands] = useState<
    Record<string, RunningFindingCommand>
  >({});
  // Review-feature queue/run state now lives in the main process; the renderer
  // reflects it via the review-queue:state push.
  const [reviewQueueState, setReviewQueueState] =
    useState<ReviewQueueState>(EMPTY_REVIEW_QUEUE_STATE);
  const [bulkRevalidationProgress, setBulkRevalidationProgress] =
    useState<BulkRevalidationProgress | null>(null);
  const [triageError, setTriageError] = useState<{
    readonly findingId: string;
    readonly message: string;
  } | null>(null);
  const commandInvocationSeqRef = useRef(0);
  const runningRepoCommandRef = useRef<RunningRepoCommand | null>(null);
  const runningFindingCommandsRef = useRef<Record<string, RunningFindingCommand>>({});
  const runningReviewRepoIdRef = useRef<string | null>(null);
  const previousReviewCompletionRef = useRef<ReviewCompletionSummary | null>(null);
  const isBulkRevalidationRunningRef = useRef(false);

  useEffect(() => {
    return window.clawpatch.reviewQueue.onState((state) => {
      runningReviewRepoIdRef.current = state.runningRepoId;
      setReviewQueueState(state);
      // Each completed review reports a fresh summary; refresh that repo's
      // findings and feature map (the queue runs in the main process, so the
      // renderer would otherwise not know to refetch).
      if (
        state.lastCompletion !== null &&
        state.lastCompletion !== previousReviewCompletionRef.current
      ) {
        void invalidateRepo(queryClient, state.lastCompletion.repoId);
      }
      previousReviewCompletionRef.current = state.lastCompletion;
    });
  }, [queryClient]);

  const activeCommandRepoIds = useCallback((): readonly string[] => {
    const repoIds = new Set<string>();
    const repoCommand = runningRepoCommandRef.current;
    if (repoCommand !== null) {
      repoIds.add(repoCommand.repoId);
    }
    for (const findingCommand of Object.values(runningFindingCommandsRef.current)) {
      repoIds.add(findingCommand.repoId);
    }
    if (runningReviewRepoIdRef.current !== null) {
      repoIds.add(runningReviewRepoIdRef.current);
    }
    return [...repoIds];
  }, []);

  const invalidateProgressForCurrentCommand = useCallback((): void => {
    void invalidateCommandProgress(queryClient, {
      // Suppress feature-map invalidation while a feature review runs (in the
      // renderer or the main-process queue) so the list doesn't reshuffle mid-run.
      includeFeatures:
        !isRunningFeatureReview(runningRepoCommandRef.current) &&
        runningReviewRepoIdRef.current === null,
      repoIds: activeCommandRepoIds(),
    });
  }, [activeCommandRepoIds, queryClient]);

  useEffect(() => {
    // Command output can arrive as many chunks per second. Invalidating queries
    // on every chunk re-spawns `clawpatch status` repeatedly; throttle so bursts
    // coalesce. The 1s interval below is the trailing-edge backstop.
    let trailingTimer: number | null = null;
    let lastInvalidatedAt = 0;
    const dispose = window.clawpatch.commands.onStream((event) => {
      setCommandLog((current) => appendCommandLogEntries(current, [{ kind: "stream", event }]));
      const elapsed = Date.now() - lastInvalidatedAt;
      if (elapsed >= STREAM_INVALIDATE_THROTTLE_MS) {
        lastInvalidatedAt = Date.now();
        invalidateProgressForCurrentCommand();
      } else if (trailingTimer === null) {
        trailingTimer = window.setTimeout(() => {
          trailingTimer = null;
          lastInvalidatedAt = Date.now();
          invalidateProgressForCurrentCommand();
        }, STREAM_INVALIDATE_THROTTLE_MS - elapsed);
      }
    });
    return () => {
      if (trailingTimer !== null) {
        window.clearTimeout(trailingTimer);
      }
      dispose();
    };
  }, [invalidateProgressForCurrentCommand]);

  const commandInterruptMutation = useMutation({
    mutationFn: ({ repo, findingId }: { repo: RepoSummary; findingId?: string }) =>
      window.clawpatch.commands.interrupt(repo.id, findingId),
    onError: (error) => {
      setCommandLog((current) =>
        appendCommandLogEntries(current, [
          { kind: "error", message: error instanceof Error ? error.message : String(error) },
        ]),
      );
    },
  });

  const triageMutation = useMutation({
    mutationFn: async ({
      repo,
      finding,
      status,
      note,
    }: {
      repo: RepoSummary;
      finding: FindingListItem;
      status: ClawpatchStatus;
      note: string;
    }) => {
      const result = await window.clawpatch.triage.set(repo.id, finding.findingId, status, note);
      const persisted = await window.clawpatch.findings.get(repo.id, finding.findingId);
      if (persisted.status !== status) {
        throw new Error(`Status was not saved; persisted status is ${persisted.status}`);
      }
      return { persisted, result };
    },
    onMutate: () => {
      setTriageError(null);
    },
    onSuccess: ({ persisted, result }, variables) => {
      queryClient.setQueryData(
        clawpatchQueryKeys.finding(variables.repo.id, variables.finding.findingId),
        persisted,
      );
      queryClient.setQueryData<readonly FindingListItem[]>(
        clawpatchQueryKeys.findings(variables.repo.id),
        (current) =>
          current?.map((finding) =>
            finding.findingId === persisted.findingId
              ? {
                  ...finding,
                  status: persisted.status,
                  updatedAt: persisted.updatedAt,
                  triage: persisted.triage,
                }
              : finding,
          ),
      );
      setCommandLog((current) =>
        appendCommandLogEntries(current, [
          {
            kind: "result",
            result,
            repoId: variables.repo.id,
            findingId: variables.finding.findingId,
            command: "triage",
          },
        ]),
      );
      setTriageError(null);
      void invalidateRepo(queryClient, variables.repo.id);
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : String(error);
      setTriageError({ findingId: variables.finding.findingId, message });
      setCommandLog((current) =>
        appendCommandLogEntries(current, [
          commandErrorLogEntry(
            variables.repo.id,
            {
              command: "triage",
              findingId: variables.finding.findingId,
              status: variables.status,
              note: variables.note,
            },
            error,
          ),
        ]),
      );
      void invalidateRepo(queryClient, variables.repo.id);
    },
  });

  const queuedReviewFeatureIds =
    selectedRepo === null
      ? []
      : reviewQueueState.queued
          .filter((item) => item.repoId === selectedRepo.id)
          .map((item) => item.featureId);
  const runningReviewFeatureId =
    selectedRepo !== null && reviewQueueState.runningRepoId === selectedRepo.id
      ? reviewQueueState.runningFeatureId
      : null;
  const lastReviewCompletion = reviewQueueState.lastCompletion;

  const isBulkRevalidationRunning = bulkRevalidationProgress !== null;
  const isAnyCommandRunning =
    runningRepoCommand !== null ||
    Object.keys(runningFindingCommands).length > 0 ||
    triageMutation.isPending ||
    isBulkRevalidationRunning ||
    reviewQueueState.runningRepoId !== null;
  const isRepoCommandBusy =
    runningRepoCommand !== null ||
    triageMutation.isPending ||
    queuedReviewFeatureIds.length > 0 ||
    runningReviewFeatureId !== null;

  useEffect(() => {
    if (!isAnyCommandRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      invalidateProgressForCurrentCommand();
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [invalidateProgressForCurrentCommand, isAnyCommandRunning]);

  const nextCommandInvocationId = (): string => {
    commandInvocationSeqRef.current += 1;
    return String(commandInvocationSeqRef.current);
  };

  const appendCommandResults = useCallback(
    (repoId: string, request: ClawpatchCommandRequest, result: CommandResult) => {
      setCommandLog((current) =>
        appendCommandLogEntries(current, commandResultLogEntries(repoId, request, result)),
      );
    },
    [],
  );

  const appendCommandError = useCallback(
    (repoId: string, request: ClawpatchCommandRequest, error: unknown) => {
      setCommandLog((current) =>
        appendCommandLogEntries(current, [commandErrorLogEntry(repoId, request, error)]),
      );
    },
    [],
  );

  const refreshAfterCommand = useCallback(
    async (repoId: string, request: ClawpatchCommandRequest): Promise<void> => {
      await invalidateRepo(queryClient, repoId);
      if (request.command === "fix") {
        await onRevealFirstChangedFile(request.findingId);
      }
    },
    [onRevealFirstChangedFile, queryClient],
  );

  const runRepoCommandOnce = useCallback(
    async (repo: RepoSummary, request: ClawpatchCommandRequest): Promise<boolean> => {
      if (runningRepoCommandRef.current !== null) {
        return false;
      }
      const runningCommand = { request, invocationId: nextCommandInvocationId(), repoId: repo.id };
      runningRepoCommandRef.current = runningCommand;
      setRunningRepoCommand(runningCommand);
      try {
        const result = await window.clawpatch.commands.run(repo.id, request);
        appendCommandResults(repo.id, request, result);
        await refreshAfterCommand(repo.id, request).catch(() => undefined);
      } catch (error: unknown) {
        appendCommandError(repo.id, request, error);
      } finally {
        if (runningRepoCommandRef.current?.invocationId === runningCommand.invocationId) {
          runningRepoCommandRef.current = null;
          setRunningRepoCommand(null);
        }
      }
      return true;
    },
    [appendCommandError, appendCommandResults, refreshAfterCommand],
  );

  const runRepoCommand = useCallback(
    (repo: RepoSummary, request: ClawpatchCommandRequest): void => {
      void runRepoCommandOnce(repo, request);
    },
    [runRepoCommandOnce],
  );

  // Feature reviews are serialized and tracked by the main-process review queue;
  // the renderer just submits and reflects the pushed state. The service dedupes
  // already-pending features, so no local guard is needed.
  const enqueueReviewFeatureCommand = useCallback(
    (repo: RepoSummary, request: ClawpatchCommandRequest): void => {
      void window.clawpatch.reviewQueue.enqueue(repo.id, request);
    },
    [],
  );

  const runFindingCommandOnce = useCallback(
    async (repo: RepoSummary, request: FindingCommandRequest): Promise<boolean> => {
      if (runningFindingCommandsRef.current[request.findingId] !== undefined) {
        return false;
      }
      const runningCommand = { request, invocationId: nextCommandInvocationId(), repoId: repo.id };
      runningFindingCommandsRef.current = {
        ...runningFindingCommandsRef.current,
        [request.findingId]: runningCommand,
      };
      setRunningFindingCommands(runningFindingCommandsRef.current);
      try {
        const result = await window.clawpatch.commands.run(repo.id, request);
        appendCommandResults(repo.id, request, result);
        void refreshAfterCommand(repo.id, request);
      } catch (error: unknown) {
        appendCommandError(repo.id, request, error);
      } finally {
        if (
          runningFindingCommandsRef.current[request.findingId]?.invocationId ===
          runningCommand.invocationId
        ) {
          const next = { ...runningFindingCommandsRef.current };
          delete next[request.findingId];
          runningFindingCommandsRef.current = next;
          setRunningFindingCommands(next);
        }
      }
      return true;
    },
    [appendCommandError, appendCommandResults, refreshAfterCommand],
  );

  const runFindingCommand = useCallback(
    (repo: RepoSummary, request: FindingCommandRequest): void => {
      void runFindingCommandOnce(repo, request);
    },
    [runFindingCommandOnce],
  );

  const runCommand = useCallback(
    (request: ClawpatchCommandRequest): void => {
      if (selectedRepo === null) {
        return;
      }
      if (request.command === "fix" || request.command === "revalidate") {
        runFindingCommand(selectedRepo, request);
        return;
      }
      if (request.command === "review" && request.featureId !== undefined) {
        enqueueReviewFeatureCommand(selectedRepo, request);
        return;
      }
      runRepoCommand(selectedRepo, request);
    },
    [enqueueReviewFeatureCommand, runFindingCommand, runRepoCommand, selectedRepo],
  );

  const interruptCommand = useCallback(
    (findingId?: string): void => {
      if (selectedRepo === null) {
        return;
      }
      commandInterruptMutation.mutate({ repo: selectedRepo, findingId });
    },
    [commandInterruptMutation, selectedRepo],
  );

  const revalidateFindings = useCallback(
    (findings: readonly FindingListItem[]): void => {
      if (selectedRepo === null || findings.length === 0 || isBulkRevalidationRunningRef.current) {
        return;
      }

      const targets = findings.filter(
        (finding) => finding.status === "open" || finding.status === "uncertain",
      );
      if (targets.length === 0) {
        return;
      }

      isBulkRevalidationRunningRef.current = true;
      void (async () => {
        try {
          for (const [index, finding] of targets.entries()) {
            setBulkRevalidationProgress({ current: index + 1, total: targets.length });
            await runFindingCommandOnce(selectedRepo, {
              command: "revalidate",
              findingId: finding.findingId,
            });
          }
        } finally {
          isBulkRevalidationRunningRef.current = false;
          setBulkRevalidationProgress(null);
        }
      })();
    },
    [runFindingCommandOnce, selectedRepo],
  );

  const runFixWithSavedGuidance = useCallback(
    (finding: FindingListItem, status: ClawpatchStatus, note: string): void => {
      if (selectedRepo === null) {
        return;
      }

      const shouldSaveGuidance = note.trim() !== "" || status !== finding.status;
      runFindingCommand(
        selectedRepo,
        shouldSaveGuidance
          ? { command: "fix", findingId: finding.findingId, status, note }
          : { command: "fix", findingId: finding.findingId },
      );
    },
    [runFindingCommand, selectedRepo],
  );

  const triageFinding = useCallback(
    (finding: FindingListItem, status: ClawpatchStatus, note: string): void => {
      if (selectedRepo === null) {
        return;
      }
      triageMutation.mutate({ repo: selectedRepo, finding, status, note });
    },
    [selectedRepo, triageMutation],
  );

  return {
    commandLog,
    bulkRevalidationProgress,
    interruptCommand,
    isRepoCommandBusy,
    isTriagePending: triageMutation.isPending,
    lastReviewCompletion,
    triageError,
    queuedReviewFeatureIds,
    revalidateFindings,
    runCommand,
    runFixWithSavedGuidance,
    recordCommandResult: appendCommandResults,
    runningRepoCommand,
    runningReviewFeatureId,
    runningFindingCommands,
    triageFinding,
  };
}

function isRunningFeatureReview(command: RunningRepoCommand | null): boolean {
  return command?.request.command === "review" && command.request.featureId !== undefined;
}
