import type { FeatureMapItem } from "../../shared/types";

export type ReviewQueueStatusFilter = "actionable" | string | null;

export interface ReviewQueueFilters {
  search: string;
  status: ReviewQueueStatusFilter;
  kind: string | null;
  source: string | null;
}

export interface ReviewQueueFilterOptions {
  statuses: readonly string[];
  kinds: readonly string[];
  sources: readonly string[];
}

export const defaultReviewQueueFilters: ReviewQueueFilters = {
  search: "",
  status: "actionable",
  kind: null,
  source: null,
};

export function filterReviewQueue(
  features: readonly FeatureMapItem[],
  filters: ReviewQueueFilters,
): FeatureMapItem[] {
  const query = normalize(filters.search);
  const queryTokens = query.split(" ").filter((token) => token !== "");
  const kind = normalize(filters.kind ?? "");
  const source = normalize(filters.source ?? "");

  return features.filter((feature) => {
    if (filters.status === "actionable" && !isActionableReviewStatus(feature.status)) {
      return false;
    }
    if (
      filters.status !== null &&
      filters.status !== "actionable" &&
      feature.status !== filters.status
    ) {
      return false;
    }
    if (kind !== "" && normalize(feature.kind) !== kind) {
      return false;
    }
    if (source !== "" && normalize(feature.source) !== source) {
      return false;
    }
    if (query === "") {
      return true;
    }
    const searchText = reviewQueueSearchText(feature);
    return queryTokens.every((token) => searchText.includes(token));
  });
}

export function getReviewQueueFilterOptions(
  features: readonly FeatureMapItem[],
): ReviewQueueFilterOptions {
  return {
    statuses: uniqueSorted(features.map((feature) => feature.status)),
    kinds: uniqueSorted(features.map((feature) => feature.kind)),
    sources: uniqueSorted(features.map((feature) => feature.source)),
  };
}

export function isReviewQueueFiltersActive(filters: ReviewQueueFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== defaultReviewQueueFilters.status ||
    filters.kind !== null ||
    filters.source !== null
  );
}

function isActionableReviewStatus(status: string): boolean {
  return status === "pending" || status === "error";
}

function reviewQueueSearchText(feature: FeatureMapItem): string {
  return normalize([feature.featureId, feature.title].join(" "));
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim() !== ""))).toSorted(
    (left, right) => left.localeCompare(right),
  );
}
