import { Table2Icon } from "lucide-react";
import type { FeatureMapSnapshot } from "../../../shared/types";

interface Props {
  snapshot: FeatureMapSnapshot | null;
  isLoading: boolean;
  isBusy: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onReviewAllPending: (limit: number) => void;
}

export function ReviewCoveragePanel({
  snapshot,
  isLoading,
  isBusy,
  isExpanded,
  onToggleExpanded,
  onReviewAllPending,
}: Props) {
  const coverage = snapshot?.coverage ?? null;
  const pendingCount = coverage?.pendingReviewCount ?? 0;
  const summary = coverageSummary(snapshot, isLoading);

  return (
    <section className="panel review-coverage-panel">
      <div className="review-coverage-strip">
        <div className="review-coverage-copy">
          <h2>Review coverage</h2>
          <p>{summary}</p>
        </div>
        <div className="review-coverage-actions">
          {pendingCount > 0 ? (
            <button disabled={isBusy} onClick={() => onReviewAllPending(pendingCount)}>
              Review {pendingCount} remaining
            </button>
          ) : null}
          <button
            className={
              isExpanded ? "icon-button drawer-toggle active" : "icon-button drawer-toggle"
            }
            disabled={snapshot === null}
            onClick={onToggleExpanded}
            aria-pressed={isExpanded}
            aria-label={isExpanded ? "Hide map table" : "Show map table"}
            title={isExpanded ? "Hide map table" : "Show map table"}
          >
            <Table2Icon aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function coverageSummary(snapshot: FeatureMapSnapshot | null, isLoading: boolean): string {
  if (isLoading) {
    return "Loading map coverage.";
  }
  if (snapshot === null) {
    return "No map coverage loaded.";
  }

  const { coverage } = snapshot;
  if (coverage.totalFeatures === 0) {
    return "No map items found. Run map to create Clawpatch review units.";
  }

  if (coverage.hasLimitedReviewRemainder && coverage.latestLimitedReviewRun !== null) {
    return `Last limited review used --limit ${coverage.latestLimitedReviewRun.limit}; ${coverage.pendingReviewCount} map items remain pending/error.`;
  }

  if (coverage.latestReviewRun !== null) {
    return `${coverage.pendingReviewCount} of ${coverage.totalFeatures} map items remain pending/error. Latest review: ${coverage.latestReviewRun.status}.`;
  }

  return `${coverage.pendingReviewCount} of ${coverage.totalFeatures} map items remain pending/error.`;
}
