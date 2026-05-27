import {
  AlertCircleIcon,
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FilePenLineIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  FileCheck2Icon,
} from "lucide-react";
import { useState } from "react";
import type { ClawpatchStatus, FindingListItem, FindingWorkStatus } from "../../../shared/types";
import type { BulkRevalidationProgress } from "../hooks/useCommandRunner";
import { useDismissiblePopover } from "../hooks/useDismissiblePopover";
import {
  defaultFindingFilters,
  isFindingFiltersActive,
  type FindingSort,
  type FindingSortDirection,
  type FindingSortField,
  type FindingFilterOptions,
  type FindingFilters,
  type FindingStatusFilter,
} from "../findingsFilters";
import { findingWorkLabel, findingWorkState, findingWorkTitle } from "../findingWorkStatus";
import { ActionIconButton } from "./ActionIconButton";

interface Props {
  findings: readonly FindingListItem[];
  totalFindingCount: number;
  selectedFindingId: string | null;
  isLoading: boolean;
  filters: FindingFilters;
  filterOptions: FindingFilterOptions;
  sort: FindingSort;
  bulkRevalidationProgress: BulkRevalidationProgress | null;
  workStatusByFindingId?: ReadonlyMap<string, FindingWorkStatus>;
  onFiltersChange: (filters: FindingFilters) => void;
  onSortChange: (sort: FindingSort) => void;
  onSelectFinding: (findingId: string) => void;
  onRevalidateShown: () => void;
}

export function FindingsTable({
  findings,
  totalFindingCount,
  selectedFindingId,
  isLoading,
  filters,
  filterOptions,
  sort,
  bulkRevalidationProgress,
  workStatusByFindingId,
  onFiltersChange,
  onSortChange,
  onSelectFinding,
  onRevalidateShown,
}: Props) {
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filterMenuRef = useDismissiblePopover<HTMLDetailsElement>({
    isOpen: isFilterMenuOpen,
    onDismiss: () => setIsFilterMenuOpen(false),
  });
  const filtersActive = isFindingFiltersActive(filters);
  const countLabel = isLoading
    ? "Loading"
    : filtersActive
      ? `${findings.length} of ${totalFindingCount} shown`
      : `${findings.length} actionable of ${totalFindingCount} total`;
  const revalidatableFindingCount = findings.filter(isRevalidatableFinding).length;
  const isBulkRevalidating = bulkRevalidationProgress !== null;

  const updateFilters = (nextFilters: Partial<FindingFilters>): void => {
    onFiltersChange({ ...filters, ...nextFilters });
  };
  const updateSort = (field: FindingSortField): void => {
    onSortChange({
      field,
      direction: sort.field === field ? toggleDirection(sort.direction) : "asc",
    });
  };

  return (
    <div className="findings-list-pane">
      <div className="panel-header">
        <h2>Findings</h2>
        <span>
          {bulkRevalidationProgress === null
            ? countLabel
            : `Revalidating ${bulkRevalidationProgress.current}/${bulkRevalidationProgress.total}`}
        </span>
      </div>
      <div className="findings-toolbar">
        <div className="findings-filter-row findings-filter-row-with-action">
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
              <StatusFilterGroup
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
                title="Confidence"
                values={filterOptions.confidences}
                selectedValue={filters.confidence}
                onSelect={(confidence) => updateFilters({ confidence })}
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
          <div className="action-toolbar findings-toolbar-actions" aria-label="Findings actions">
            <ActionIconButton
              disabled={isBulkRevalidating || revalidatableFindingCount === 0}
              icon={<FileCheck2Icon aria-hidden="true" />}
              label="Revalidate shown"
              onClick={onRevalidateShown}
            />
          </div>
        </div>
        {filtersActive ? (
          <div className="filter-chips" aria-label="Active filters">
            {filters.search.trim() !== "" ? (
              <FilterChip
                label={`Search: ${filters.search.trim()}`}
                onClear={() => updateFilters({ search: "" })}
              />
            ) : null}
            {filters.status !== defaultFindingFilters.status ? (
              <FilterChip
                label={statusLabelFor(filters.status)}
                onClear={() => updateFilters({ status: defaultFindingFilters.status })}
              />
            ) : null}
            {filters.severity !== null ? (
              <FilterChip
                label={`Severity: ${labelFor(filters.severity)}`}
                onClear={() => updateFilters({ severity: null })}
              />
            ) : null}
            {filters.confidence !== null ? (
              <FilterChip
                label={`Confidence: ${labelFor(filters.confidence)}`}
                onClear={() => updateFilters({ confidence: null })}
              />
            ) : null}
            {filters.category !== null ? (
              <FilterChip
                label={`Category: ${labelFor(filters.category)}`}
                onClear={() => updateFilters({ category: null })}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="findings-table" role="table">
        <div className="table-row table-head" role="row">
          <SortableHeader field="severity" label="Severity" sort={sort} onSort={updateSort} />
          <SortableHeader field="confidence" label="Confidence" sort={sort} onSort={updateSort} />
          <SortableHeader field="status" label="Status" sort={sort} onSort={updateSort} />
          <span role="columnheader">Work</span>
          <SortableHeader field="category" label="Category" sort={sort} onSort={updateSort} />
          <SortableHeader field="title" label="Title" sort={sort} onSort={updateSort} />
        </div>
        {findings.map((finding) => {
          const workStatus = workStatusByFindingId?.get(finding.findingId) ?? null;
          return (
            <button
              key={finding.findingId}
              className={
                finding.findingId === selectedFindingId ? "table-row selected" : "table-row"
              }
              onClick={() => onSelectFinding(finding.findingId)}
              role="row"
            >
              <span className={`severity ${finding.severity}`}>{finding.severity}</span>
              <span>{finding.confidence}</span>
              <span>{finding.status}</span>
              <FindingWorkBadge status={workStatus} />
              <span>{finding.category}</span>
              <strong>{finding.title}</strong>
            </button>
          );
        })}
        {!isLoading && findings.length === 0 ? (
          <div className="empty-state">
            <span>{emptyStateLabel(filtersActive, totalFindingCount)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isRevalidatableFinding(finding: FindingListItem): boolean {
  return finding.status === "open" || finding.status === "uncertain";
}

function FindingWorkBadge({ status }: { status: FindingWorkStatus | null }) {
  if (status === null) {
    return <span aria-hidden="true" />;
  }

  const state = findingWorkState(status);
  const Icon =
    state === "dirty"
      ? FilePenLineIcon
      : state === "pr"
        ? GitPullRequestIcon
        : state === "unknown"
          ? AlertCircleIcon
          : GitBranchIcon;

  return (
    <span
      aria-label={`Work status: ${findingWorkLabel(status)}`}
      className={`work-badge work-badge-${state}`}
      title={findingWorkTitle(status)}
    >
      <Icon aria-hidden="true" />
      <span>{findingWorkLabel(status)}</span>
    </span>
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
  const SortIcon = isActive
    ? sort.direction === "asc"
      ? ChevronUpIcon
      : ChevronDownIcon
    : ArrowUpDownIcon;

  return (
    <span aria-sort={ariaSort} role="columnheader">
      <button
        className={isActive ? "sort-header active" : "sort-header"}
        onClick={() => onSort(field)}
        type="button"
        aria-label={`Sort by ${label} ${nextDirection === "asc" ? "ascending" : "descending"}`}
      >
        <span>{label}</span>
        <span className="sort-header-icon" aria-hidden="true">
          <SortIcon />
        </span>
      </button>
    </span>
  );
}

function StatusFilterGroup({
  values,
  selectedValue,
  onSelect,
}: {
  values: readonly ClawpatchStatus[];
  selectedValue: FindingStatusFilter;
  onSelect: (value: FindingStatusFilter) => void;
}) {
  return (
    <div className="filter-group">
      <span>Status</span>
      <button
        className={selectedValue === "actionable" ? "active" : ""}
        onClick={() => onSelect("actionable")}
      >
        Actionable
      </button>
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

function emptyStateLabel(filtersActive: boolean, totalFindingCount: number): string {
  if (filtersActive) {
    return "No findings match these filters";
  }
  return totalFindingCount > 0 ? "No actionable findings" : "No findings found";
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button className="filter-chip" onClick={onClear} aria-label={`Clear ${label} filter`}>
      <span>{label}</span>
      <span aria-hidden="true">x</span>
    </button>
  );
}

function statusLabelFor(value: FindingStatusFilter): string {
  if (value === "actionable") {
    return "Actionable";
  }
  if (value === null) {
    return "All statuses";
  }
  return labelFor(value);
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
