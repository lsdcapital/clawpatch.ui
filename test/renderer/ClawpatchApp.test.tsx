import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const selectedRepoStorageKey = "clawpatch.selectedRepoId.v1";

describe("ClawpatchApp header actions", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the app brand and package version in the sidebar", async () => {
    window.clawpatch = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    expect(screen.getByText("Clawpatch UI")).toBeInTheDocument();
    expect(screen.getByText(`v${packageJson.version}`)).toBeInTheDocument();
  });

  it("hides and restores the repositories panel from the left sidebar rail", async () => {
    window.clawpatch = makeApi(vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")));

    renderApp();

    await screen.findByRole("heading", { name: "auth" });

    const hideButton = screen.getByRole("button", { name: "Hide repositories panel" });
    expect(hideButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Clawpatch UI")).toBeInTheDocument();
    expect(screen.getByText("Repositories (1)")).toBeInTheDocument();

    fireEvent.click(hideButton);

    const rail = screen.getByRole("complementary", { name: "Repositories sidebar" });
    expect(screen.queryByText("Clawpatch UI")).not.toBeInTheDocument();
    expect(screen.queryByText("Repositories (1)")).not.toBeInTheDocument();
    expect(rail.querySelector(".sidebar-logo-mark")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "auth" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Show repositories panel" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(rail).getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(window.localStorage.getItem(repoSidebarCollapsedStorageKey)).toBe("true");

    fireEvent.click(within(rail).getByRole("button", { name: "Show repositories panel" }));

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

    const rail = screen.getByRole("complementary", { name: "Repositories sidebar" });
    expect(screen.queryByText("Clawpatch UI")).not.toBeInTheDocument();
    expect(screen.queryByText("Repositories (1)")).not.toBeInTheDocument();
    expect(rail.querySelector(".sidebar-logo-mark")).not.toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Show repositories panel" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(rail).getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("opens a terminal for the selected finding context from the header", async () => {
    const finding = makeFixFinding();
    const terminalOpen = vi.fn<Api["terminal"]["open"]>(async () => ({
      cwd: "/tmp/clawpatch-ui/worktrees/repo-auth/fnd-bug",
    }));
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        findings: [finding],
        findingDetail: finding,
        terminalOpen,
      },
    );

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));

    await waitFor(() => expect(terminalOpen).toHaveBeenCalledWith("repo-auth", "fnd-bug"));
  });

  it("shows terminal launch errors under the header", async () => {
    const terminalOpen = vi.fn<Api["terminal"]["open"]>(async () => {
      throw new Error("Opening Terminal is only supported on macOS for now");
    });
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { terminalOpen },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));

    await screen.findByText("Opening Terminal is only supported on macOS for now");
  });

  it("polls the selected repository git status and updates the strip", async () => {
    vi.useFakeTimers();
    let status = { staged: 0, modified: 0, untracked: 0, branch: "main" };
    const gitStatus = vi.fn<Api["git"]["status"]>(async () => status);
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { gitStatus },
    );

    renderApp();

    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { name: "auth" })).toBeInTheDocument(),
    );
    await vi.waitFor(() => expect(screen.getByText("branch main")).toBeInTheDocument());
    expect(screen.getByText("Working tree clean")).toBeInTheDocument();
    expect(gitStatus).toHaveBeenCalledWith("repo-auth", undefined);

    status = { staged: 0, modified: 1, untracked: 1, branch: "feature/status" };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await vi.waitFor(() => expect(screen.getByText("branch feature/status")).toBeInTheDocument());
    expect(screen.getByText("1 modified · 1 untracked")).toBeInTheDocument();
  });

  it("keeps the git status strip mounted while selected finding status loads", async () => {
    const highRiskFinding = makeFinding();
    const lowerRiskFinding = makeFixFinding();
    const findingsById = new Map([
      [highRiskFinding.findingId, highRiskFinding],
      [lowerRiskFinding.findingId, lowerRiskFinding],
    ]);
    let resolveLowerRiskStatus:
      | ((status: Awaited<ReturnType<Api["git"]["status"]>>) => void)
      | undefined;
    const findingGet = vi.fn<Api["findings"]["get"]>(async (_repoId, findingId) => {
      const finding = findingsById.get(findingId);
      if (finding === undefined) {
        throw new Error(`Missing finding ${findingId}`);
      }
      return finding;
    });
    const gitStatus = vi.fn<Api["git"]["status"]>(async (_repoId, findingId) => {
      if (findingId === lowerRiskFinding.findingId) {
        return new Promise((resolve) => {
          resolveLowerRiskStatus = resolve;
        });
      }
      return { staged: 0, modified: 0, untracked: 0, branch: "main" };
    });
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        findings: [highRiskFinding, lowerRiskFinding],
        findingGet,
        gitStatus,
      },
    );

    renderApp();

    await screen.findByText("branch main");
    const statusStrip = screen.getByRole("status");
    fireEvent.click(screen.getByText("Null branch can throw"));

    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith("repo-auth", "fnd-bug"));
    expect(screen.getByRole("status")).toBe(statusStrip);
    expect(screen.getByText("branch main")).toBeInTheDocument();

    await act(async () => {
      resolveLowerRiskStatus?.({
        staged: 0,
        modified: 1,
        untracked: 0,
        branch: "feature/bug",
      });
    });

    await screen.findByText("branch feature/bug");
    expect(screen.getByText("1 modified")).toBeInTheDocument();
  });

  it("does not poll git status when no repository is selected", async () => {
    vi.useFakeTimers();
    const gitStatus = vi.fn<Api["git"]["status"]>(async () => ({
      staged: 0,
      modified: 0,
      untracked: 0,
      branch: "main",
    }));
    const repoList = vi.fn<Api["repo"]["list"]>(async () => []);
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        gitStatus,
        repoList,
      },
    );

    renderApp();

    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { name: "Clawpatch" })).toBeInTheDocument(),
    );
    await vi.waitFor(() => expect(repoList).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(gitStatus).not.toHaveBeenCalled();
  });

  it("restores the last selected repository from local storage", async () => {
    window.localStorage.setItem(selectedRepoStorageKey, "repo-billing");
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { repoList: async () => [makeRepo(), makeRepo({ id: "repo-billing", name: "billing" })] },
    );

    renderApp();

    await screen.findByRole("heading", { name: "billing" });

    expect(screen.getByRole("heading", { name: "billing" }).nextSibling).toHaveTextContent(
      "/tmp/billing",
    );
    expect(window.localStorage.getItem(selectedRepoStorageKey)).toBe("repo-billing");
  });

  it("falls back to the first repository when the stored repository is stale", async () => {
    window.localStorage.setItem(selectedRepoStorageKey, "repo-missing");
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { repoList: async () => [makeRepo(), makeRepo({ id: "repo-billing", name: "billing" })] },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    await waitFor(() =>
      expect(window.localStorage.getItem(selectedRepoStorageKey)).toBe("repo-auth"),
    );
  });

  it("saves the selected repository from the sidebar", async () => {
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { repoList: async () => [makeRepo(), makeRepo({ id: "repo-billing", name: "billing" })] },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("button", { name: /billing/i }));

    await screen.findByRole("heading", { name: "billing" });
    expect(window.localStorage.getItem(selectedRepoStorageKey)).toBe("repo-billing");
  });

  it("saves the newly added repository as the last selected repository", async () => {
    const billingRepo = makeRepo({ id: "repo-billing", name: "billing" });
    const add = vi.fn<Api["repo"]["add"]>(async () => billingRepo);
    const pickFolder = vi.fn<Api["repo"]["pickFolder"]>(async () => "/tmp/billing");
    const repoList = vi
      .fn<Api["repo"]["list"]>()
      .mockResolvedValueOnce([makeRepo()])
      .mockResolvedValue([makeRepo(), billingRepo]);
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { add, pickFolder, repoList },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));

    await waitFor(() => expect(add).toHaveBeenCalledWith("/tmp/billing"));
    await screen.findByRole("heading", { name: "billing" });
    expect(window.localStorage.getItem(selectedRepoStorageKey)).toBe("repo-billing");
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

  it("sorts repositories from the sidebar sort selector", async () => {
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        repoList: async () => [
          makeRepo(),
          makeRepo({
            id: "repo-billing",
            name: "billing",
            path: "/work/billing-api",
            updatedAt: "2026-05-20T00:00:00.000Z",
          }),
          makeRepo({
            id: "repo-profile",
            name: "profile",
            path: "/work/profile",
            updatedAt: "2026-05-19T00:00:00.000Z",
          }),
        ],
      },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    const sortSelect = screen.getByLabelText("Sort by");
    expect(screen.queryByPlaceholderText("Filter repos")).not.toBeInTheDocument();
    expect(sortSelect).toHaveValue("created");
    expect(repoPathOrder()).toEqual(["/tmp/auth", "/work/billing-api", "/work/profile"]);

    fireEvent.change(sortSelect, { target: { value: "updated" } });

    expect(repoPathOrder()).toEqual(["/work/billing-api", "/tmp/auth", "/work/profile"]);
  });

  it("opens and saves repository settings from a full settings page", async () => {
    const getSettings = vi.fn<Api["repo"]["getSettings"]>(async () => ({
      schemaVersion: 1,
      terminalAppName: "Terminal",
      terminalStartupScript: "",
      worktreeSetupScript: "",
      updatedAt: "2026-05-19T00:00:00.000Z",
    }));
    const updateSettings = vi.fn<Api["repo"]["updateSettings"]>(async (_repoId, settings) => ({
      ...settings,
      updatedAt: "2026-05-20T00:00:00.000Z",
    }));
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { repoGetSettings: getSettings, repoUpdateSettings: updateSettings },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("button", { name: "Repository settings" }));

    expect(await screen.findByRole("heading", { name: "auth" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Repository Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to app" })).toBeInTheDocument();
    expect(getSettings).toHaveBeenCalledWith("repo-auth");

    fireEvent.change(await screen.findByLabelText("Terminal app"), { target: { value: "iTerm" } });
    fireEvent.change(await screen.findByLabelText("Terminal startup script"), {
      target: { value: "pnpm dev" },
    });
    fireEvent.change(await screen.findByLabelText("Worktree setup script"), {
      target: { value: "pnpm install" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        "repo-auth",
        expect.objectContaining({
          terminalAppName: "iTerm",
          terminalStartupScript: "pnpm dev",
          worktreeSetupScript: "pnpm install",
        }),
      ),
    );
    expect(screen.getByRole("heading", { name: "auth" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));

    expect(await screen.findByRole("heading", { name: "auth" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Findings" })).toBeInTheDocument();
  });

  it("shows read-only General settings without loading repository settings", async () => {
    const getSettings = vi.fn<Api["repo"]["getSettings"]>(async () => ({
      schemaVersion: 1,
      terminalAppName: "Terminal",
      terminalStartupScript: "",
      worktreeSetupScript: "",
      updatedAt: "2026-05-19T00:00:00.000Z",
    }));
    const doctor = vi.fn<Api["repo"]["doctor"]>(async () => ({
      ...makeCommandResult("doctor"),
      command: "clawpatch",
      parsedJson: { checks: [{ name: "CLI", status: "ok" }] },
    }));
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { repoDoctor: doctor, repoGetSettings: getSettings },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    expect(screen.getByRole("button", { name: "Add repository" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Clawpatch UI")).toBeInTheDocument();
    expect(screen.getByText(`v${packageJson.version}`)).toBeInTheDocument();
    expect(screen.getAllByText("Repositories").length).toBeGreaterThan(0);
    expect(await screen.findByText(/"status": "ok"/)).toBeInTheDocument();
    expect(doctor).toHaveBeenCalledWith("repo-auth");
    expect(getSettings).not.toHaveBeenCalled();
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
    expect(within(menu).queryByRole("menuitem", { name: "Report" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Doctor" })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Status" }));
    await waitFor(() => expect(run).toHaveBeenCalledWith("repo-auth", { command: "status" }));
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
    expect(
      screen.getByRole("button", { name: "Review all 2 pending and error map items" }),
    ).toBeInTheDocument();
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
        kind: "output",
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

  it("retains only the latest command stream entries", async () => {
    let streamListener: ((event: CommandStreamEvent) => void) | null = null;
    const onStream = vi.fn<Api["commands"]["onStream"]>((listener) => {
      streamListener = listener;
      return () => {
        streamListener = null;
      };
    });
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("status")),
      { onStream },
    );

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("button", { name: "Toggle command output" }));
    if (streamListener === null) {
      throw new Error("stream listener was not registered");
    }

    act(() => {
      for (let index = 0; index < 205; index += 1) {
        streamListener?.({
          kind: "output",
          runId: "run-status",
          stream: "stdout",
          chunk: `chunk-${index}\n`,
        });
      }
    });

    const output = screen.getByRole("complementary", { name: "Command output" });
    expect(output.textContent).not.toContain("[stdout] chunk-4\n");
    expect(output.textContent).toContain("[stdout] chunk-5\n");
    expect(output.textContent).toContain("[stdout] chunk-204\n");
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

  it("revalidates visible actionable findings sequentially from the findings header", async () => {
    const highRiskFinding = makeFinding();
    const lowerRiskFinding: FindingDetail = { ...makeFixFinding(), status: "uncertain" };
    const fixedFinding: FindingDetail = {
      ...makeFixFinding(),
      findingId: "fnd-fixed",
      title: "Already fixed branch",
      severity: "low",
      status: "fixed",
    };
    const findingsById = new Map(
      [highRiskFinding, lowerRiskFinding, fixedFinding].map((finding) => [
        finding.findingId,
        finding,
      ]),
    );
    const resolvers = new Map<string, (result: CommandResult) => void>();
    const run = vi.fn<Api["commands"]["run"]>(
      (_repoId, request) =>
        new Promise<CommandResult>((resolve) => {
          if ("findingId" in request) {
            resolvers.set(request.findingId, resolve);
            return;
          }
          resolve(makeCommandResult(request.command));
        }),
    );
    window.clawpatch = makeApi(run, {
      findings: [fixedFinding, lowerRiskFinding, highRiskFinding],
      findingGet: async (_repoId, findingId) => {
        const finding = findingsById.get(findingId);
        if (finding === undefined) {
          throw new Error(`Missing finding ${findingId}`);
        }
        return finding;
      },
    });

    renderApp();

    await screen.findByRole("heading", { name: "Token is logged in debug output" });
    fireEvent.click(screen.getByText("Filter"));
    const statusGroup = screen
      .getAllByText("Status")
      .find((element) => element.closest(".filter-group"))
      ?.closest(".filter-group");
    expect(statusGroup).not.toBeNull();
    fireEvent.click(within(statusGroup as HTMLElement).getByRole("button", { name: "All" }));
    expect(screen.getByText("Already fixed branch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revalidate shown" }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("repo-auth", {
        command: "revalidate",
        findingId: "fnd-security",
      }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Revalidating 1/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revalidate shown" })).toBeDisabled();
    expect(screen.getByRole("complementary", { name: "Command output" })).toBeInTheDocument();

    resolvers.get("fnd-security")?.(makeCommandResult("revalidate"));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("repo-auth", {
        command: "revalidate",
        findingId: "fnd-bug",
      }),
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Revalidating 2/2")).toBeInTheDocument();

    resolvers.get("fnd-bug")?.(makeCommandResult("revalidate"));

    await waitFor(() => expect(screen.queryByText(/Revalidating/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Revalidate shown" })).not.toBeDisabled();
    expect(run).not.toHaveBeenCalledWith("repo-auth", {
      command: "revalidate",
      findingId: "fnd-fixed",
    });
  });

  it("keeps other finding fix controls available while one finding is running", async () => {
    const highRiskFinding = makeFinding();
    const lowerRiskFinding = makeFixFinding();
    const findingsById = new Map([
      [highRiskFinding.findingId, highRiskFinding],
      [lowerRiskFinding.findingId, lowerRiskFinding],
    ]);
    const resolvers = new Map<string, (result: CommandResult) => void>();
    const run = vi.fn<Api["commands"]["run"]>(
      (_repoId, request) =>
        new Promise<CommandResult>((resolve) => {
          if ("findingId" in request) {
            resolvers.set(request.findingId, resolve);
          } else {
            resolve(makeCommandResult(request.command));
          }
        }),
    );
    window.clawpatch = makeApi(run, {
      findings: [highRiskFinding, lowerRiskFinding],
      findingGet: async (_repoId, findingId) => {
        const finding = findingsById.get(findingId);
        if (finding === undefined) {
          throw new Error(`Missing finding ${findingId}`);
        }
        return finding;
      },
    });

    renderApp();

    await screen.findByRole("heading", { name: "Token is logged in debug output" });
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    await screen.findByText("fix running");
    expect(screen.getByRole("button", { name: "Run fix" })).toBeDisabled();

    fireEvent.click(screen.getByText("Null branch can throw"));
    await screen.findByRole("heading", { name: "Null branch can throw" });
    expect(screen.getByRole("button", { name: "Run fix" })).not.toBeDisabled();

    resolvers.get("fnd-security")?.(makeCommandResult("fix"));
  });

  it("interrupts the selected finding command by finding id", async () => {
    const finding = makeFixFinding();
    let resolveRun: ((result: CommandResult) => void) | undefined;
    const run = vi.fn<Api["commands"]["run"]>(
      (_repoId, request) =>
        new Promise<CommandResult>((resolve) => {
          resolveRun = () => resolve(makeCommandResult(request.command));
        }),
    );
    const interrupt = vi.fn<Api["commands"]["interrupt"]>(async () => ({ interrupted: true }));
    window.clawpatch = makeApi(run, { findings: [finding], findingDetail: finding, interrupt });

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    await screen.findByText("fix running");
    fireEvent.click(screen.getByRole("button", { name: "Interrupt finding command" }));

    await waitFor(() => expect(interrupt).toHaveBeenCalledWith("repo-auth", "fnd-bug"));
    resolveRun?.(makeCommandResult("fix"));
  });

  it("selects the first sorted finding when the loaded list is unsorted", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    const highRiskFinding = makeFinding();
    const lowerRiskFinding = makeFixFinding();
    window.clawpatch = makeApi(run, {
      findings: [lowerRiskFinding, highRiskFinding],
      findingDetail: highRiskFinding,
    });

    renderApp();

    await screen.findByRole("heading", { name: "Token is logged in debug output" });
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Token is logged in debug output");
  });

  it("interrupts a running command from command output", async () => {
    let resolveRun: ((result: CommandResult) => void) | undefined;
    const run = vi.fn<Api["commands"]["run"]>(
      (_repoId, request) =>
        new Promise<CommandResult>((resolve) => {
          resolveRun = () => resolve(makeCommandResult(request.command));
        }),
    );
    const interrupt = vi.fn<Api["commands"]["interrupt"]>(async () => ({ interrupted: true }));
    window.clawpatch = makeApi(run, { interrupt });

    renderApp();

    await screen.findByRole("heading", { name: "auth" });
    fireEvent.click(screen.getByRole("button", { name: "Toggle command output" }));
    expect(screen.queryByRole("button", { name: "Interrupt command" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More commands" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Status" }));

    await waitFor(() => expect(run).toHaveBeenCalledWith("repo-auth", { command: "status" }));
    expect(screen.getByText("Command starting...")).toBeInTheDocument();
    expect(screen.queryByText("No commands run yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt command" }));

    await waitFor(() => expect(interrupt).toHaveBeenCalledWith("repo-auth", undefined));

    const finish = resolveRun;
    if (finish === undefined) {
      throw new Error("command did not start");
    }
    finish(makeCommandResult("status"));
  });

  it("renders lifecycle events while a fix is still running", async () => {
    let streamListener: ((event: CommandStreamEvent) => void) | null = null;
    const onStream = vi.fn<Api["commands"]["onStream"]>((listener) => {
      streamListener = listener;
      return () => {
        streamListener = null;
      };
    });
    const run = vi.fn<Api["commands"]["run"]>(
      () =>
        new Promise<CommandResult>(() => {
          // Keep the command pending so lifecycle output is the only visible progress.
        }),
    );
    const finding = makeFixFinding();
    window.clawpatch = makeApi(run, { findings: [finding], findingDetail: finding, onStream });

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Run fix" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    await screen.findByText("Command starting...");
    if (streamListener === null) {
      throw new Error("stream listener was not registered");
    }

    act(() => {
      streamListener?.({
        kind: "lifecycle",
        runId: "run-fix",
        findingId: "fnd-bug",
        command: "fix",
        phase: "git:start",
        message: "$ git worktree add -b clawpatch/fix/fnd-bug /tmp/worktree HEAD",
        cwd: "/tmp/auth",
        argv: ["git", "worktree", "add", "-b", "clawpatch/fix/fnd-bug", "/tmp/worktree", "HEAD"],
      });
    });

    expect(screen.queryByText("Command starting...")).not.toBeInTheDocument();
    expect(screen.getByText(/\[fnd-bug fix\] \[git:start\]/)).toHaveTextContent(
      "$ git worktree add -b clawpatch/fix/fnd-bug /tmp/worktree HEAD",
    );
  });

  it("renders lifecycle, stderr, and exit code for a failed fix", async () => {
    let streamListener: ((event: CommandStreamEvent) => void) | null = null;
    const onStream = vi.fn<Api["commands"]["onStream"]>((listener) => {
      streamListener = listener;
      return () => {
        streamListener = null;
      };
    });
    let resolveRun: ((result: CommandResult) => void) | undefined;
    const run = vi.fn<Api["commands"]["run"]>(
      () =>
        new Promise<CommandResult>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const finding = makeFixFinding();
    window.clawpatch = makeApi(run, { findings: [finding], findingDetail: finding, onStream });

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Run fix" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    if (streamListener === null) {
      throw new Error("stream listener was not registered");
    }

    act(() => {
      streamListener?.({
        kind: "lifecycle",
        runId: "run-fix",
        findingId: "fnd-bug",
        command: "fix",
        phase: "clawpatch:start",
        message: "$ clawpatch --json --no-color --no-input fix --finding fnd-bug",
        cwd: "/tmp/worktree",
        argv: ["clawpatch", "--json", "--no-color", "--no-input", "fix", "--finding", "fnd-bug"],
      });
      streamListener?.({
        kind: "output",
        runId: "run-fix",
        findingId: "fnd-bug",
        command: "fix",
        stream: "stderr",
        chunk: "error: validation failed after applying fix\n",
      });
    });

    const finish = resolveRun;
    if (finish === undefined) {
      throw new Error("command did not start");
    }
    await act(async () => {
      finish({
        ...makeCommandResult("fix"),
        exitCode: 6,
        durationMs: 142501,
        stderr: "error: validation failed after applying fix\n",
      });
    });

    await screen.findByText(/\[fnd-bug fix\] \[clawpatch:start\]/);
    expect(screen.getByText(/\[fnd-bug fix\] \[stderr\]/)).toHaveTextContent(
      "error: validation failed after applying fix",
    );
    await screen.findByText(/\[fnd-bug fix\] \[exit 6\] clawpatch fix \(142501ms\)/);
  });

  it("opens the diff inspector and refreshes diff data when patch files are clicked repeatedly", async () => {
    const finding = {
      ...makeFixFinding(),
      patchAttempts: [
        {
          patchAttemptId: "pat-1",
          findingIds: ["fnd-bug"],
          featureIds: ["feat-profile"],
          status: "applied",
          plan: "Guard nullable branch access.",
          filesChanged: ["src/profile.ts", "test/profile.test.ts"],
          commandsRun: [],
          testResults: [],
          git: {
            baseSha: "abcdef1234567890",
            commitSha: null,
            branchName: "main",
            prUrl: null,
          },
          createdAt: "2026-05-19T12:00:00.000Z",
          updatedAt: "2026-05-19T12:01:00.000Z",
        },
      ],
    } satisfies FindingDetail;
    const gitDiff = vi.fn<Api["git"]["diff"]>(async () =>
      [
        "diff --git a/src/profile.ts b/src/profile.ts",
        "--- a/src/profile.ts",
        "+++ b/src/profile.ts",
        "diff --git a/test/profile.test.ts b/test/profile.test.ts",
        "--- a/test/profile.test.ts",
        "+++ b/test/profile.test.ts",
      ].join("\n"),
    );
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      { findings: [finding], findingDetail: finding, gitDiff },
    );

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    await waitFor(() => expect(gitDiff).toHaveBeenCalledWith("repo-auth", "fnd-bug"));
    const initialDiffCalls = gitDiff.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "src/profile.ts" }));
    expect(screen.getByRole("complementary", { name: "Git diff" })).toBeInTheDocument();
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(initialDiffCalls + 1));

    fireEvent.click(screen.getByRole("button", { name: "test/profile.test.ts" }));
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(initialDiffCalls + 2));
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

  it("passes current guidance when running fix", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) => {
      return request.command === "fix"
        ? makeCommandResult("fix", [makeCommandResult("revalidate")])
        : makeCommandResult(request.command);
    });
    const triageSet = vi.fn<Api["triage"]["set"]>(async () => {
      return makeCommandResult("triage");
    });
    const finding = makeFixFinding();
    window.clawpatch = makeApi(run, { findings: [finding], findingDetail: finding, triageSet });

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Run fix" })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Note for triage and fix"), {
      target: { value: "Prefer the existing parser helper." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith("repo-auth", {
        command: "fix",
        findingId: "fnd-bug",
        status: "open",
        note: "Prefer the existing parser helper.",
      }),
    );
    expect(triageSet).not.toHaveBeenCalled();
    await screen.findByText(/\[exit 0\] clawpatch fix/);
    await screen.findByText(/\[exit 0\] clawpatch revalidate/);
  });

  it("shows command output for the selected finding context", async () => {
    let streamListener: ((event: CommandStreamEvent) => void) | null = null;
    const highRiskFinding = makeFinding();
    const lowerRiskFinding = makeFixFinding();
    const findingsById = new Map([
      [highRiskFinding.findingId, highRiskFinding],
      [lowerRiskFinding.findingId, lowerRiskFinding],
    ]);
    const run = vi.fn<Api["commands"]["run"]>(
      () =>
        new Promise<CommandResult>(() => {
          // Keep both fixes pending so streamed output is the visible command history.
        }),
    );
    const onStream = vi.fn<Api["commands"]["onStream"]>((listener) => {
      streamListener = listener;
      return () => {
        streamListener = null;
      };
    });
    window.clawpatch = makeApi(run, {
      findings: [highRiskFinding, lowerRiskFinding],
      findingGet: async (_repoId, findingId) => {
        const finding = findingsById.get(findingId);
        if (finding === undefined) {
          throw new Error(`Missing finding ${findingId}`);
        }
        return finding;
      },
      onStream,
    });

    renderApp();

    await screen.findByRole("heading", { name: "Token is logged in debug output" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Run fix" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    await screen.findByText("Command starting...");
    if (streamListener === null) {
      throw new Error("stream listener was not registered");
    }

    act(() => {
      streamListener?.({
        kind: "output",
        runId: "run-security",
        repoId: "repo-auth",
        findingId: "fnd-security",
        command: "fix",
        stream: "stdout",
        chunk: "security fix output",
      });
    });
    expect(await screen.findByText(/security fix output/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Null branch can throw"));
    await screen.findByRole("heading", { name: "Null branch can throw" });
    expect(screen.queryByText(/security fix output/)).not.toBeInTheDocument();
    expect(screen.queryByText("Command starting...")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    act(() => {
      streamListener?.({
        kind: "output",
        runId: "run-bug",
        repoId: "repo-auth",
        findingId: "fnd-bug",
        command: "fix",
        stream: "stdout",
        chunk: "bug fix output",
      });
    });
    expect(await screen.findByText(/bug fix output/)).toBeInTheDocument();
    expect(screen.queryByText(/security fix output/)).not.toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    fireEvent.click(within(rows[1]).getByText("Token is logged in debug output"));
    await screen.findByRole("heading", { name: "Token is logged in debug output" });
    expect(await screen.findByText(/security fix output/)).toBeInTheDocument();
    expect(screen.queryByText(/bug fix output/)).not.toBeInTheDocument();
  });

  it("shows repo-level command output but hides finding output in the review queue", async () => {
    let streamListener: ((event: CommandStreamEvent) => void) | null = null;
    const onStream = vi.fn<Api["commands"]["onStream"]>((listener) => {
      streamListener = listener;
      return () => {
        streamListener = null;
      };
    });
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async (_repoId, request) => makeCommandResult(request.command)),
      { findings: [makeFinding()], findingDetail: makeFinding(), onStream },
    );

    renderApp();

    await screen.findByRole("heading", { name: "Token is logged in debug output" });
    fireEvent.click(screen.getByRole("button", { name: "Toggle command output" }));
    if (streamListener === null) {
      throw new Error("stream listener was not registered");
    }

    act(() => {
      streamListener?.({
        kind: "output",
        runId: "run-security",
        repoId: "repo-auth",
        findingId: "fnd-security",
        command: "fix",
        stream: "stdout",
        chunk: "finding output",
      });
      streamListener?.({
        kind: "output",
        runId: "run-review",
        repoId: "repo-auth",
        command: "review",
        stream: "stderr",
        chunk: "review queue output",
      });
    });

    expect(await screen.findByText(/finding output/)).toBeInTheDocument();
    expect(screen.getByText(/review queue output/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Review Queue" }));

    expect(screen.queryByText(/finding output/)).not.toBeInTheDocument();
    expect(screen.getByText(/review queue output/)).toBeInTheDocument();
  });

  it("disables fix when the registered checkout is dirty", async () => {
    const run = vi.fn<Api["commands"]["run"]>(async (_repoId, request) =>
      makeCommandResult(request.command),
    );
    const finding = makeFixFinding();
    const gitStatus = vi.fn<Api["git"]["status"]>(async (_repoId, findingId) =>
      findingId === undefined
        ? { staged: 0, modified: 1, untracked: 0, branch: "main" }
        : { staged: 0, modified: 0, untracked: 0, branch: "fix/fnd-bug" },
    );
    window.clawpatch = makeApi(run, { findings: [finding], findingDetail: finding, gitStatus });

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    await screen.findByText(
      "Commit, stash, or discard registered checkout changes before running fix.",
    );
    const fixButton = screen.getByRole("button", { name: "Run fix" });
    expect(fixButton).toBeDisabled();
    expect(fixButton).toHaveAttribute(
      "title",
      "Commit, stash, or discard registered checkout changes before running fix.",
    );
    expect(screen.getByRole("button", { name: "Revalidate" })).not.toBeDisabled();

    fireEvent.click(fixButton);

    expect(run).not.toHaveBeenCalled();
  });

  it("shows active worktree status for findings with managed worktrees", async () => {
    const finding = makeFixFinding();
    const worktreePath = "/tmp/clawpatch-ui/worktrees/repo-auth/fnd-bug";
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        findings: [finding],
        findingDetail: finding,
        findingWorkStatuses: async () => [
          {
            findingId: "fnd-bug",
            worktreePath,
            gitStatus: {
              staged: 0,
              modified: 0,
              untracked: 0,
              branch: "clawpatch/fix/fnd-bug",
            },
            prUrl: null,
            error: null,
          },
        ],
        repoList: async () => [
          makeRepo({
            activeWorktreePath: worktreePath,
            activeWorktrees: [{ findingId: "fnd-bug", path: worktreePath }],
          }),
        ],
      },
    );

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    expect(await screen.findByLabelText("Work status: Worktree")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Finding work status" })).toHaveTextContent(
      worktreePath,
    );
    expect(screen.getByRole("region", { name: "Finding work status" })).toHaveTextContent(
      "Working tree clean",
    );
  });

  it("shows dirty worktree counts in the selected finding detail", async () => {
    const finding = makeFixFinding();
    const worktreePath = "/tmp/clawpatch-ui/worktrees/repo-auth/fnd-bug";
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        findings: [finding],
        findingDetail: finding,
        findingWorkStatuses: async () => [
          {
            findingId: "fnd-bug",
            worktreePath,
            gitStatus: {
              staged: 1,
              modified: 2,
              untracked: 1,
              branch: "clawpatch/fix/fnd-bug",
            },
            prUrl: null,
            error: null,
          },
        ],
        repoList: async () => [
          makeRepo({
            activeWorktreePath: worktreePath,
            activeWorktrees: [{ findingId: "fnd-bug", path: worktreePath }],
          }),
        ],
      },
    );

    renderApp();

    const workRegion = await screen.findByRole("region", { name: "Finding work status" });
    expect(screen.getByLabelText("Work status: Dirty")).toBeInTheDocument();
    expect(workRegion).toHaveTextContent("1 staged · 2 modified · 1 untracked");
  });

  it("shows PR work status and link from finding work metadata", async () => {
    const finding = makeFixFinding();
    const worktreePath = "/tmp/clawpatch-ui/worktrees/repo-auth/fnd-bug";
    const prUrl = "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-bug?expand=1";
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        findings: [finding],
        findingDetail: finding,
        findingWorkStatuses: async () => [
          {
            findingId: "fnd-bug",
            worktreePath,
            gitStatus: {
              staged: 0,
              modified: 0,
              untracked: 0,
              branch: "clawpatch/fix/fnd-bug",
            },
            prUrl,
            error: null,
          },
        ],
        repoList: async () => [
          makeRepo({
            activeWorktreePath: worktreePath,
            activeWorktrees: [{ findingId: "fnd-bug", path: worktreePath }],
          }),
        ],
      },
    );

    renderApp();

    await screen.findByLabelText("Work status: PR");
    expect(screen.getByRole("link", { name: "Open PR" })).toHaveAttribute("href", prUrl);
  });

  it("shows Publish PR for findings with managed worktrees and opens the PR result", async () => {
    const finding = makeFixFinding();
    const worktreePath = "/tmp/clawpatch-ui/worktrees/repo-auth/fnd-bug";
    const publishFix = vi.fn<Api["git"]["publishFix"]>(async () => ({
      worktreePath,
      branchName: "clawpatch/fix/fnd-bug",
      baseBranch: "main",
      commitSha: "abc123",
      remoteName: "origin",
      prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-bug?expand=1",
    }));
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        findings: [finding],
        findingDetail: finding,
        publishFix,
        repoList: async () => [
          makeRepo({
            activeWorktreePath: worktreePath,
            activeWorktrees: [{ findingId: "fnd-bug", path: worktreePath }],
          }),
        ],
      },
    );

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    fireEvent.click(screen.getByRole("button", { name: "Publish PR" }));

    await screen.findByText(/PR draft opened for/);
    expect(publishFix).toHaveBeenCalledWith("repo-auth", "fnd-bug");
    expect(await screen.findByLabelText("Work status: PR")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link", { name: "Open PR" })
        .some(
          (link) =>
            link.getAttribute("href") ===
            "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-bug?expand=1",
        ),
    ).toBe(true);
  });

  it("disables Publish PR while a finding command is running", async () => {
    let resolveRun: ((result: CommandResult) => void) | undefined;
    const finding = makeFixFinding();
    const worktreePath = "/tmp/clawpatch-ui/worktrees/repo-auth/fnd-bug";
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(
        async (_repoId, request) =>
          new Promise<CommandResult>((resolve) => {
            resolveRun = () => resolve(makeCommandResult(request.command));
          }),
      ),
      {
        findings: [finding],
        findingDetail: finding,
        repoList: async () => [
          makeRepo({
            activeWorktreePath: worktreePath,
            activeWorktrees: [{ findingId: "fnd-bug", path: worktreePath }],
          }),
        ],
      },
    );

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    await screen.findByText("fix running");
    expect(screen.getByRole("button", { name: "Publish PR" })).toBeDisabled();

    resolveRun?.(makeCommandResult("fix"));
  });

  it("renders Publish PR errors", async () => {
    const finding = makeFixFinding();
    const worktreePath = "/tmp/clawpatch-ui/worktrees/repo-auth/fnd-bug";
    window.clawpatch = makeApi(
      vi.fn<Api["commands"]["run"]>(async () => makeCommandResult("map")),
      {
        findings: [finding],
        findingDetail: finding,
        publishFix: async () => {
          throw new Error("Remote origin is required before publishing a PR.");
        },
        repoList: async () => [
          makeRepo({
            activeWorktreePath: worktreePath,
            activeWorktrees: [{ findingId: "fnd-bug", path: worktreePath }],
          }),
        ],
      },
    );

    renderApp();

    await screen.findByRole("heading", { name: "Null branch can throw" });
    fireEvent.click(screen.getByRole("button", { name: "Publish PR" }));

    expect(
      await screen.findByText("Remote origin is required before publishing a PR."),
    ).toBeInTheDocument();
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
    add?: Api["repo"]["add"];
    findings?: readonly FindingListItem[];
    findingGet?: Api["findings"]["get"];
    findingsList?: Api["findings"]["list"];
    findingWorkStatuses?: Api["findings"]["workStatuses"];
    featureMap?: Api["features"]["map"];
    findingDetail?: FindingDetail;
    interrupt?: Api["commands"]["interrupt"];
    gitDiff?: Api["git"]["diff"];
    publishFix?: Api["git"]["publishFix"];
    gitStatus?: Api["git"]["status"];
    onStream?: Api["commands"]["onStream"];
    pickFolder?: Api["repo"]["pickFolder"];
    repoDoctor?: Api["repo"]["doctor"];
    repoGetSettings?: Api["repo"]["getSettings"];
    repoList?: Api["repo"]["list"];
    repoUpdateSettings?: Api["repo"]["updateSettings"];
    terminalOpen?: Api["terminal"]["open"];
    triageSet?: Api["triage"]["set"];
  } = {},
): Api {
  return {
    repo: {
      list: options.repoList ?? (async () => [makeRepo()]),
      add: options.add ?? (async () => makeRepo()),
      pickFolder: options.pickFolder ?? (async () => null),
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
      doctor: options.repoDoctor ?? (async () => makeCommandResult("doctor")),
      getSettings:
        options.repoGetSettings ??
        (async () => ({
          schemaVersion: 1,
          terminalAppName: "Terminal",
          terminalStartupScript: "",
          worktreeSetupScript: "",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })),
      updateSettings:
        options.repoUpdateSettings ??
        (async (_repoId, settings) => ({
          ...settings,
          schemaVersion: 1,
          updatedAt: "2026-05-20T00:00:00.000Z",
        })),
    },
    findings: {
      list: options.findingsList ?? (async () => options.findings ?? []),
      get:
        options.findingGet ??
        (async () => {
          if (options.findingDetail === undefined) {
            throw new Error("No finding expected");
          }
          return options.findingDetail;
        }),
      workStatuses: options.findingWorkStatuses ?? (async () => []),
    },
    features: {
      map: options.featureMap ?? (async () => makeFeatureMapSnapshot()),
    },
    triage: {
      set: options.triageSet ?? (async () => makeCommandResult("triage")),
    },
    commands: {
      run,
      interrupt: options.interrupt ?? (async () => ({ interrupted: false })),
      onStream: options.onStream ?? (() => () => undefined),
    },
    git: {
      diff: options.gitDiff ?? (async () => ""),
      publishFix:
        options.publishFix ??
        (async () => ({
          worktreePath: "/tmp/worktree",
          branchName: "clawpatch/fix/fnd-bug",
          baseBranch: "main",
          commitSha: "abc123",
          remoteName: "origin",
          prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-bug?expand=1",
        })),
      status:
        options.gitStatus ?? (async () => ({ staged: 0, modified: 0, untracked: 0, branch: null })),
    },
    terminal: {
      open: options.terminalOpen ?? (async (_repoId, _findingId) => ({ cwd: "/tmp/auth" })),
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

function repoPathOrder(): string[] {
  return screen
    .getAllByRole("button")
    .map((element) => element.getAttribute("title"))
    .filter((title): title is string => title?.startsWith("/") ?? false);
}

function makeRepo(overrides: Partial<RepoSummary> = {}): RepoSummary {
  const name = overrides.name ?? "auth";
  return {
    id: "repo-auth",
    name,
    path: `/tmp/${name}`,
    activeWorktreePath: null,
    activeWorktrees: [],
    hasClawpatch: true,
    isValid: true,
    lastError: null,
    findingCount: 0,
    openFindingCount: 0,
    updatedAt: "2026-05-19T00:00:00.000Z",
    ...overrides,
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

function makeCommandResult(
  command: string,
  relatedResults?: CommandResult["relatedResults"],
): CommandResult {
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
    ...(relatedResults === undefined ? {} : { relatedResults }),
  };
}
