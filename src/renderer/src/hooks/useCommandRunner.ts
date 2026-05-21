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
import { invalidateCommandProgress, invalidateRepo } from "../clawpatchQueries";
import type { CommandLogEntry } from "../workspaceTypes";

type FindingCommandRequest = Extract<ClawpatchCommandRequest, { command: "fix" | "revalidate" }>;
type RunningRepoCommand = {
  request: ClawpatchCommandRequest;
  invocationId: string;
};
export type RunningFindingCommand = {
  request: FindingCommandRequest;
  invocationId: string;
};
export interface BulkRevalidationProgress {
  readonly current: number;
  readonly total: number;
}

export function useCommandRunner({
  selectedRepo,
  onOpenOutput,
  onRevealFirstChangedFile,
}: {
  selectedRepo: RepoSummary | null;
  onOpenOutput: () => void;
  onRevealFirstChangedFile: (findingId: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([]);
  const [runningRepoCommand, setRunningRepoCommand] = useState<RunningRepoCommand | null>(null);
  const [runningFindingCommands, setRunningFindingCommands] = useState<
    Record<string, RunningFindingCommand>
  >({});
  const [bulkRevalidationProgress, setBulkRevalidationProgress] =
    useState<BulkRevalidationProgress | null>(null);
  const commandInvocationSeqRef = useRef(0);
  const runningRepoCommandRef = useRef<RunningRepoCommand | null>(null);
  const runningFindingCommandsRef = useRef<Record<string, RunningFindingCommand>>({});
  const isBulkRevalidationRunningRef = useRef(false);

  useEffect(() => {
    return window.clawpatch.commands.onStream((event) => {
      setCommandLog((current) => appendCommandLogEntries(current, [{ kind: "stream", event }]));
      void invalidateCommandProgress(queryClient);
    });
  }, [queryClient]);

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
      void invalidateRepo(queryClient, variables.repo.id);
    },
    onError: (error) => {
      setCommandLog((current) =>
        appendCommandLogEntries(current, [
          { kind: "error", message: error instanceof Error ? error.message : String(error) },
        ]),
      );
    },
  });

  const isBulkRevalidationRunning = bulkRevalidationProgress !== null;
  const isAnyCommandRunning =
    runningRepoCommand !== null ||
    Object.keys(runningFindingCommands).length > 0 ||
    triageMutation.isPending ||
    isBulkRevalidationRunning;
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

  const runRepoCommand = useCallback(
    (repo: RepoSummary, request: ClawpatchCommandRequest): void => {
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
          void refreshAfterCommand(repo.id, request);
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
    },
    [appendCommandError, appendCommandResults, refreshAfterCommand],
  );

  const runFindingCommandOnce = useCallback(
    async (repo: RepoSummary, request: FindingCommandRequest): Promise<boolean> => {
      if (runningFindingCommandsRef.current[request.findingId] !== undefined) {
        return false;
      }
      const runningCommand = { request, invocationId: nextCommandInvocationId() };
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
      onOpenOutput();
      if (request.command === "fix" || request.command === "revalidate") {
        runFindingCommand(selectedRepo, request);
        return;
      }
      runRepoCommand(selectedRepo, request);
    },
    [onOpenOutput, runFindingCommand, runRepoCommand, selectedRepo],
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

      onOpenOutput();
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
    [onOpenOutput, runFindingCommandOnce, selectedRepo],
  );

  const runFixWithSavedGuidance = useCallback(
    (finding: FindingListItem, status: ClawpatchStatus, note: string): void => {
      if (selectedRepo === null) {
        return;
      }

      onOpenOutput();
      const shouldSaveGuidance = note.trim() !== "" || status !== finding.status;
      runFindingCommand(
        selectedRepo,
        shouldSaveGuidance
          ? { command: "fix", findingId: finding.findingId, status, note }
          : { command: "fix", findingId: finding.findingId },
      );
    },
    [onOpenOutput, runFindingCommand, selectedRepo],
  );

  const triageFinding = useCallback(
    (finding: FindingListItem, status: ClawpatchStatus, note: string): void => {
      if (selectedRepo === null) {
        return;
      }
      onOpenOutput();
      triageMutation.mutate({ repo: selectedRepo, finding, status, note });
    },
    [onOpenOutput, selectedRepo, triageMutation],
  );

  return {
    commandLog,
    bulkRevalidationProgress,
    firstRunningFindingId: Object.keys(runningFindingCommands)[0],
    interruptCommand,
    isAnyCommandRunning,
    isBulkRevalidationRunning,
    isRepoCommandBusy,
    isTriagePending: triageMutation.isPending,
    revalidateFindings,
    runCommand,
    runFixWithSavedGuidance,
    runningRepoCommand,
    runningFindingCommands,
    triageFinding,
  };
}
