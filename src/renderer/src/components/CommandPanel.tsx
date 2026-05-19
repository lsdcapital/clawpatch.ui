import { SquareIcon } from "lucide-react";
import type { CommandResult, CommandStreamEvent } from "../../../shared/types";

type Entry =
  | { kind: "stream"; event: CommandStreamEvent }
  | { kind: "result"; result: CommandResult }
  | { kind: "error"; message: string };

export function CommandPanel({
  entries,
  isRunning,
  onInterrupt,
}: {
  entries: Entry[];
  isRunning: boolean;
  onInterrupt: () => void;
}) {
  return (
    <section className="panel command-panel">
      <div className="panel-header">
        <h2>Command Output</h2>
        <div className="command-panel-status">
          <span>{isRunning ? "Running" : "Idle"}</span>
          {isRunning ? (
            <button
              className="icon-button danger"
              onClick={onInterrupt}
              aria-label="Interrupt command"
              title="Interrupt command"
            >
              <SquareIcon aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <pre>
        {entries.length === 0
          ? isRunning
            ? "Command starting..."
            : "No commands run yet."
          : entries
              .map((entry) => {
                if (entry.kind === "stream") {
                  return `[${entry.event.stream}] ${entry.event.chunk}`;
                }
                if (entry.kind === "result") {
                  return `[exit ${entry.result.exitCode ?? "null"}] clawpatch ${entry.result.args.join(" ")} (${entry.result.durationMs}ms)`;
                }
                return `[error] ${entry.message}`;
              })
              .join("\n")}
      </pre>
    </section>
  );
}
