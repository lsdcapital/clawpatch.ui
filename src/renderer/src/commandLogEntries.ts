import type { ClawpatchCommandRequest, CommandResult } from "../../shared/types";
import type { ActiveWorkspace, CommandLogEntry } from "./workspaceTypes";

export const MAX_COMMAND_LOG_ENTRIES = 200;

export function appendCommandLogEntries(
  current: readonly CommandLogEntry[],
  entries: readonly CommandLogEntry[],
): CommandLogEntry[] {
  const next = [...current, ...entries];
  return next.length > MAX_COMMAND_LOG_ENTRIES ? next.slice(-MAX_COMMAND_LOG_ENTRIES) : next;
}

export function visibleCommandLogEntries({
  entries,
  selectedRepoId,
  selectedFindingId,
  activeWorkspace,
}: {
  entries: readonly CommandLogEntry[];
  selectedRepoId?: string | null;
  selectedFindingId?: string | null;
  activeWorkspace: ActiveWorkspace;
}): CommandLogEntry[] {
  return entries.filter((entry) => {
    const repoId = entryRepoId(entry);
    if (repoId !== undefined && repoId !== selectedRepoId) {
      return false;
    }

    const findingId = entryFindingId(entry);
    if (activeWorkspace === "reviewQueue") {
      return findingId === undefined;
    }

    return findingId === undefined || findingId === selectedFindingId;
  });
}

export function commandResultLogEntries(
  repoId: string,
  request: ClawpatchCommandRequest,
  result: CommandResult,
): CommandLogEntry[] {
  const findingId = "findingId" in request ? request.findingId : undefined;
  return [
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
  ];
}

export function commandErrorLogEntry(
  repoId: string,
  request: ClawpatchCommandRequest,
  error: unknown,
): CommandLogEntry {
  return {
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
    repoId,
    findingId: "findingId" in request ? request.findingId : undefined,
    command: request.command,
  };
}

function entryRepoId(entry: CommandLogEntry): string | undefined {
  if (entry.kind === "stream") {
    return entry.event.repoId;
  }
  return entry.repoId;
}

function entryFindingId(entry: CommandLogEntry): string | undefined {
  if (entry.kind === "stream") {
    return entry.event.findingId;
  }
  return entry.findingId;
}
