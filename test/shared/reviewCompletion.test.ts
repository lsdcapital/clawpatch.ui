import { describe, expect, it } from "vitest";
import type { ClawpatchCommandRequest, CommandResult } from "../../src/shared/types";
import { reviewCompletionSummary } from "../../src/shared/reviewCompletion";

describe("reviewCompletionSummary", () => {
  it("builds a feature summary from explicit counts", () => {
    const summary = reviewCompletionSummary(
      "repo-1",
      { command: "review", featureId: "feat-1" },
      makeResult({ findingCount: 3, reviewedFeatureCount: 1 }),
    );

    expect(summary).toEqual({
      kind: "feature",
      repoId: "repo-1",
      featureId: "feat-1",
      findingCount: 3,
      reviewedFeatureCount: 1,
    });
  });

  it("falls back to id-array lengths when explicit counts are absent", () => {
    const summary = reviewCompletionSummary(
      "repo-1",
      { command: "review" },
      makeResult({ findingIds: ["a", "b"], claimedFeatureIds: ["x"] }),
    );

    expect(summary).toEqual({
      kind: "batch",
      repoId: "repo-1",
      findingCount: 2,
      reviewedFeatureCount: 1,
    });
  });

  it("returns null counts when the parsed JSON has neither counts nor ids", () => {
    const summary = reviewCompletionSummary("repo-1", { command: "review" }, makeResult(null));

    expect(summary).toMatchObject({
      kind: "batch",
      findingCount: null,
      reviewedFeatureCount: null,
    });
  });

  it("ignores negative or non-finite counts and falls back to ids", () => {
    const summary = reviewCompletionSummary(
      "repo-1",
      { command: "review" },
      makeResult({ findingCount: -4, findingIds: ["a"] }),
    );

    expect(summary.findingCount).toBe(1);
  });
});

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

// Type-checks that the request literals above satisfy the union.
const _exampleRequest: ClawpatchCommandRequest = { command: "review" };
void _exampleRequest;
