import { describe, expect, it } from "vitest";
import {
  commandErrorLogEntry,
  commandResultLogEntries,
  visibleCommandLogEntries,
} from "../../src/renderer/src/commandLogEntries";
import type { CommandResult } from "../../src/shared/types";
import type { CommandLogEntry } from "../../src/renderer/src/workspaceTypes";

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

  it("shows selected finding output and repo-level output in findings context", () => {
    const entries = makeMixedEntries();

    expect(
      visibleCommandLogEntries({
        entries,
        selectedRepoId: "repo-auth",
        selectedFindingId: "fnd-bug",
        activeWorkspace: "findings",
      }),
    ).toEqual([entries[0], entries[2], entries[4], entries[5]]);
  });

  it("hides other finding output in findings context", () => {
    const entries = makeMixedEntries();

    expect(
      visibleCommandLogEntries({
        entries,
        selectedRepoId: "repo-auth",
        selectedFindingId: "fnd-security",
        activeWorkspace: "findings",
      }),
    ).toEqual([entries[0], entries[1], entries[5]]);
  });

  it("shows only repo-level output in review queue context", () => {
    const entries = makeMixedEntries();

    expect(
      visibleCommandLogEntries({
        entries,
        selectedRepoId: "repo-auth",
        selectedFindingId: "fnd-bug",
        activeWorkspace: "reviewQueue",
      }),
    ).toEqual([entries[0], entries[5]]);
  });

  it("hides entries from other repos", () => {
    const entries = makeMixedEntries();

    expect(
      visibleCommandLogEntries({
        entries,
        selectedRepoId: "repo-profile",
        selectedFindingId: "fnd-bug",
        activeWorkspace: "findings",
      }),
    ).toEqual([entries[5]]);
  });
});

function makeMixedEntries(): CommandLogEntry[] {
  return [
    {
      kind: "result",
      repoId: "repo-auth",
      command: "status",
      result: makeCommandResult("status"),
    },
    {
      kind: "result",
      repoId: "repo-auth",
      findingId: "fnd-security",
      command: "fix",
      result: makeCommandResult("fix"),
    },
    {
      kind: "result",
      repoId: "repo-auth",
      findingId: "fnd-bug",
      command: "fix",
      result: makeCommandResult("fix"),
    },
    {
      kind: "result",
      repoId: "repo-billing",
      findingId: "fnd-bug",
      command: "fix",
      result: makeCommandResult("fix"),
    },
    {
      kind: "stream",
      event: {
        kind: "output",
        runId: "run-fix",
        repoId: "repo-auth",
        findingId: "fnd-bug",
        command: "fix",
        stream: "stdout",
        chunk: "fixing bug",
      },
    },
    { kind: "error", message: "unknown failure" },
  ];
}

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
