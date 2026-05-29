import type { ClawpatchStatus, FindingListItem } from "../../shared/types";

export type FindingStatusFilter = "actionable" | ClawpatchStatus | null;

export interface FindingFilters {
  search: string;
  status: FindingStatusFilter;
  severity: string | null;
  confidence: string | null;
  category: string | null;
}

export interface FindingFilterOptions {
  statuses: readonly ClawpatchStatus[];
  severities: readonly string[];
  confidences: readonly string[];
  categories: readonly string[];
}

export type FindingSortField = "severity" | "confidence" | "status" | "category" | "title";
export type FindingSortDirection = "asc" | "desc";

export interface FindingSort {
  field: FindingSortField;
  direction: FindingSortDirection;
}

export const defaultFindingFilters: FindingFilters = {
  search: "",
  status: "actionable",
  severity: null,
  confidence: null,
  category: null,
};

export const defaultFindingSort: FindingSort = {
  field: "severity",
  direction: "desc",
};

export function filterFindings(
  findings: readonly FindingListItem[],
  filters: FindingFilters,
): FindingListItem[] {
  const query = normalize(filters.search);
  const queryTokens = query.split(" ").filter((token) => token !== "");
  const severity = normalize(filters.severity ?? "");
  const confidence = normalize(filters.confidence ?? "");
  const category = normalize(filters.category ?? "");

  return findings.filter((finding) => {
    if (filters.status === "actionable" && !isActionableFindingStatus(finding.status)) {
      return false;
    }
    if (
      filters.status !== null &&
      filters.status !== "actionable" &&
      finding.status !== filters.status
    ) {
      return false;
    }
    if (severity !== "" && normalize(finding.severity) !== severity) {
      return false;
    }
    if (confidence !== "" && normalize(finding.confidence) !== confidence) {
      return false;
    }
    if (category !== "" && normalize(finding.category) !== category) {
      return false;
    }
    if (query === "") {
      return true;
    }
    const searchText = findingSearchText(finding);
    return queryTokens.every((token) => searchText.includes(token));
  });
}

export function sortFindings(
  findings: readonly FindingListItem[],
  sort: FindingSort = defaultFindingSort,
): FindingListItem[] {
  return findings.toSorted(
    (left, right) =>
      compareByActiveSort(left, right, sort) ||
      compareByDefaultRisk(left, right) ||
      compareText(left.title, right.title) ||
      compareText(left.findingId, right.findingId),
  );
}

export function getFindingFilterOptions(
  findings: readonly FindingListItem[],
  statuses: readonly ClawpatchStatus[],
): FindingFilterOptions {
  return {
    statuses,
    severities: uniqueSorted(findings.map((finding) => finding.severity)),
    confidences: uniqueSorted(findings.map((finding) => finding.confidence)),
    categories: uniqueSorted(findings.map((finding) => finding.category)),
  };
}

export function isFindingFiltersActive(filters: FindingFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== defaultFindingFilters.status ||
    filters.severity !== null ||
    filters.confidence !== null ||
    filters.category !== null
  );
}

export function resolveSelectedFindingId(
  selectedFindingId: string | null,
  findings: readonly FindingListItem[],
): string | null {
  if (findings.length === 0) {
    return null;
  }
  if (
    selectedFindingId !== null &&
    findings.some((finding) => finding.findingId === selectedFindingId)
  ) {
    return selectedFindingId;
  }
  return findings[0]?.findingId ?? null;
}

function findingSearchText(finding: FindingListItem): string {
  return normalize(
    [
      finding.findingId,
      finding.title,
      finding.category,
      finding.severity,
      finding.status,
      finding.confidence,
      ...finding.evidence.flatMap((evidence) => [evidence.path, evidence.symbol ?? ""]),
    ].join(" "),
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

export function isActionableFindingStatus(status: ClawpatchStatus): boolean {
  return status === "open" || status === "uncertain";
}

function compareByActiveSort(
  left: FindingListItem,
  right: FindingListItem,
  sort: FindingSort,
): number {
  const comparison = compareField(left, right, sort.field);
  return sort.direction === "asc" ? comparison : -comparison;
}

function compareField(
  left: FindingListItem,
  right: FindingListItem,
  field: FindingSortField,
): number {
  if (field === "severity") {
    return severitySortValue(left.severity) - severitySortValue(right.severity);
  }
  if (field === "confidence") {
    return confidenceSortValue(left.confidence) - confidenceSortValue(right.confidence);
  }
  if (field === "category") {
    return (
      categorySortValue(left.category) - categorySortValue(right.category) ||
      compareText(left.category, right.category)
    );
  }
  if (field === "status") {
    return statusSortValue(left.status) - statusSortValue(right.status);
  }
  return compareText(left.title, right.title);
}

function compareByDefaultRisk(left: FindingListItem, right: FindingListItem): number {
  return (
    severitySortValue(right.severity) - severitySortValue(left.severity) ||
    categorySortValue(left.category) - categorySortValue(right.category) ||
    compareText(left.category, right.category)
  );
}

function severitySortValue(severity: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[normalize(severity)] ?? 0;
}

function confidenceSortValue(confidence: string): number {
  return { high: 3, medium: 2, low: 1 }[normalize(confidence)] ?? 0;
}

function categorySortValue(category: string): number {
  return (
    {
      security: 0,
      "data-loss": 1,
      correctness: 2,
      bug: 3,
      reliability: 4,
      concurrency: 5,
      performance: 6,
      "test-gap": 7,
      maintainability: 8,
    }[normalize(category)] ?? 9
  );
}

function statusSortValue(status: ClawpatchStatus): number {
  return (
    {
      open: 0,
      uncertain: 1,
      fixed: 2,
      "false-positive": 3,
      "wont-fix": 4,
    }[status] ?? 5
  );
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim() !== ""))).toSorted(
    (left, right) => left.localeCompare(right),
  );
}
