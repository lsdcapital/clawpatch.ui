import type { ClawpatchCommandRequest, FeatureMapSnapshot } from "../../shared/types";

export interface ReviewTaskState {
  readonly label: string;
  readonly queuedCount: number;
}

export function reviewTaskState({
  queuedReviewFeatureIds,
  runningRepoCommand,
  runningReviewFeatureId,
  snapshot,
}: {
  readonly queuedReviewFeatureIds: readonly string[];
  readonly runningRepoCommand: { readonly request: ClawpatchCommandRequest } | null;
  readonly runningReviewFeatureId: string | null;
  readonly snapshot: FeatureMapSnapshot | null;
}): ReviewTaskState | null {
  if (runningRepoCommand?.request.command === "review") {
    if (runningReviewFeatureId !== null) {
      return {
        label: `Reviewing ${featureTitle(snapshot, runningReviewFeatureId)}`,
        queuedCount: queuedReviewFeatureIds.length,
      };
    }
    return {
      label: "Reviewing pending features",
      queuedCount: queuedReviewFeatureIds.length,
    };
  }

  if (queuedReviewFeatureIds.length > 0) {
    return {
      label: "Review queued",
      queuedCount: queuedReviewFeatureIds.length,
    };
  }

  return null;
}

function featureTitle(snapshot: FeatureMapSnapshot | null, featureId: string): string {
  return snapshot?.features.find((feature) => feature.featureId === featureId)?.title ?? featureId;
}
