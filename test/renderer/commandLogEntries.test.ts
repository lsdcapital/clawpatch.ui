import { describe, expect, it } from "vitest";
import {
  commandErrorLogEntry,
  commandResultLogEntries,
} from "../../src/renderer/src/commandLogEntries";
import type { CommandResult } from "../../src/shared/types";

describe("command log entries", () => {
  it("keeps the parent finding id on related command results", () => {
    const entries = commandResultLogEntries(
      "repo-auth",
      { command: "fix", findingId: "fnd-bug" },
      makeCommandResult("fix", [
        makeCommandResult("revalidate", undefined, ["clawpatch", "revalidate", "--finding"]),
      ]),
    );

    expect(entries).toMatchObject([
      { kind: "result", repoId: "repo-auth", findingId: "fnd-bug", command: "fix" },
      { kind: "result", repoId: "repo-auth", findingId: "fnd-bug", command: "revalidate" },
    ]);
  });

  it("normalizes unknown command errors into log entries", () => {
    expect(commandErrorLogEntry("repo-auth", { command: "review", limit: 1 }, "failed")).toEqual({
      kind: "error",
      message: "failed",
      repoId: "repo-auth",
      findingId: undefined,
      command: "review",
    });
  });
});

function makeCommandResult(
  command: string,
  relatedResults?: CommandResult["relatedResults"],
  args: string[] = [command],
): CommandResult {
  return {
    runId: `run-${command}`,
    command,
    args,
    cwd: "/tmp/auth",
    exitCode: 0,
    durationMs: 1,
    stdout: "",
    stderr: "",
    parsedJson: null,
    ...(relatedResults === undefined ? {} : { relatedResults }),
  };
}
