import { useEffect, useRef, useState } from "react";
import type { ClawpatchStatus, FindingListItem } from "../../../shared/types";
import {
  defaultFindingFilters,
  isFindingFiltersActive,
  type FindingSort,
  type FindingSortDirection,
  type FindingSortField,
  type FindingFilterOptions,
  type FindingFilters,
} from "../findingsFilters";

interface Props {
  findings: readonly FindingListItem[];
  totalFindingCount: number;
  selectedFindingId: string | null;
  isLoading: boolean;
  filters: FindingFilters;
  filterOptions: FindingFilterOptions;
  sort: FindingSort;
  onFiltersChange: (filters: FindingFilters) => void;
  onSortChange: (sort: FindingSort) => void;
  onSelectFinding: (findingId: string) => void;
}

export function FindingsTable({
  findings,
  totalFindingCount,
  selectedFindingId,
  isLoading,
  filters,
  filterOptions,
  sort,
  onFiltersChange,
  onSortChange,
  onSelectFinding,
}: Props) {
  const filterMenuRef = useRef<HTMLDetailsElement>(null);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filtersActive = isFindingFiltersActive(filters);
  const countLabel = isLoading
    ? "Loading"
    : filtersActive
      ? `${findings.length} of ${totalFindingCount} shown`
      : `${totalFindingCount} total`;

  const updateFilters = (nextFilters: Partial<FindingFilters>): void => {
    onFiltersChange({ ...filters, ...nextFilters });
  };
  const updateSort = (field: FindingSortField): void => {
    onSortChange({
      field,
      direction: sort.field === field ? toggleDirection(sort.direction) : "asc",
    });
  };

  useEffect(() => {
    if (!isFilterMenuOpen) {
      return;
    }

    const closeFilterMenuOnOutsideClick = (event: MouseEvent): void => {
      const menuElement = filterMenuRef.current;

      if (menuElement === null || !(event.target instanceof Node)) {
        return;
      }

      if (!menuElement.contains(event.target)) {
        setIsFilterMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", closeFilterMenuOnOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeFilterMenuOnOutsideClick);
    };
  }, [isFilterMenuOpen]);

  return (
    <div className="findings-list-pane">
      <div className="panel-header">
        <h2>Findings</h2>
        <span>{countLabel}</span>
      </div>
      <div className="findings-toolbar">
        <div className="findings-filter-row">
          <input
            aria-label="Search findings"
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.currentTarget.value })}
            placeholder="Search findings..."
          />
          <details className="filter-menu" open={isFilterMenuOpen} ref={filterMenuRef}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                setIsFilterMenuOpen((isOpen) => !isOpen);
              }}
            >
              Filter
            </summary>
            <div className="filter-popover">
              <FilterGroup
                title="Status"
                values={filterOptions.statuses}
                selectedValue={filters.status}
                onSelect={(status) => updateFilters({ status })}
              />
              <FilterGroup
                title="Severity"
                values={filterOptions.severities}
                selectedValue={filters.severity}
                onSelect={(severity) => updateFilters({ severity })}
              />
              <FilterGroup
                title="Category"
                values={filterOptions.categories}
                selectedValue={filters.category}
                onSelect={(category) => updateFilters({ category })}
              />
            </div>
          </details>
          <button disabled={!filtersActive} onClick={() => onFiltersChange(defaultFindingFilters)}>
            Clear
          </button>
        </div>
        {filtersActive ? (
          <div className="filter-chips" aria-label="Active filters">
            {filters.search.trim() !== "" ? (
              <FilterChip
                label={`Search: ${filters.search.trim()}`}
                onClear={() => updateFilters({ search: "" })}
              />
            ) : null}
            {filters.status !== null ? (
              <FilterChip
                label={labelFor(filters.status)}
                onClear={() => updateFilters({ status: null })}
              />
            ) : null}
            {filters.severity !== null ? (
              <FilterChip
                label={labelFor(filters.severity)}
                onClear={() => updateFilters({ severity: null })}
              />
            ) : null}
            {filters.category !== null ? (
              <FilterChip
                label={labelFor(filters.category)}
                onClear={() => updateFilters({ category: null })}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="findings-table" role="table">
        <div className="table-row table-head" role="row">
          <SortableHeader field="severity" label="Severity" sort={sort} onSort={updateSort} />
          <SortableHeader field="status" label="Status" sort={sort} onSort={updateSort} />
          <SortableHeader field="category" label="Category" sort={sort} onSort={updateSort} />
          <SortableHeader field="title" label="Title" sort={sort} onSort={updateSort} />
        </div>
        {findings.map((finding) => (
          <button
            key={finding.findingId}
            className={finding.findingId === selectedFindingId ? "table-row selected" : "table-row"}
            onClick={() => onSelectFinding(finding.findingId)}
            role="row"
          >
            <span className={`severity ${finding.severity}`}>{finding.severity}</span>
            <span>{finding.status}</span>
            <span>{finding.category}</span>
            <strong>{finding.title}</strong>
          </button>
        ))}
        {!isLoading && findings.length === 0 ? (
          <div className="empty-state">
            {filtersActive ? "No findings match these filters" : "No findings found"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableHeader({
  field,
  label,
  sort,
  onSort,
}: {
  field: FindingSortField;
  label: string;
  sort: FindingSort;
  onSort: (field: FindingSortField) => void;
}) {
  const isActive = sort.field === field;
  const ariaSort = isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const nextDirection = isActive ? toggleDirection(sort.direction) : "asc";

  return (
    <span aria-sort={ariaSort} role="columnheader">
      <button
        className={isActive ? "sort-header active" : "sort-header"}
        onClick={() => onSort(field)}
        type="button"
        aria-label={`Sort by ${label} ${nextDirection === "asc" ? "ascending" : "descending"}`}
      >
        <span>{label}</span>
        <span aria-hidden="true">{isActive ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </span>
  );
}

function FilterGroup<TValue extends string>({
  title,
  values,
  selectedValue,
  onSelect,
}: {
  title: string;
  values: readonly TValue[];
  selectedValue: TValue | null;
  onSelect: (value: TValue | null) => void;
}) {
  return (
    <div className="filter-group">
      <span>{title}</span>
      <button className={selectedValue === null ? "active" : ""} onClick={() => onSelect(null)}>
        All
      </button>
      {values.map((value) => (
        <button
          key={value}
          className={selectedValue === value ? "active" : ""}
          onClick={() => onSelect(value)}
        >
          {labelFor(value)}
        </button>
      ))}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button className="filter-chip" onClick={onClear} aria-label={`Clear ${label} filter`}>
      <span>{label}</span>
      <span aria-hidden="true">x</span>
    </button>
  );
}

function labelFor(value: ClawpatchStatus | string): string {
  if (value === "wont-fix") {
    return "Won't Fix";
  }
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toggleDirection(direction: FindingSortDirection): FindingSortDirection {
  return direction === "asc" ? "desc" : "asc";
}
