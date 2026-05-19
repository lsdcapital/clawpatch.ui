import type { ClawpatchStatus, FindingListItem } from "../../shared/types";

export interface FindingFilters {
  search: string;
  status: ClawpatchStatus | null;
  severity: string | null;
  category: string | null;
}

export interface FindingFilterOptions {
  statuses: readonly ClawpatchStatus[];
  severities: readonly string[];
  categories: readonly string[];
}

export const defaultFindingFilters: FindingFilters = {
  search: "",
  status: null,
  severity: null,
  category: null
};

export function filterFindings(
  findings: readonly FindingListItem[],
  filters: FindingFilters
): FindingListItem[] {
  const query = normalize(filters.search);
  const queryTokens = query.split(" ").filter((token) => token !== "");
  const severity = normalize(filters.severity ?? "");
  const category = normalize(filters.category ?? "");

  return findings.filter((finding) => {
    if (filters.status !== null && finding.status !== filters.status) {
      return false;
    }
    if (severity !== "" && normalize(finding.severity) !== severity) {
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

export function getFindingFilterOptions(
  findings: readonly FindingListItem[],
  statuses: readonly ClawpatchStatus[]
): FindingFilterOptions {
  return {
    statuses,
    severities: uniqueSorted(findings.map((finding) => finding.severity)),
    categories: uniqueSorted(findings.map((finding) => finding.category))
  };
}

export function isFindingFiltersActive(filters: FindingFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== null ||
    filters.severity !== null ||
    filters.category !== null
  );
}

export function resolveSelectedFindingId(
  selectedFindingId: string | null,
  findings: readonly FindingListItem[]
): string | null {
  if (findings.length === 0) {
    return null;
  }
  if (selectedFindingId !== null && findings.some((finding) => finding.findingId === selectedFindingId)) {
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
      ...finding.evidence.flatMap((evidence) => [evidence.path, evidence.symbol ?? ""])
    ].join(" ")
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim() !== ""))).sort((left, right) =>
    left.localeCompare(right)
  );
}
