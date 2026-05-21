import { useMemo } from "react";
import { SquareIcon } from "lucide-react";
import type { CommandLogEntry } from "../workspaceTypes";
import { IconButton } from "./IconButton";

export function CommandPanel({
  entries,
  isRunning,
  onInterrupt,
}: {
  entries: CommandLogEntry[];
  isRunning: boolean;
  onInterrupt: () => void;
}) {
  const output = useMemo(() => formatCommandOutput(entries, isRunning), [entries, isRunning]);

  return (
    <section className="panel command-panel">
      <div className="panel-header">
        <h2>Command Output</h2>
        <div className="command-panel-status">
          <span>{isRunning ? "Running" : "Idle"}</span>
          {isRunning ? (
            <IconButton
              className="icon-button danger"
              onClick={onInterrupt}
              icon={<SquareIcon aria-hidden="true" />}
              label="Interrupt command"
            />
          ) : null}
        </div>
      </div>
      <pre>{output}</pre>
    </section>
  );
}

function formatCommandOutput(entries: readonly CommandLogEntry[], isRunning: boolean): string {
  if (entries.length === 0) {
    return isRunning ? "Command starting..." : "No commands run yet.";
  }
  return entries
    .map((entry) => {
      if (entry.kind === "stream") {
        if (entry.event.kind === "output") {
          return `${entryLabel(entry.event)}[${entry.event.stream}] ${entry.event.chunk}`;
        }
        return `${entryLabel(entry.event)}[${entry.event.phase}] ${entry.event.message} (cwd: ${entry.event.cwd})`;
      }
      if (entry.kind === "result") {
        return `${entryLabel(entry)}[exit ${
          entry.result.exitCode ?? "null"
        }] clawpatch ${entry.result.args.join(" ")} (${entry.result.durationMs}ms)`;
      }
      return `${entryLabel(entry)}[error] ${entry.message}`;
    })
    .join("\n");
}

function entryLabel(entry: { readonly findingId?: string; readonly command?: string }): string {
  const parts = [entry.findingId, entry.command].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return parts.length === 0 ? "" : `[${parts.join(" ")}] `;
}
