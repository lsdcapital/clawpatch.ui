import type { CommandStreamEvent } from "../shared/types";
import { childLogger } from "./logger";

const commandStreamLogger = childLogger("command-stream");

export function emitCommandStream(
  onStream: ((event: CommandStreamEvent) => void) | undefined,
  event: CommandStreamEvent,
): void {
  if (onStream === undefined) {
    return;
  }

  try {
    onStream(event);
  } catch (error) {
    commandStreamLogger.warn(
      {
        err: error,
        kind: event.kind,
        runId: event.runId,
        repoId: event.repoId,
        findingId: event.findingId,
        command: event.command,
        phase: event.kind === "lifecycle" ? event.phase : undefined,
        stream: event.kind === "output" ? event.stream : undefined,
      },
      "Command stream publisher failed",
    );
  }
}
