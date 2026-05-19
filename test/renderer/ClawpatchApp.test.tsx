import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClawpatchApp } from "../../src/renderer/src/routes/ClawpatchApp";
import type { Api, CommandResult, FeatureMapSnapshot, RepoSummary } from "../../src/shared/types";

describe("ClawpatchApp header actions", () => {
  it("keeps secondary commands reachable from the overflow menu", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    window.clawpatch = makeApi(run);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ClawpatchApp />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "auth" });

    const moreButton = screen.getByRole("button", { name: "More commands" });
    fireEvent.click(moreButton);

    const menu = screen.getByRole("menu", { name: "Repository commands" });
    expect(within(menu).getByRole("menuitem", { name: "Update map" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Status" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Report" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Doctor" })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Update map" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("repo-auth", { command: "map" }));

    fireEvent.click(moreButton);
    const reopenedMenu = screen.getByRole("menu", { name: "Repository commands" });
    fireEvent.click(within(reopenedMenu).getByRole("menuitem", { name: "Doctor" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("repo-auth", { command: "doctor" }));
    expect(screen.queryByRole("button", { name: "Review next" })).not.toBeInTheDocument();
  });
});

function makeApi(run: Api["commands"]["run"]): Api {
  return {
    repo: {
      list: async () => [makeRepo()],
      add: async () => makeRepo(),
      pickFolder: async () => null,
      refresh: async () => ({
        repo: makeRepo(),
        status: null,
        findings: [],
        diff: "",
        metadata: {
          schemaVersion: 1,
          filters: { severity: null, status: null, search: "" },
          notes: {},
          lastSelectedFindingId: null,
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
      }),
    },
    findings: {
      list: async () => [],
      get: async () => {
        throw new Error("No finding expected");
      },
    },
    features: {
      map: async () => makeFeatureMapSnapshot(),
    },
    triage: {
      set: async () => makeCommandResult("triage"),
    },
    commands: {
      run,
      onStream: () => () => undefined,
    },
    git: {
      diff: async () => "",
    },
  };
}

function makeRepo(): RepoSummary {
  return {
    id: "repo-auth",
    name: "auth",
    path: "/tmp/auth",
    hasClawpatch: true,
    isValid: true,
    lastError: null,
    findingCount: 0,
    openFindingCount: 0,
    updatedAt: "2026-05-19T00:00:00.000Z",
  };
}

function makeFeatureMapSnapshot(): FeatureMapSnapshot {
  return {
    features: [],
    coverage: {
      totalFeatures: 0,
      pendingReviewCount: 0,
      pendingReviewFeatureIds: [],
      latestReviewRun: null,
      latestLimitedReviewRun: null,
      hasLimitedReviewRemainder: false,
    },
  };
}

function makeCommandResult(command: string): CommandResult {
  return {
    runId: `run-${command}`,
    command,
    args: [command],
    cwd: "/tmp/auth",
    exitCode: 0,
    durationMs: 1,
    stdout: "",
    stderr: "",
    parsedJson: null,
  };
}
