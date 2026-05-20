import { fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FindingListItem } from "../../src/shared/types";
import { clawpatchStatuses } from "../../src/shared/constants";
import { FindingsTable } from "../../src/renderer/src/components/FindingsTable";
import {
  defaultFindingFilters,
  defaultFindingSort,
  filterFindings,
  getFindingFilterOptions,
  sortFindings,
  type FindingFilters,
  type FindingSort,
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
    makeFinding({
      findingId: "fnd-escape",
      title: "Escaping already happens upstream",
      category: "security",
      severity: "high",
      status: "false-positive",
    }),
  ];

  it("renders filter controls, active chips, and clear behavior", () => {
    render(<FilterHarness findings={findings} />);

    expect(screen.getByText("1 actionable of 3 total")).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.queryByText("Null branch can throw")).not.toBeInTheDocument();
    expect(screen.queryByText("Escaping already happens upstream")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Filter"));
    fireEvent.click(screen.getByRole("button", { name: "High" }));

    expect(getFilterMenu()).toHaveProperty("open", true);
    expect(screen.getByText("1 of 3 shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear High filter" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.queryByText("Null branch can throw")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search findings"), { target: { value: "token" } });
    expect(screen.getByRole("button", { name: "Clear Search: token filter" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("1 actionable of 3 total")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear High filter" })).not.toBeInTheDocument();
    expect(screen.queryByText("Escaping already happens upstream")).not.toBeInTheDocument();
  });

  it("allows viewing all statuses through the status filter", () => {
    render(<FilterHarness findings={findings} />);

    fireEvent.click(screen.getByText("Filter"));
    const statusGroup = screen
      .getAllByText("Status")
      .find((element) => element.closest(".filter-group"))
      ?.closest(".filter-group");
    expect(statusGroup).not.toBeNull();
    expect(
      within(statusGroup as HTMLElement).getByRole("button", { name: "Actionable" }),
    ).toBeInTheDocument();
    expect(
      within(statusGroup as HTMLElement).getByRole("button", { name: "All" }),
    ).toBeInTheDocument();

    fireEvent.click(within(statusGroup as HTMLElement).getByRole("button", { name: "All" }));

    expect(screen.getByText("3 of 3 shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear All statuses filter" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.getByText("Null branch can throw")).toBeInTheDocument();
    expect(screen.getByText("Escaping already happens upstream")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("1 actionable of 3 total")).toBeInTheDocument();
    expect(screen.queryByText("Escaping already happens upstream")).not.toBeInTheDocument();
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

    expect(screen.getByText("1 of 3 shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Security filter" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.queryByText("Null branch can throw")).not.toBeInTheDocument();
    expect(screen.queryByText("Escaping already happens upstream")).not.toBeInTheDocument();
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
        findings={[makeFinding({ findingId: "fnd-fixed", title: "Resolved", status: "fixed" })]}
      />,
    );
    expect(screen.getByText("0 actionable of 1 total")).toBeInTheDocument();
    expect(screen.getByText("No actionable findings")).toBeInTheDocument();

    unmount();
    render(
      <FilterHarness
        findings={findings}
        initialFilters={{ ...defaultFindingFilters, search: "missing" }}
      />,
    );
    expect(screen.getByText("0 of 3 shown")).toBeInTheDocument();
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
        sort={defaultFindingSort}
        onFiltersChange={vi.fn()}
        onSortChange={vi.fn()}
        onSelectFinding={onSelectFinding}
      />,
    );

    fireEvent.click(screen.getByText("Null branch can throw"));
    expect(onSelectFinding).toHaveBeenCalledWith("fnd-bug");
  });

  it("sorts visible rows when clicking column headings", () => {
    const { container } = render(
      <FilterHarness
        findings={findings}
        initialFilters={{ ...defaultFindingFilters, status: null }}
      />,
    );

    expect(visibleTitles(container)).toEqual([
      "Escaping already happens upstream",
      "Token is logged in debug output",
      "Null branch can throw",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Title ascending" }));
    expect(visibleTitles(container)).toEqual([
      "Escaping already happens upstream",
      "Null branch can throw",
      "Token is logged in debug output",
    ]);
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    fireEvent.click(screen.getByRole("button", { name: "Sort by Title descending" }));
    expect(visibleTitles(container)).toEqual([
      "Token is logged in debug output",
      "Null branch can throw",
      "Escaping already happens upstream",
    ]);
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
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
  const [sort, setSort] = useState<FindingSort>(defaultFindingSort);
  const filteredFindings = useMemo(() => filterFindings(findings, filters), [findings, filters]);
  const sortedFindings = useMemo(
    () => sortFindings(filteredFindings, sort),
    [filteredFindings, sort],
  );

  return (
    <FindingsTable
      findings={sortedFindings}
      totalFindingCount={findings.length}
      selectedFindingId={sortedFindings[0]?.findingId ?? null}
      isLoading={false}
      filters={filters}
      filterOptions={getFindingFilterOptions(findings, clawpatchStatuses)}
      sort={sort}
      onFiltersChange={setFilters}
      onSortChange={setSort}
      onSelectFinding={() => undefined}
    />
  );
}

function visibleTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button.table-row")).map((row) => {
    const title = row.querySelector("strong");
    expect(title).not.toBeNull();
    return title?.textContent ?? "";
  });
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
