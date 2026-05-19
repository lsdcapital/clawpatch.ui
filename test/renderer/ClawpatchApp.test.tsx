import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";
import { ClawpatchApp } from "../../src/renderer/src/routes/ClawpatchApp";
import type { Api, CommandResult, FeatureMapSnapshot, RepoSummary } from "../../src/shared/types";

describe("ClawpatchApp header actions", () => {
  it("shows the app brand and package version in the sidebar", async () => {
    window.clawpatch = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    expect(screen.getByText("Clawpatch UI")).toBeInTheDocument();
    expect(screen.getByText(`v${packageJson.version}`)).toBeInTheDocument();
  });

  it("adds repositories from the header plus button", async () => {
    const pickFolder = vi.fn<Api["repo"]["pickFolder"]>(async () => null);
    const api = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));
    api.repo.pickFolder = pickFolder;
    window.clawpatch = api;

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    expect(screen.getByText("Repositories (1)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add repo" })).not.toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: "Add repository" });
    expect(addButton).toHaveAttribute("title", "Add repository");

    fireEvent.click(addButton);

    await waitFor(() => expect(pickFolder).toHaveBeenCalledTimes(1));
  });

  it("keeps secondary commands reachable from the overflow menu", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    window.clawpatch = makeApi(run);

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    const moreButton = screen.getByRole("button", { name: "More commands" });
    fireEvent.click(moreButton);

    const menu = screen.getByRole("menu", { name: "Repository commands" });
    expect(within(menu).queryByRole("menuitem", { name: "Update map" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Status" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Report" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Doctor" })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Doctor" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("repo-auth", { command: "doctor" }));
    expect(screen.queryByRole("button", { name: "Review next" })).not.toBeInTheDocument();
  });

  it("uses one shared inspector for output and diff only", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    window.clawpatch = makeApi(run);

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    expect(
      screen.queryByRole("separator", { name: "Resize inspector pane" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle command output" }));
    expect(screen.getByRole("complementary", { name: "Command output" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Command Output" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize inspector pane" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff panel" }));
    expect(screen.getByRole("complementary", { name: "Git diff" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Git Diff" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Show map table" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /review/i })).not.toBeInTheDocument();
  });

  it("switches between findings and review queue workspaces", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    window.clawpatch = makeApi(run);

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    expect(screen.getByRole("tab", { name: "Findings" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Review Queue" }));
    expect(screen.getByRole("tab", { name: "Review Queue" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Review Queue" })).toBeInTheDocument();
    expect(screen.getByText("2 pending/error of 3 map items")).toBeInTheDocument();
    expect(screen.getByText("Review pending")).toBeInTheDocument();
    expect(screen.queryByText(/Review \d+ remaining/)).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Review queue map" })).toBeInTheDocument();
  });

  it("switches the shared inspector to command output when a review queue command starts", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    window.clawpatch = makeApi(run);

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("tab", { name: "Review Queue" }));

    fireEvent.click(screen.getByRole("button", { name: "Update map" }));

    await waitFor(() => expect(run).toHaveBeenCalledWith("repo-auth", { command: "map" }));
    expect(screen.getByRole("complementary", { name: "Command output" })).toBeInTheDocument();
  });

  it("supports keyboard resizing for the shared inspector", async () => {
    window.clawpatch = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("button", { name: "Toggle command output" }));

    const separator = screen.getByRole("separator", { name: "Resize inspector pane" });
    expect(separator).toHaveAttribute("aria-valuenow", "440");

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "464");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "440");

    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "320");

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "720");
  });
});

function renderApp() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ClawpatchApp />
    </QueryClientProvider>,
  );
}

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
    features: [
      {
        featureId: "feat-auth",
        title: "Authentication",
        status: "pending",
        kind: "feature",
        source: "map",
        ownedFileCount: 1,
        contextFileCount: 1,
        testCount: 1,
        findingCount: 0,
        updatedAt: "2026-05-19T00:00:00.000Z",
      },
      {
        featureId: "feat-profile",
        title: "Profile settings",
        status: "reviewed",
        kind: "feature",
        source: "map",
        ownedFileCount: 2,
        contextFileCount: 0,
        testCount: 1,
        findingCount: 1,
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
      {
        featureId: "feat-billing",
        title: "Billing",
        status: "error",
        kind: "integration",
        source: "manual",
        ownedFileCount: 1,
        contextFileCount: 1,
        testCount: 0,
        findingCount: 0,
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    coverage: {
      totalFeatures: 3,
      pendingReviewCount: 2,
      pendingReviewFeatureIds: ["feat-auth", "feat-billing"],
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
