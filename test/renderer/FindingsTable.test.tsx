import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FindingListItem, FindingWorkStatus } from "../../src/shared/types";
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
      confidence: "high",
      status: "open",
    }),
    makeFinding({
      findingId: "fnd-bug",
      title: "Null branch can throw",
      category: "bug",
      severity: "medium",
      confidence: "medium",
      status: "fixed",
    }),
    makeFinding({
      findingId: "fnd-escape",
      title: "Escaping already happens upstream",
      category: "security",
      severity: "high",
      confidence: "low",
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
    const severityGroup = screen
      .getAllByText("Severity")
      .find((element) => element.closest(".filter-group"))
      ?.closest(".filter-group");
    expect(severityGroup).not.toBeNull();
    fireEvent.click(within(severityGroup as HTMLElement).getByRole("button", { name: "High" }));

    expect(getFilterMenu()).toHaveProperty("open", true);
    expect(screen.getByText("1 of 3 shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Severity: High filter" })).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.queryByText("Null branch can throw")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search findings"), { target: { value: "token" } });
    expect(screen.getByRole("button", { name: "Clear Search: token filter" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("1 actionable of 3 total")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear Severity: High filter" }),
    ).not.toBeInTheDocument();
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
    expect(
      screen.getByRole("button", { name: "Clear Category: Security filter" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Token is logged in debug output")).toBeInTheDocument();
    expect(screen.queryByText("Null branch can throw")).not.toBeInTheDocument();
    expect(screen.queryByText("Escaping already happens upstream")).not.toBeInTheDocument();
  });

  it("renders and filters by confidence through the menu", () => {
    render(<FilterHarness findings={findings} />);

    expect(screen.getByRole("columnheader", { name: /Confidence/ })).toBeInTheDocument();
    expect(screen.getAllByText("high").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Filter"));
    const confidenceGroup = screen
      .getAllByText("Confidence")
      .find((element) => element.closest(".filter-group"))
      ?.closest(".filter-group");
    expect(confidenceGroup).not.toBeNull();
    fireEvent.click(within(confidenceGroup as HTMLElement).getByRole("button", { name: "High" }));

    expect(screen.getByText("1 of 3 shown")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear Confidence: High filter" }),
    ).toBeInTheDocument();
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

  it("disables revalidate shown when no visible finding can be revalidated", () => {
    render(
      <FilterHarness
        findings={[makeFinding({ findingId: "fnd-fixed", title: "Resolved", status: "fixed" })]}
        initialFilters={{ ...defaultFindingFilters, status: null }}
      />,
    );

    const revalidateButton = screen.getByRole("button", { name: "Revalidate shown" });
    expect(revalidateButton).toBeDisabled();
    expect(revalidateButton).not.toHaveAttribute("title");
    fireEvent.mouseEnter(revalidateButton.parentElement as HTMLElement);
    expect(screen.getByText("Revalidate shown")).toHaveClass("icon-tooltip");
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
        bulkRevalidationProgress={null}
        onFiltersChange={vi.fn()}
        onSortChange={vi.fn()}
        onSelectFinding={onSelectFinding}
        onRevalidateShown={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Null branch can throw"));
    expect(onSelectFinding).toHaveBeenCalledWith("fnd-bug");
  });

  it("renders compact work badges only for findings with active work", () => {
    const workStatusByFindingId = new Map<string, FindingWorkStatus>([
      [
        "fnd-security",
        {
          findingId: "fnd-security",
          worktreePath: "/tmp/worktree",
          gitStatus: { staged: 0, modified: 1, untracked: 0, branch: "clawpatch/fix/fnd-security" },
          prUrl: null,
          error: null,
        },
      ],
      [
        "fnd-bug",
        {
          findingId: "fnd-bug",
          worktreePath: "/tmp/worktree-bug",
          gitStatus: { staged: 0, modified: 0, untracked: 0, branch: "clawpatch/fix/fnd-bug" },
          prUrl: "https://github.com/acme/repo/compare/main...clawpatch/fix/fnd-bug?expand=1",
          error: null,
        },
      ],
    ]);

    render(
      <FindingsTable
        findings={findings}
        totalFindingCount={findings.length}
        selectedFindingId={null}
        isLoading={false}
        filters={{ ...defaultFindingFilters, status: null }}
        filterOptions={getFindingFilterOptions(findings, clawpatchStatuses)}
        sort={defaultFindingSort}
        bulkRevalidationProgress={null}
        workStatusByFindingId={workStatusByFindingId}
        onFiltersChange={vi.fn()}
        onSortChange={vi.fn()}
        onSelectFinding={vi.fn()}
        onRevalidateShown={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Work status: Dirty")).toBeInTheDocument();
    expect(screen.getByLabelText("Work status: PR")).toBeInTheDocument();
    expect(screen.queryByLabelText("Work status: Worktree")).not.toBeInTheDocument();
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

  it("keeps sort icons visible and hidden from accessible button names", () => {
    render(
      <FilterHarness
        findings={findings}
        initialFilters={{ ...defaultFindingFilters, status: null }}
      />,
    );

    const severitySortButton = screen.getByRole("button", {
      name: "Sort by Severity ascending",
    });
    const severityIconSlot = severitySortButton.querySelector(".sort-header-icon");
    const confidenceSortButton = screen.getByRole("button", {
      name: "Sort by Confidence ascending",
    });
    const confidenceIconSlot = confidenceSortButton.querySelector(".sort-header-icon");

    expect(severityIconSlot).toHaveAttribute("aria-hidden", "true");
    expect(severityIconSlot?.querySelector("svg")).not.toBeNull();
    expect(confidenceIconSlot).toHaveAttribute("aria-hidden", "true");
    expect(confidenceIconSlot?.querySelector("svg")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sort by Confidence ascending" }));
    const activeConfidenceSortButton = screen.getByRole("button", {
      name: "Sort by Confidence descending",
    });
    expect(activeConfidenceSortButton).toBeInTheDocument();
    expect(activeConfidenceSortButton.querySelector(".sort-header-icon svg")).not.toBeNull();
  });

  it("sorts visible rows by confidence", () => {
    const { container } = render(
      <FilterHarness
        findings={findings}
        initialFilters={{ ...defaultFindingFilters, status: null }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sort by Confidence ascending" }));
    expect(visibleTitles(container)).toEqual([
      "Escaping already happens upstream",
      "Null branch can throw",
      "Token is logged in debug output",
    ]);
    expect(screen.getByRole("columnheader", { name: /Confidence/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    fireEvent.click(screen.getByRole("button", { name: "Sort by Confidence descending" }));
    expect(visibleTitles(container)).toEqual([
      "Token is logged in debug output",
      "Null branch can throw",
      "Escaping already happens upstream",
    ]);
  });
});

describe("FindingsTable virtualization", () => {
  it("switches to a windowed scroll area once the list exceeds the threshold", () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      makeFinding({
        findingId: `fnd-${index}`,
        title: `Finding number ${index}`,
        status: "open",
      }),
    );
    const { container } = render(
      <FilterHarness findings={many} initialFilters={{ ...defaultFindingFilters, status: null }} />,
    );

    // The container opts into the virtualized layout, and the sizing spacer
    // reserves space for every item (count * estimated row height) so the
    // scrollbar is correct even though only a window of rows is mounted.
    expect(container.querySelector(".findings-table.is-virtualized")).not.toBeNull();
    const spacer = container.querySelector(".virtual-rows") as HTMLElement | null;
    expect(spacer).not.toBeNull();
    expect(spacer?.style.height).toBe(`${many.length * 34}px`);
  });

  it("renders a window of rows on initial mount without any interaction", async () => {
    // Regression: the virtualizer measures its viewport in a layout effect and
    // can't flushSync a re-render from there, so the first window only appeared
    // after an unrelated state change (e.g. opening the filter). Give the viewport
    // a real size and assert rows show up on their own.
    const many = Array.from({ length: 80 }, (_, index) =>
      makeFinding({ findingId: `fnd-${index}`, title: `Finding number ${index}`, status: "open" }),
    );
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });

    try {
      const { container } = render(
        <FilterHarness
          findings={many}
          initialFilters={{ ...defaultFindingFilters, status: null }}
        />,
      );

      await waitFor(() => {
        const count = container.querySelectorAll("button.table-row").length;
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(many.length);
      });
    } finally {
      if (heightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", heightDescriptor);
      }
      if (widthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", widthDescriptor);
      }
    }
  });

  it("renders every row directly when below the threshold", () => {
    const few = Array.from({ length: 5 }, (_, index) =>
      makeFinding({ findingId: `fnd-${index}`, title: `Finding number ${index}`, status: "open" }),
    );
    const { container } = render(
      <FilterHarness findings={few} initialFilters={{ ...defaultFindingFilters, status: null }} />,
    );

    expect(container.querySelector(".findings-table.is-virtualized")).toBeNull();
    expect(container.querySelector(".virtual-rows")).toBeNull();
    expect(container.querySelectorAll("button.table-row")).toHaveLength(few.length);
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
      bulkRevalidationProgress={null}
      onFiltersChange={setFilters}
      onSortChange={setSort}
      onSelectFinding={() => undefined}
      onRevalidateShown={() => undefined}
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
