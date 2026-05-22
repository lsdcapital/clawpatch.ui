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

  let output = "";
  let previousOutputKey: string | null = null;

  const appendLine = (line: string): void => {
    if (output !== "" && !output.endsWith("\n")) {
      output += "\n";
    }
    output += line;
    previousOutputKey = null;
  };

  for (const entry of entries) {
    if (entry.kind === "stream") {
      if (entry.event.kind === "output") {
        const outputKey = outputEntryKey(entry.event);
        if (previousOutputKey !== outputKey) {
          if (output !== "" && !output.endsWith("\n")) {
            output += "\n";
          }
          output += `${entryLabel(entry.event)}[${entry.event.stream}] `;
        }
        output += entry.event.chunk;
        previousOutputKey = outputKey;
      } else {
        appendLine(
          `${entryLabel(entry.event)}[${entry.event.phase}] ${entry.event.message} (cwd: ${entry.event.cwd})`,
        );
      }
    } else if (entry.kind === "result") {
      appendLine(
        `${entryLabel(entry)}[exit ${
          entry.result.exitCode ?? "null"
        }] clawpatch ${entry.result.args.join(" ")} (${entry.result.durationMs}ms)`,
      );
    } else {
      appendLine(`${entryLabel(entry)}[error] ${entry.message}`);
    }
  }

  return output;
}

function entryLabel(entry: { readonly findingId?: string; readonly command?: string }): string {
  const parts = [entry.findingId, entry.command].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return parts.length === 0 ? "" : `[${parts.join(" ")}] `;
}

function outputEntryKey(entry: {
  readonly findingId?: string;
  readonly command?: string;
  readonly stream: string;
}): string {
  return `${entry.findingId ?? ""}\0${entry.command ?? ""}\0${entry.stream}`;
}
