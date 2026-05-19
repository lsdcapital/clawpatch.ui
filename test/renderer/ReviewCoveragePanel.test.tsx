import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewCoveragePanel } from "../../src/renderer/src/components/ReviewCoveragePanel";
import type { FeatureMapSnapshot } from "../../src/shared/types";

describe("ReviewCoveragePanel actions", () => {
  it("keeps review controls tied to map coverage state", () => {
    const onRunMap = vi.fn();
    const onReviewNext = vi.fn();
    const onReviewAllPending = vi.fn();
    const onToggleExpanded = vi.fn();

    render(
      <ReviewCoveragePanel
        snapshot={makeSnapshot({ totalFeatures: 3, pendingReviewCount: 2 })}
        isLoading={false}
        isBusy={false}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
        onRunMap={onRunMap}
        onReviewNext={onReviewNext}
        onReviewAllPending={onReviewAllPending}
        onReviewFeature={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update map" }));
    expect(onRunMap).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Review next" }));
    expect(onReviewNext).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Review 2 remaining" }));
    expect(onReviewAllPending).toHaveBeenCalledWith(2);

    const tableToggle = screen.getByRole("button", { name: "Hide map table" });
    expect(tableToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tableToggle);
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it("disables review next without map items and hides review remaining at zero pending", () => {
    render(
      <ReviewCoveragePanel
        snapshot={makeSnapshot({ totalFeatures: 0, pendingReviewCount: 0 })}
        isLoading={false}
        isBusy={false}
        isExpanded={false}
        onToggleExpanded={() => undefined}
        onRunMap={() => undefined}
        onReviewNext={() => undefined}
        onReviewAllPending={() => undefined}
        onReviewFeature={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Review next" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /remaining/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show map table" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

function makeSnapshot({
  totalFeatures,
  pendingReviewCount,
}: {
  totalFeatures: number;
  pendingReviewCount: number;
}): FeatureMapSnapshot {
  return {
    features:
      totalFeatures === 0
        ? []
        : [
            {
              featureId: "feat-auth",
              title: "Authentication",
              status: "pending",
              kind: "feature",
              source: "map",
              ownedFileCount: 1,
              contextFileCount: 1,
              testCount: 1,
              findingCount: 0,
              updatedAt: "2026-05-19T00:00:00.000Z",
            },
          ],
    coverage: {
      totalFeatures,
      pendingReviewCount,
      pendingReviewFeatureIds: [],
      latestReviewRun: null,
      latestLimitedReviewRun: null,
      hasLimitedReviewRemainder: false,
    },
  };
}
