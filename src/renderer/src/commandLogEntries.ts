import type { ClawpatchCommandRequest, CommandResult } from "../../shared/types";
import type { CommandLogEntry } from "./workspaceTypes";

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
