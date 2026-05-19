import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawpatchStatus, FindingDetail, FindingListItem } from "../../src/shared/types";
import { clawpatchStatuses } from "../../src/shared/constants";
import { FindingsSplitPanel } from "../../src/renderer/src/components/FindingsSplitPanel";
import {
  defaultFindingFilters,
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
    expect(screen.getByRole("combobox", { name: "Finding status" })).toHaveValue("open");
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

  it("keeps status in the detail header and saves it with the current note", () => {
    const onTriage = vi.fn();
    renderSplitPanel({
      finding: makeFindingDetail({ localNote: "needs product call" }),
      onTriage,
    });

    const detailHeader = screen
      .getByRole("heading", { name: "Selected detail title" })
      .closest(".detail-header");

    expect(detailHeader).not.toBeNull();

    const statusSelect = within(detailHeader as HTMLElement).getByRole("combobox", {
      name: "Finding status",
    });
    fireEvent.change(statusSelect, { target: { value: "false-positive" } });
    fireEvent.click(screen.getByRole("button", { name: "Save triage" }));

    expect(statusSelect).toHaveValue("false-positive");
    expect(onTriage).toHaveBeenCalledWith("false-positive", "needs product call");
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
}: {
  finding?: FindingDetail;
  onTriage?: (status: ClawpatchStatus, note: string) => void;
  onRevalidate?: () => void;
} = {}) {
  return render(
    <FindingsSplitPanel
      findings={findings}
      totalFindingCount={findings.length}
      selectedFindingId="fnd-security"
      isFindingsLoading={false}
      filters={defaultFindingFilters}
      filterOptions={getFindingFilterOptions(findings, clawpatchStatuses)}
      finding={finding}
      isDetailLoading={false}
      isBusy={false}
      onFiltersChange={vi.fn()}
      onSelectFinding={vi.fn()}
      onTriage={onTriage}
      onFix={vi.fn()}
      onRevalidate={onRevalidate}
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
    localNote: null,
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
    history: [],
    ...overrides,
  };
}
