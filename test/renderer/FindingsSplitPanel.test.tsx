import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FindingDetail, FindingListItem } from "../../src/shared/types";
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

describe("FindingsSplitPanel", () => {
  it("renders findings and selected finding detail in one resizable panel", () => {
    renderSplitPanel();

    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Selected detail title" })).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize findings and detail panes" }),
    ).toBeInTheDocument();
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
    expect(separator).toHaveAttribute("aria-valuenow", "28");

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "62");
  });
});

function renderSplitPanel() {
  return render(
    <FindingsSplitPanel
      findings={findings}
      totalFindingCount={findings.length}
      selectedFindingId="fnd-security"
      isFindingsLoading={false}
      filters={defaultFindingFilters}
      filterOptions={getFindingFilterOptions(findings, clawpatchStatuses)}
      finding={makeFindingDetail()}
      isDetailLoading={false}
      isBusy={false}
      onFiltersChange={vi.fn()}
      onSelectFinding={vi.fn()}
      onTriage={vi.fn()}
      onFix={vi.fn()}
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

function makeFindingDetail(): FindingDetail {
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
  };
}
