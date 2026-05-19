import type { CommandResult, CommandStreamEvent } from "../../../shared/types";

type Entry =
  | { kind: "stream"; event: CommandStreamEvent }
  | { kind: "result"; result: CommandResult }
  | { kind: "error"; message: string };

export function CommandPanel({ entries, isRunning }: { entries: Entry[]; isRunning: boolean }) {
  return (
    <section className="panel command-panel">
      <div className="panel-header">
        <h2>Command Output</h2>
        <span>{isRunning ? "Running" : "Idle"}</span>
      </div>
      <pre>
        {entries.length === 0
          ? "No commands run yet."
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
