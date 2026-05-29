import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { ClawpatchCommandRequest, CommandStreamEvent } from "../../shared/types";
import {
  reviewCompletionSummary,
  type ReviewCompletionSummary,
} from "../../shared/reviewCompletion";
import { RepoService } from "./repoService";

export type ReviewCommandRequest = Extract<ClawpatchCommandRequest, { command: "review" }> & {
  readonly featureId: string;
};

export interface QueuedReview {
  readonly repoId: string;
  readonly featureId: string;
  readonly request: ReviewCommandRequest;
}

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

export const emptyReviewQueueState: ReviewQueueState = {
  runningRepoId: null,
  runningFeatureId: null,
  queued: [],
  lastCompletion: null,
};

export interface ReviewQueueServiceShape {
  readonly enqueue: (review: QueuedReview) => Effect.Effect<void>;
  readonly cancel: (repoId: string, featureId: string) => Effect.Effect<void>;
  readonly getState: () => Effect.Effect<ReviewQueueState>;
  readonly changes: Stream.Stream<ReviewQueueState>;
}

export class ReviewQueueService extends Context.Service<
  ReviewQueueService,
  ReviewQueueServiceShape
>()("clawpatch/ReviewQueue") {}

// State transitions kept pure so they can be unit-tested directly.
function isPending(state: ReviewQueueState, repoId: string, featureId: string): boolean {
  if (state.runningRepoId === repoId && state.runningFeatureId === featureId) {
    return true;
  }
  return state.queued.some((item) => item.repoId === repoId && item.featureId === featureId);
}

function addQueued(state: ReviewQueueState, review: QueuedReview): ReviewQueueState {
  return {
    ...state,
    queued: [...state.queued, { repoId: review.repoId, featureId: review.featureId }],
  };
}

function removeQueued(
  state: ReviewQueueState,
  repoId: string,
  featureId: string,
): ReviewQueueState {
  return {
    ...state,
    queued: state.queued.filter(
      (item) => !(item.repoId === repoId && item.featureId === featureId),
    ),
  };
}

function markRunning(state: ReviewQueueState, review: QueuedReview): ReviewQueueState {
  return {
    ...removeQueued(state, review.repoId, review.featureId),
    runningRepoId: review.repoId,
    runningFeatureId: review.featureId,
    lastCompletion: null,
  };
}

function markIdle(
  state: ReviewQueueState,
  completion: ReviewCompletionSummary | null,
): ReviewQueueState {
  return {
    ...state,
    runningRepoId: null,
    runningFeatureId: null,
    lastCompletion: completion ?? state.lastCompletion,
  };
}

// The single authoritative review queue. A forked consumer fiber drains it one
// command at a time through RepoService (whose per-repo lock remains the safety
// backstop), publishing run state on a SubscriptionRef the renderer reflects.
// `publishCommandStream` forwards CLI output exactly like a direct `commands:run`.
export const ReviewQueueServiceLive = (publishCommandStream: (event: CommandStreamEvent) => void) =>
  Layer.effect(
    ReviewQueueService,
    Effect.gen(function* () {
      const repos = yield* RepoService;
      const queue = yield* Queue.unbounded<QueuedReview>();
      const stateRef = yield* SubscriptionRef.make(emptyReviewQueueState);

      const runOne = (review: QueuedReview): Effect.Effect<void> =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(stateRef);
          // Skipped if cancel() removed it from the queue after it was offered.
          const stillQueued = current.queued.some(
            (item) => item.repoId === review.repoId && item.featureId === review.featureId,
          );
          if (!stillQueued) {
            return;
          }
          yield* SubscriptionRef.update(stateRef, (state) => markRunning(state, review));
          const completion = yield* repos
            .runCommand(review.repoId, review.request, publishCommandStream)
            .pipe(
              Effect.map((result) =>
                reviewCompletionSummary(review.repoId, review.request, result),
              ),
              // Keep draining the queue even when a review fails.
              Effect.catch(() => Effect.succeed<ReviewCompletionSummary | null>(null)),
            );
          yield* SubscriptionRef.update(stateRef, (state) => markIdle(state, completion));
        });

      yield* Effect.forkScoped(Effect.forever(Queue.take(queue).pipe(Effect.flatMap(runOne))));

      return ReviewQueueService.of({
        enqueue: (review) =>
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(stateRef);
            if (isPending(current, review.repoId, review.featureId)) {
              return;
            }
            yield* SubscriptionRef.update(stateRef, (state) => addQueued(state, review));
            yield* Queue.offer(queue, review);
          }),
        cancel: (repoId, featureId) =>
          SubscriptionRef.update(stateRef, (state) => removeQueued(state, repoId, featureId)),
        getState: () => SubscriptionRef.get(stateRef),
        changes: SubscriptionRef.changes(stateRef),
      });
    }),
  );
