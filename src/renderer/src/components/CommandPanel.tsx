import { SquareIcon } from "lucide-react";
import type { CommandLogEntry } from "../workspaceTypes";

export function CommandPanel({
  entries,
  isRunning,
  onInterrupt,
}: {
  entries: CommandLogEntry[];
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
                  return `${entryLabel(entry.event)}[${entry.event.stream}] ${entry.event.chunk}`;
                }
                if (entry.kind === "result") {
                  return `${entryLabel(entry)}[exit ${
                    entry.result.exitCode ?? "null"
                  }] clawpatch ${entry.result.args.join(" ")} (${entry.result.durationMs}ms)`;
                }
                return `${entryLabel(entry)}[error] ${entry.message}`;
              })
              .join("\n")}
      </pre>
    </section>
  );
}

function entryLabel(entry: { readonly findingId?: string; readonly command?: string }): string {
  const parts = [entry.findingId, entry.command].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return parts.length === 0 ? "" : `[${parts.join(" ")}] `;
}
