import { fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FindingListItem } from "../../src/shared/types";
import { clawpatchStatuses } from "../../src/shared/constants";
import { FindingsTable } from "../../src/renderer/src/components/FindingsTable";
import {
  defaultFindingFilters,
  filterFindings,
  getFindingFilterOptions,
  type FindingFilters,
} from "../../src/renderer/src/findingsFilters";

describe("FindingsTable filters", () => {
  const findings = [
    makeFinding({
      findingId: "fnd-security",
      title: "Token is logged in debug output",
      category: "security",
      severity: "high",
      status: "open",
    }),
    makeFinding({
      findingId: "fnd-bug",
      title: "Null branch can throw",
      category: "bug",
      severity: "medium",
      status: "fixed",
    }),
  ];

  it("renders filter controls, active chips, and clear behavior", () => {
    render(<FilterHarness findings={findings} />);

    expect(screen.getByText("2 total")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Filter"));
    fireEvent.click(screen.getByRole("button", { name: "High" }));

    expect(getFilterMenu()).toHaveProperty("open", true);
    expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear High filter" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.queryByText("Null branch can throw")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search findings"), { target: { value: "token" } });
    expect(screen.getByRole("button", { name: "Clear Search: token filter" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("2 total")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear High filter" })).not.toBeInTheDocument();
  });

  it("can filter by security category through the menu", () => {
    render(<FilterHarness findings={findings} />);

    fireEvent.click(screen.getByText("Filter"));
    const categoryGroup = screen
      .getAllByText("Category")
      .find((element) => element.closest(".filter-group"))
      ?.closest(".filter-group");
    expect(categoryGroup).not.toBeNull();
    fireEvent.click(within(categoryGroup as HTMLElement).getByRole("button", { name: "Security" }));

    expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Security filter" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.queryByText("Null branch can throw")).not.toBeInTheDocument();
  });

  it("closes the filter menu when clicking outside it", () => {
    render(<FilterHarness findings={findings} />);

    fireEvent.click(screen.getByText("Filter"));
    expect(getFilterMenu()).toHaveProperty("open", true);

    fireEvent.mouseDown(screen.getByLabelText("Search findings"));
    expect(getFilterMenu()).toHaveProperty("open", false);
  });

  it("shows empty states for no findings and no filter matches", () => {
    const { unmount } = render(<FilterHarness findings={[]} />);
    expect(screen.getByText("No findings found")).toBeInTheDocument();

    unmount();
    render(
      <FilterHarness
        findings={findings}
        initialFilters={{ ...defaultFindingFilters, search: "missing" }}
      />,
    );
    expect(screen.getByText("0 of 2 shown")).toBeInTheDocument();
    expect(screen.getByText("No findings match these filters")).toBeInTheDocument();
  });

  it("selects visible rows", () => {
    const onSelectFinding = vi.fn();
    render(
      <FindingsTable
        findings={findings}
        totalFindingCount={findings.length}
        selectedFindingId={null}
        isLoading={false}
        filters={defaultFindingFilters}
        filterOptions={getFindingFilterOptions(findings, clawpatchStatuses)}
        onFiltersChange={vi.fn()}
        onSelectFinding={onSelectFinding}
      />,
    );

    fireEvent.click(screen.getByText("Null branch can throw"));
    expect(onSelectFinding).toHaveBeenCalledWith("fnd-bug");
  });
});

function FilterHarness({
  findings,
  initialFilters = defaultFindingFilters,
}: {
  findings: readonly FindingListItem[];
  initialFilters?: FindingFilters;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const filteredFindings = useMemo(() => filterFindings(findings, filters), [findings, filters]);

  return (
    <FindingsTable
      findings={filteredFindings}
      totalFindingCount={findings.length}
      selectedFindingId={filteredFindings[0]?.findingId ?? null}
      isLoading={false}
      filters={filters}
      filterOptions={getFindingFilterOptions(findings, clawpatchStatuses)}
      onFiltersChange={setFilters}
      onSelectFinding={() => undefined}
    />
  );
}

function getFilterMenu(): HTMLDetailsElement {
  const filterMenu = screen.getByText("Filter").closest("details");
  expect(filterMenu).not.toBeNull();
  return filterMenu as HTMLDetailsElement;
}

function makeFinding(overrides: Partial<FindingListItem>): FindingListItem {
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
