import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawpatchStatus, FindingDetail, FindingListItem } from "../../src/shared/types";
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

  it("keeps status in the metadata card and saves it with the current note", () => {
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
        { name: "false-positive" },
      ),
    );
    expect(screen.queryByRole("button", { name: "Save triage" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save triage note" }));

    expect(screen.queryByRole("menu", { name: "Finding status options" })).not.toBeInTheDocument();
    expect(
      within(metaGrid as HTMLElement).getByRole("button", {
        name: "Finding status: false-positive",
      }),
    ).toBeInTheDocument();
    expect(onTriage).toHaveBeenCalledWith("false-positive", "needs product call");
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
  onTriage = vi.fn(),
  onRevalidate = vi.fn(),
  onOpenDiffFile,
}: {
  finding?: FindingDetail;
  onTriage?: (status: ClawpatchStatus, note: string) => void;
  onRevalidate?: () => void;
  onOpenDiffFile?: (filePath: string) => void;
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
      workStatusByFindingId={new Map()}
      finding={finding}
      isDetailLoading={false}
      isBusy={false}
      fixDisabledReason={null}
      canPublishFix={false}
      publishFixResult={null}
      publishFixError={null}
      onFiltersChange={vi.fn()}
      onSortChange={vi.fn()}
      onSelectFinding={vi.fn()}
      onTriage={onTriage}
      onFix={vi.fn()}
      onRevalidate={onRevalidate}
      onPublishFix={vi.fn()}
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
