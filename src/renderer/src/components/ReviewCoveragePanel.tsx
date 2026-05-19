import type { FeatureMapSnapshot } from "../../../shared/types";

interface Props {
  snapshot: FeatureMapSnapshot | null;
  isLoading: boolean;
  isBusy: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onRunMap: () => void;
  onReviewNext: () => void;
  onReviewAllPending: (limit: number) => void;
  onReviewFeature: (featureId: string) => void;
}

export function ReviewCoveragePanel({
  snapshot,
  isLoading,
  isBusy,
  isExpanded,
  onToggleExpanded,
  onRunMap,
  onReviewNext,
  onReviewAllPending,
  onReviewFeature
}: Props) {
  const coverage = snapshot?.coverage ?? null;
  const pendingCount = coverage?.pendingReviewCount ?? 0;
  const totalFeatures = coverage?.totalFeatures ?? 0;
  const summary = coverageSummary(snapshot, isLoading);

  return (
    <section className="panel review-coverage-panel">
      <div className="review-coverage-strip">
        <div className="review-coverage-copy">
          <h2>Review coverage</h2>
          <p>{summary}</p>
        </div>
        <div className="review-coverage-actions">
          <button disabled={isBusy} onClick={onRunMap}>
            Map
          </button>
          <button disabled={isBusy || totalFeatures === 0} onClick={onReviewNext}>
            Review next
          </button>
          <button
            disabled={isBusy || pendingCount === 0}
            onClick={() => onReviewAllPending(pendingCount)}
          >
            Review all pending
          </button>
          <button
            className={isExpanded ? "drawer-toggle active" : "drawer-toggle"}
            disabled={snapshot === null}
            onClick={onToggleExpanded}
            aria-pressed={isExpanded}
          >
            Map table
          </button>
        </div>
      </div>

      {isExpanded && snapshot !== null ? (
        <div className="feature-map-table" role="table">
          <div className="feature-map-row feature-map-head" role="row">
            <span>Status</span>
            <span>Kind</span>
            <span>Source</span>
            <span>Files</span>
            <span>Findings</span>
            <span>Title</span>
            <span>Action</span>
          </div>
          {snapshot.features.length === 0 ? (
            <div className="feature-map-empty">No map items found.</div>
          ) : (
            snapshot.features.map((feature) => (
              <div className="feature-map-row" role="row" key={feature.featureId}>
                <span className={`feature-status ${feature.status}`}>{feature.status}</span>
                <span>{feature.kind}</span>
                <span>{feature.source}</span>
                <span>{feature.ownedFileCount + feature.contextFileCount + feature.testCount}</span>
                <span>{feature.findingCount}</span>
                <strong title={feature.featureId}>{feature.title}</strong>
                <button
                  disabled={isBusy}
                  onClick={() => onReviewFeature(feature.featureId)}
                  title={feature.featureId}
                >
                  Review
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
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
