import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";
import { ClawpatchApp } from "../../src/renderer/src/routes/ClawpatchApp";
import type {
  Api,
  CommandResult,
  CommandStreamEvent,
  FeatureMapSnapshot,
  FindingDetail,
  FindingListItem,
  RepoSummary,
} from "../../src/shared/types";

const repoSidebarCollapsedStorageKey = "clawpatch.repoSidebarCollapsed.v1";

describe("ClawpatchApp header actions", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("shows the app brand and package version in the sidebar", async () => {
    window.clawpatch = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    expect(screen.getByText("Clawpatch UI")).toBeInTheDocument();
    expect(screen.getByText(`v${packageJson.version}`)).toBeInTheDocument();
  });

  it("hides and restores the repositories panel from the workspace header", async () => {
    window.clawpatch = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    const hideButton = screen.getByRole("button", { name: "Hide repositories panel" });
    expect(hideButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Clawpatch UI")).toBeInTheDocument();
    expect(screen.getByText("Repositories (1)")).toBeInTheDocument();

    fireEvent.click(hideButton);

    expect(screen.queryByText("Clawpatch UI")).not.toBeInTheDocument();
    expect(screen.queryByText("Repositories (1)")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "auth" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show repositories panel" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(window.localStorage.getItem(repoSidebarCollapsedStorageKey)).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Show repositories panel" }));

    expect(screen.getByText("Clawpatch UI")).toBeInTheDocument();
    expect(screen.getByText("Repositories (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide repositories panel" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(window.localStorage.getItem(repoSidebarCollapsedStorageKey)).toBe("false");
  });

  it("loads the repositories panel collapsed from local storage", async () => {
    window.localStorage.setItem(repoSidebarCollapsedStorageKey, "true");
    window.clawpatch = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    expect(screen.queryByText("Clawpatch UI")).not.toBeInTheDocument();
    expect(screen.queryByText("Repositories (1)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show repositories panel" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
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

  it("refreshes the review queue during command output", async () => {
    let streamListener: ((event: CommandStreamEvent) => void) | null = null;
    const featureMap = vi
      .fn<Api["features"]["map"]>()
      .mockResolvedValueOnce(makeFeatureMapSnapshot())
      .mockResolvedValue(makeFeatureMapSnapshotAfterOneReview());
    const repoList = vi.fn<Api["repo"]["list"]>(async () => [makeRepo()]);
    const findingsList = vi.fn<Api["findings"]["list"]>(async () => []);
    const gitDiff = vi.fn<Api["git"]["diff"]>(async () => "");
    const onStream = vi.fn<Api["commands"]["onStream"]>((listener) => {
      streamListener = listener;
      return () => {
        streamListener = null;
      };
    });
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("review")),
      {
        featureMap,
        findingsList,
        gitDiff,
        onStream,
        repoList,
      },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("tab", { name: "Review Queue" }));
    expect(screen.getByText("2 pending/error of 3 map items")).toBeInTheDocument();
    await waitFor(() => expect(repoList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(findingsList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(featureMap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(1));

    if (streamListener === null) {
      throw new Error("stream listener was not registered");
    }

    act(() => {
      streamListener?.({
        runId: "run-review",
        stream: "stderr",
        chunk: "[stderr] clawpatch review claimed index=1 total=2 feature=feat-auth\n",
      });
    });

    await waitFor(() => expect(repoList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(findingsList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(featureMap).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(2));
    await screen.findByText("1 pending/error of 3 map items");
    expect(screen.queryByText("Authentication")).not.toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });

  it("revalidates the selected finding and opens command output", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    window.clawpatch = makeApi(run, { findings: [makeFinding()], findingDetail: makeFinding() });

    renderApp();

    await screen.findByRole("heading", { name: "Token is logged in debug output" });
    fireEvent.click(screen.getByRole("button", { name: "Revalidate" }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("repo-auth", {
        command: "revalidate",
        findingId: "fnd-security",
      }),
    );
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

  it("saves the current note before running fix", async () => {
    const calls: string[] = [];
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) => {
      calls.push(`run:${request.command}`);
      return makeCommandResult(request.command);
    });
    const triageSet = vi.fn<Api["triage"]["set"]>(async () => {
      calls.push("triage");
      return makeCommandResult("triage");
    });
    const finding = makeFixFinding();
    window.clawpatch = makeApi(run, { findings: [finding], findingDetail: finding, triageSet });

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    fireEvent.change(screen.getByLabelText("Note for triage and fix"), {
      target: { value: "Prefer the existing parser helper." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("repo-auth", {
        command: "fix",
        findingId: "fnd-bug",
      }),
    );
    expect(triageSet).toHaveBeenCalledWith(
      "repo-auth",
      "fnd-bug",
      "open",
      "Prefer the existing parser helper.",
    );
    expect(calls).toEqual(["triage", "run:fix"]);
  });

  it("does not run fix when saving the note fails", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    const triageSet = vi.fn<Api["triage"]["set"]>(async () => {
      throw new Error("triage failed");
    });
    const finding = makeFixFinding();
    window.clawpatch = makeApi(run, { findings: [finding], findingDetail: finding, triageSet });

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    fireEvent.change(screen.getByLabelText("Note for triage and fix"), {
      target: { value: "Try the smaller compatibility fix." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));

    await waitFor(() => expect(triageSet).toHaveBeenCalledTimes(1));
    await screen.findByText("[error] triage failed");
    expect(run).not.toHaveBeenCalled();
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

function installLocalStorage(): void {
  const values = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    },
  });
}

function makeApi(
  run: Api["commands"]["run"],
  options: {
    findings?: readonly FindingListItem[];
    findingsList?: Api["findings"]["list"];
    featureMap?: Api["features"]["map"];
    findingDetail?: FindingDetail;
    gitDiff?: Api["git"]["diff"];
    onStream?: Api["commands"]["onStream"];
    repoList?: Api["repo"]["list"];
    triageSet?: Api["triage"]["set"];
  } = {},
): Api {
  return {
    repo: {
      list: options.repoList ?? (async () => [makeRepo()]),
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
          lastSelectedFindingId: null,
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
      }),
    },
    findings: {
      list: options.findingsList ?? (async () => options.findings ?? []),
      get: async () => {
        if (options.findingDetail === undefined) {
          throw new Error("No finding expected");
        }
        return options.findingDetail;
      },
    },
    features: {
      map: options.featureMap ?? (async () => makeFeatureMapSnapshot()),
    },
    triage: {
      set: options.triageSet ?? (async () => makeCommandResult("triage")),
    },
    commands: {
      run,
      onStream: options.onStream ?? (() => () => undefined),
    },
    git: {
      diff: options.gitDiff ?? (async () => ""),
    },
  };
}

function makeFinding(): FindingDetail {
  return {
    findingId: "fnd-security",
    featureId: "feat-auth",
    title: "Token is logged in debug output",
    category: "security",
    severity: "high",
    confidence: "high",
    triage: null,
    status: "open",
    evidence: [],
    linkedPatchAttemptIds: [],
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    reasoning: "Token values should not be written to logs.",
    reproduction: null,
    recommendation: "Remove the log.",
    whyTestsDoNotAlreadyCoverThis: null,
    suggestedRegressionTest: null,
    minimumFixScope: null,
    feature: null,
    patchAttempts: [],
    history: [],
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

function makeFeatureMapSnapshotAfterOneReview(): FeatureMapSnapshot {
  return {
    features: [
      {
        featureId: "feat-auth",
        title: "Authentication",
        status: "reviewed",
        kind: "feature",
        source: "map",
        ownedFileCount: 1,
        contextFileCount: 1,
        testCount: 1,
        findingCount: 1,
        updatedAt: "2026-05-19T00:01:00.000Z",
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
      pendingReviewCount: 1,
      pendingReviewFeatureIds: ["feat-billing"],
      latestReviewRun: null,
      latestLimitedReviewRun: null,
      hasLimitedReviewRemainder: false,
    },
  };
}

function makeFixFinding(): FindingDetail {
  return {
    findingId: "fnd-bug",
    featureId: "feat-profile",
    title: "Null branch can throw",
    category: "bug",
    severity: "medium",
    confidence: "high",
    triage: null,
    status: "open",
    evidence: [
      {
        path: "src/profile.ts",
        startLine: 12,
        endLine: 14,
        symbol: "loadProfile",
        quote: "return branch.name",
      },
    ],
    linkedPatchAttemptIds: [],
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    reasoning: "The branch can be null before the name access.",
    reproduction: null,
    recommendation: "Guard the nullable branch before reading its name.",
    whyTestsDoNotAlreadyCoverThis: null,
    suggestedRegressionTest: null,
    minimumFixScope: null,
    feature: null,
    patchAttempts: [],
    history: [],
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
