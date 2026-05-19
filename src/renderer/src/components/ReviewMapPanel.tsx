import type { FeatureMapSnapshot } from "../../../shared/types";

interface Props {
  snapshot: FeatureMapSnapshot | null;
  isLoading: boolean;
  isBusy: boolean;
  onReviewFeature: (featureId: string) => void;
}

export function ReviewMapPanel({ snapshot, isLoading, isBusy, onReviewFeature }: Props) {
  return (
    <section className="panel review-map-panel">
      <div className="panel-header">
        <h2>Review Coverage</h2>
        <span>
          {isLoading ? "Loading" : `${snapshot?.coverage.pendingReviewCount ?? 0} pending`}
        </span>
      </div>
      {snapshot === null ? (
        <div className="empty-state">
          {isLoading ? "Loading map coverage." : "No map coverage loaded."}
        </div>
      ) : (
        <ReviewMapTable snapshot={snapshot} isBusy={isBusy} onReviewFeature={onReviewFeature} />
      )}
    </section>
  );
}

function ReviewMapTable({
  snapshot,
  isBusy,
  onReviewFeature,
}: {
  snapshot: FeatureMapSnapshot;
  isBusy: boolean;
  onReviewFeature: (featureId: string) => void;
}) {
  return (
    <div className="feature-map-table" role="table" aria-label="Review coverage map">
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
  );
}
