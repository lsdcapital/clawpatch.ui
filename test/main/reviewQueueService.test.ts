import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RepoService, type RepoServiceShape } from "../../src/main/services/repoService";
import {
  ReviewQueueService,
  ReviewQueueServiceLive,
  type ReviewCommandRequest,
} from "../../src/main/services/reviewQueueService";
import type { ClawpatchCommandRequest, CommandResult } from "../../src/shared/types";

describe("ReviewQueueService", () => {
  it("runs queued reviews one at a time and records the completion summary", async () => {
    const harness = makeHarness();

    const program = Effect.gen(function* () {
      const queue = yield* ReviewQueueService;
      yield* queue.enqueue(makeReview("repo", "a"));
      yield* queue.enqueue(makeReview("repo", "b"));

      yield* Effect.sleep("25 millis");
      expect(harness.started).toEqual(["a"]); // b waits its turn
      let state = yield* queue.getState();
      expect(state.runningFeatureId).toBe("a");
      expect(state.queued.map((item) => item.featureId)).toEqual(["b"]);

      harness.release("a", { findingCount: 2 });
      yield* Effect.sleep("25 millis");
      expect(harness.started).toEqual(["a", "b"]);
      state = yield* queue.getState();
      expect(state.runningFeatureId).toBe("b");

      harness.release("b", { findingCount: 5 });
      yield* Effect.sleep("25 millis");
      state = yield* queue.getState();
      expect(state.runningFeatureId).toBeNull();
      expect(state.queued).toEqual([]);
      expect(state.lastCompletion).toMatchObject({
        kind: "feature",
        featureId: "b",
        findingCount: 5,
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(harness.layer)));
  });

  it("does not run a review that was cancelled while queued", async () => {
    const harness = makeHarness();

    const program = Effect.gen(function* () {
      const queue = yield* ReviewQueueService;
      yield* queue.enqueue(makeReview("repo", "a"));
      yield* queue.enqueue(makeReview("repo", "b"));
      yield* Effect.sleep("25 millis");

      yield* queue.cancel("repo", "b");
      let state = yield* queue.getState();
      expect(state.queued).toEqual([]);

      harness.release("a", { findingCount: 1 });
      yield* Effect.sleep("25 millis");

      expect(harness.started).toEqual(["a"]); // b was cancelled before it ran
      state = yield* queue.getState();
      expect(state.runningFeatureId).toBeNull();
    });

    await Effect.runPromise(program.pipe(Effect.provide(harness.layer)));
  });

  it("keeps draining after a review fails", async () => {
    const harness = makeHarness();

    const program = Effect.gen(function* () {
      const queue = yield* ReviewQueueService;
      yield* queue.enqueue(makeReview("repo", "a"));
      yield* queue.enqueue(makeReview("repo", "b"));
      yield* Effect.sleep("25 millis");

      harness.fail("a");
      yield* Effect.sleep("25 millis");
      expect(harness.started).toEqual(["a", "b"]); // failure did not stall the queue

      harness.release("b", { findingCount: 0 });
      yield* Effect.sleep("25 millis");
      const state = yield* queue.getState();
      expect(state.runningFeatureId).toBeNull();
    });

    await Effect.runPromise(program.pipe(Effect.provide(harness.layer)));
  });

  it("ignores a duplicate enqueue for an already-pending feature", async () => {
    const harness = makeHarness();

    const program = Effect.gen(function* () {
      const queue = yield* ReviewQueueService;
      yield* queue.enqueue(makeReview("repo", "a"));
      yield* queue.enqueue(makeReview("repo", "b"));
      yield* queue.enqueue(makeReview("repo", "b")); // duplicate
      yield* Effect.sleep("25 millis");

      const state = yield* queue.getState();
      expect(state.queued.map((item) => item.featureId)).toEqual(["b"]);

      harness.release("a", {});
      harness.release("b", {});
      yield* Effect.sleep("25 millis");
      expect(harness.started).toEqual(["a", "b"]); // b ran exactly once
    });

    await Effect.runPromise(program.pipe(Effect.provide(harness.layer)));
  });
});

function makeReview(repoId: string, featureId: string) {
  const request: ReviewCommandRequest = { command: "review", featureId };
  return { repoId, featureId, request };
}

// A controllable RepoService stub: each runCommand call blocks until the test
// releases (or fails) that feature id, so ordering can be asserted precisely.
function makeHarness() {
  const started: string[] = [];
  const settlers = new Map<string, (result: CommandResult) => void>();
  const rejecters = new Map<string, (error: unknown) => void>();

  const runCommand: RepoServiceShape["runCommand"] = (
    _repoId,
    request: ClawpatchCommandRequest,
  ) => {
    const featureId = (request as ReviewCommandRequest).featureId;
    started.push(featureId);
    return Effect.tryPromise({
      try: () =>
        new Promise<CommandResult>((resolve, reject) => {
          settlers.set(featureId, resolve);
          rejecters.set(featureId, reject);
        }),
      catch: (cause) => cause as never,
    });
  };

  const repoStub = RepoService.of({ runCommand } as unknown as RepoServiceShape);
  const layer = ReviewQueueServiceLive(() => undefined).pipe(
    Layer.provide(Layer.succeed(RepoService, repoStub)),
  );

  return {
    started,
    layer,
    release: (featureId: string, parsedJson: unknown) =>
      settlers.get(featureId)?.(makeResult(parsedJson)),
    fail: (featureId: string) => rejecters.get(featureId)?.(new Error("review failed")),
  };
}

function makeResult(parsedJson: unknown): CommandResult {
  return {
    runId: "run-1",
    command: "review",
    args: ["review"],
    cwd: "/tmp/repo",
    exitCode: 0,
    durationMs: 1,
    stdout: "",
    stderr: "",
    parsedJson,
  };
}
