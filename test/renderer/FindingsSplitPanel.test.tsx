import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClawpatchStatus,
  CommandResult,
  FindingDetail,
  FindingListItem,
  PatchOpenPrResult,
} from "../../src/shared/types";
import { clawpatchStatuses } from "../../src/shared/constants";
import { FindingsSplitPanel } from "../../src/renderer/src/components/FindingsSplitPanel";
import {
  defaultFindingFilters,
  defaultFindingSort,
  getFindingFilterOptions,
} from "../../src/renderer/src/findingsFilters";

const findings = [
  makeFindingListItem({
    findingId: "fnd-security",
    title: "Token is logged in debug output",
    category: "security",
    severity: "high",
  }),
  makeFindingListItem({
    findingId: "fnd-bug",
    title: "Null branch can throw",
    category: "bug",
    severity: "medium",
  }),
];

const splitWidthStorageKey = "clawpatch.findingsSplitWidth.v1";

describe("FindingsSplitPanel", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("renders findings and selected finding detail in one resizable panel", () => {
    renderSplitPanel();

    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Selected detail title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat with AI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revalidate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finding status: open" })).toBeInTheDocument();
    expect(screen.getByText("Needs product call")).toBeInTheDocument();
    expect(screen.getByText("Accepted risk")).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize findings and detail panes" }),
    ).toBeInTheDocument();
  });

  it("calls the revalidate handler from the selected finding detail", () => {
    const onRevalidate = vi.fn();
    renderSplitPanel({ onRevalidate });

    fireEvent.click(screen.getByRole("button", { name: "Revalidate" }));

    expect(onRevalidate).toHaveBeenCalledOnce();
  });

  it("runs selected finding actions from the detail toolbar", () => {
    const onChatWithAi = vi.fn();
    const onFix = vi.fn();
    const onOpenPr = vi.fn();
    const onInterrupt = vi.fn();

    const { unmount } = renderSplitPanel({
      canOpenPr: true,
      isBusy: true,
      onChatWithAi,
      onFix,
      onInterrupt,
      onOpenPr,
    });

    expect(screen.getByText("fix running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat with AI" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run fix" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revalidate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open PR" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Interrupt finding command" }));
    expect(onInterrupt).toHaveBeenCalledOnce();

    unmount();
    renderSplitPanel({ canOpenPr: true, onChatWithAi, onFix, onOpenPr });

    fireEvent.click(screen.getByRole("button", { name: "Chat with AI" }));
    expect(onChatWithAi).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Run fix" }));
    expect(onFix).toHaveBeenCalledWith("open", "");

    fireEvent.click(screen.getByRole("button", { name: "Open PR" }));
    expect(onOpenPr).toHaveBeenCalledOnce();
  });

  it("disables AI chat while opening and shows launch errors", () => {
    renderSplitPanel({
      aiChatError: new Error("Unable to open AI chat."),
      isOpeningAiChat: true,
    });

    expect(screen.getByRole("button", { name: "Chat with AI" })).toBeDisabled();
    expect(screen.getByText("Unable to open AI chat.")).toBeInTheDocument();
  });

  it("shows disabled reasons and open PR results near the detail actions", () => {
    renderSplitPanel({
      fixDisabledReason: "Working tree has unrelated changes.",
      openPrDisabledReason: "Run fix to create a Clawpatch patch before opening a PR",
      openPrError: new Error("Unable to open PR."),
      openPrResult: {
        patchAttemptId: "pat-1",
        prUrl: "https://github.com/acme/repo/pull/1",
        worktreePath: "/tmp/worktree",
        commandResult: makeCommandResult(),
      },
    });

    expect(screen.getByText("Working tree has unrelated changes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run fix" })).toHaveAccessibleDescription(
      "Working tree has unrelated changes.",
    );
    expect(
      screen.getByText("Run fix to create a Clawpatch patch before opening a PR"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unable to open PR.")).toBeInTheDocument();
    expect(screen.getByText(/Open PR completed for pat-1/)).toBeInTheDocument();
  });

  it("keeps status in the metadata card and auto-saves it with the current note", () => {
    const onTriage = vi.fn();
    renderSplitPanel({ onTriage });

    const detailHeader = screen
      .getByRole("heading", { name: "Selected detail title" })
      .closest(".detail-header");
    const statusButton = screen.getByRole("button", { name: "Finding status: open" });
    const metaGrid = statusButton.closest(".meta-grid");

    expect(detailHeader).not.toBeNull();
    expect(metaGrid).not.toBeNull();
    expect(
      within(detailHeader as HTMLElement).queryByRole("button", { name: /Finding status/ }),
    ).not.toBeInTheDocument();

    const noteField = screen.getByLabelText("Note for triage and fix");
    fireEvent.change(noteField, {
      target: { value: "needs product call" },
    });
    fireEvent.click(statusButton);
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Finding status options" })).getByRole(
        "menuitemradio",
        { name: "wont-fix" },
      ),
    );

    expect(screen.queryByRole("menu", { name: "Finding status options" })).not.toBeInTheDocument();
    expect(
      within(metaGrid as HTMLElement).getByRole("button", {
        name: "Finding status: open",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save triage note" })).toBeInTheDocument();
    expect(onTriage).toHaveBeenCalledWith("wont-fix", "needs product call");
  });

  it("renders status-only history entries", () => {
    renderSplitPanel({
      finding: makeFindingDetail({
        history: [
          {
            runId: "run-1",
            kind: "triage",
            status: "wont-fix",
            note: null,
            reasoning: null,
            commands: [],
            createdAt: "2026-01-04T00:00:00.000Z",
          },
        ],
      }),
    });

    const historySection = screen.getByRole("heading", { name: "History" }).closest("section");
    expect(historySection).not.toBeNull();
    expect(within(historySection as HTMLElement).getByText("wont-fix")).toBeInTheDocument();
  });

  it("saves the current note when pressing Enter in the note field", () => {
    const onTriage = vi.fn();
    renderSplitPanel({ onTriage });

    const noteField = screen.getByLabelText("Note for triage and fix");
    fireEvent.change(noteField, {
      target: { value: "needs product call" },
    });
    fireEvent.keyDown(noteField, { key: "Enter" });

    expect(onTriage).toHaveBeenCalledWith("open", "needs product call");
  });

  it("keeps Shift+Enter available for note newlines", () => {
    const onTriage = vi.fn();
    renderSplitPanel({ onTriage });

    const noteField = screen.getByLabelText("Note for triage and fix");
    fireEvent.change(noteField, {
      target: { value: "line one" },
    });
    fireEvent.keyDown(noteField, { key: "Enter", shiftKey: true });

    expect(onTriage).not.toHaveBeenCalled();
  });

  it("renders fix attempts with file buttons that invoke onOpenDiffFile", () => {
    const onOpenDiffFile = vi.fn();
    renderSplitPanel({
      onOpenDiffFile,
      finding: makeFindingDetail({
        patchAttempts: [
          {
            patchAttemptId: "pat-1",
            findingIds: ["fnd-security"],
            featureIds: ["feat-1"],
            status: "applied",
            plan: "Strip the debug log",
            filesChanged: ["src/auth.ts", "test/auth.test.ts"],
            commandsRun: [],
            testResults: [
              {
                command: "pnpm test",
                cwd: null,
                exitCode: 0,
                durationMs: 800,
                stdout: "ok",
                stderr: "",
              },
            ],
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
      }),
    });

    expect(screen.getByRole("heading", { name: "Fix attempts" })).toBeInTheDocument();
    expect(screen.getByText("Strip the debug log")).toBeInTheDocument();
    expect(screen.getByText("applied")).toBeInTheDocument();
    expect(screen.getByText("tests passed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "src/auth.ts" }));
    expect(onOpenDiffFile).toHaveBeenCalledWith("src/auth.ts");
  });

  it("supports keyboard resizing within configured limits", () => {
    renderSplitPanel();

    const separator = screen.getByRole("separator", {
      name: "Resize findings and detail panes",
    });

    expect(separator).toHaveAttribute("aria-valuenow", "42");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "44");

    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "14");

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "62");
    expect(window.localStorage.getItem(splitWidthStorageKey)).toBe("62");
  });

  it("loads a saved split width from local storage", () => {
    window.localStorage.setItem(splitWidthStorageKey, "18");

    renderSplitPanel();

    expect(
      screen.getByRole("separator", { name: "Resize findings and detail panes" }),
    ).toHaveAttribute("aria-valuenow", "18");
  });

  it.each([
    ["invalid", "42"],
    ["1", "14"],
    ["80", "62"],
  ])("falls back or clamps saved split width %s", (storedWidth, expectedWidth) => {
    window.localStorage.setItem(splitWidthStorageKey, storedWidth);

    renderSplitPanel();

    expect(
      screen.getByRole("separator", { name: "Resize findings and detail panes" }),
    ).toHaveAttribute("aria-valuenow", expectedWidth);
  });
});

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

function renderSplitPanel({
  finding = makeFindingDetail(),
  canOpenPr = false,
  openPrDisabledReason = null,
  commandStateLabel = "fix",
  fixDisabledReason = null,
  isBusy = false,
  isOpeningAiChat = false,
  onChatWithAi = vi.fn(),
  onFix = vi.fn(),
  onInterrupt,
  onOpenPr = vi.fn(),
  onTriage = vi.fn(),
  onRevalidate = vi.fn(),
  onOpenDiffFile,
  openPrError = null,
  openPrResult = null,
  aiChatError = null,
  triageError = null,
}: {
  finding?: FindingDetail;
  canOpenPr?: boolean;
  openPrDisabledReason?: string | null;
  commandStateLabel?: string;
  fixDisabledReason?: string | null;
  isBusy?: boolean;
  isOpeningAiChat?: boolean;
  onChatWithAi?: () => void;
  onFix?: (status: ClawpatchStatus, note: string) => void;
  onInterrupt?: () => void;
  onOpenPr?: () => void;
  onTriage?: (status: ClawpatchStatus, note: string) => void;
  onRevalidate?: () => void;
  onOpenDiffFile?: (filePath: string) => void;
  openPrError?: Error | null;
  openPrResult?: PatchOpenPrResult | null;
  aiChatError?: Error | null;
  triageError?: string | null;
} = {}) {
  return render(
    <FindingsSplitPanel
      findings={findings}
      totalFindingCount={findings.length}
      selectedFindingId="fnd-security"
      isFindingsLoading={false}
      filters={defaultFindingFilters}
      filterOptions={getFindingFilterOptions(findings, clawpatchStatuses)}
      sort={defaultFindingSort}
      bulkRevalidationProgress={null}
      workStatusByFindingId={new Map()}
      finding={finding}
      isDetailLoading={false}
      isBusy={isBusy}
      commandStateLabel={commandStateLabel}
      fixDisabledReason={fixDisabledReason}
      canOpenPr={canOpenPr}
      isOpeningAiChat={isOpeningAiChat}
      openPrDisabledReason={openPrDisabledReason}
      openPrResult={openPrResult}
      openPrError={openPrError}
      aiChatError={aiChatError}
      triageError={triageError}
      onFiltersChange={vi.fn()}
      onSortChange={vi.fn()}
      onSelectFinding={vi.fn()}
      onRevalidateShown={vi.fn()}
      onChatWithAi={onChatWithAi}
      onTriage={onTriage}
      onFix={onFix}
      onRevalidate={onRevalidate}
      onOpenPr={onOpenPr}
      onInterrupt={onInterrupt}
      onOpenDiffFile={onOpenDiffFile}
    />,
  );
}

function makeFindingListItem(overrides: Partial<FindingListItem>): FindingListItem {
  return {
    findingId: "fnd-1",
    featureId: "feat-1",
    title: "Finding",
    category: "bug",
    severity: "medium",
    confidence: "medium",
    triage: null,
    status: "open",
    evidence: [],
    linkedPatchAttemptIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCommandResult(): CommandResult {
  return {
    runId: "run-open-pr",
    command: "clawpatch",
    args: ["open-pr", "--patch", "pat-1"],
    cwd: "/tmp/worktree",
    exitCode: 0,
    durationMs: 1,
    stdout: "{}",
    stderr: "",
    parsedJson: {},
  };
}

function makeFindingDetail(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    ...makeFindingListItem({
      findingId: "fnd-security",
      title: "Selected detail title",
      category: "security",
      severity: "high",
    }),
    evidence: [
      {
        path: "src/auth.ts",
        startLine: 12,
        endLine: 14,
        symbol: null,
        quote: "console.log(token)",
      },
    ],
    reasoning: "The token is written to logs.",
    recommendation: "Remove the log statement.",
    reproduction: null,
    whyTestsDoNotAlreadyCoverThis: null,
    suggestedRegressionTest: null,
    minimumFixScope: null,
    feature: null,
    patchAttempts: [],
    ...overrides,
    history: [
      {
        runId: null,
        kind: "triage",
        status: "uncertain",
        note: "Needs product call",
        reasoning: null,
        commands: [],
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        runId: "run-2",
        kind: "triage",
        status: "wont-fix",
        note: "Accepted risk",
        reasoning: null,
        commands: [],
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}
