import type { ClawpatchCommandRequest, CommandResult } from "./types";

// Summary of a completed `review` run, derived from the CLI's JSON output. Lives
// in shared so both the renderer (today) and the main-process review queue
// (planned) can build it from the same parsing logic.
export type ReviewCompletionSummary =
  | {
      readonly kind: "feature";
      readonly repoId: string;
      readonly featureId: string;
      readonly findingCount: number | null;
      readonly reviewedFeatureCount: number | null;
    }
  | {
      readonly kind: "batch";
      readonly repoId: string;
      readonly findingCount: number | null;
      readonly reviewedFeatureCount: number | null;
    };

// Observable state of the main-process review queue, shared so the renderer can
// reflect it and the `Api` can type the IPC surface.
export interface QueuedFeature {
  readonly repoId: string;
  readonly featureId: string;
}

export interface ReviewQueueState {
  readonly runningRepoId: string | null;
  readonly runningFeatureId: string | null;
  readonly queued: readonly QueuedFeature[];
  readonly lastCompletion: ReviewCompletionSummary | null;
}

export function reviewCompletionSummary(
  repoId: string,
  request: ClawpatchCommandRequest,
  result: CommandResult,
): ReviewCompletionSummary {
  const findingCount = countFromParsedJson(result.parsedJson, "findingCount", "findingIds");
  const reviewedFeatureCount = countFromParsedJson(
    result.parsedJson,
    "reviewedFeatureCount",
    "claimedFeatureIds",
  );

  if (request.command === "review" && request.featureId !== undefined) {
    return {
      kind: "feature",
      repoId,
      featureId: request.featureId,
      findingCount,
      reviewedFeatureCount,
    };
  }

  return {
    kind: "batch",
    repoId,
    findingCount,
    reviewedFeatureCount,
  };
}

// Reads a non-negative integer count at `countKey`, falling back to the length
// of the array at `idsKey`, or null when neither is present.
function countFromParsedJson(value: unknown, countKey: string, idsKey: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const count = record[countKey];
  if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
    return Math.floor(count);
  }
  const ids = record[idsKey];
  return Array.isArray(ids) ? ids.length : null;
}
