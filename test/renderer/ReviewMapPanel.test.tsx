import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewMapPanel } from "../../src/renderer/src/components/ReviewMapPanel";
import type { FeatureMapSnapshot } from "../../src/shared/types";

describe("ReviewMapPanel", () => {
  it("shows the review queue header and runs bulk review by pending count", () => {
    const onReviewPending = vi.fn();

    renderPanel({ onReviewPending });

    expect(screen.getByRole("heading", { name: "Review Queue" })).toBeInTheDocument();
    expect(screen.getByText("2 pending/error of 3 map items")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review all 2 pending and error map items" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Review \d+ remaining/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review all 2 pending and error map items" }),
    ).not.toHaveAttribute("title");
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Review all 2 pending and error map items" })
        .parentElement as HTMLElement,
    );
    expect(screen.getByText("Review pending")).toHaveClass("icon-tooltip");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review all 2 pending and error map items",
      }),
    );
    expect(onReviewPending).toHaveBeenCalledWith(2);
  });

  it("reviews individual map items by feature id", () => {
    const onReviewFeature = vi.fn();

    renderPanel({ onReviewFeature });

    const billingRow = screen.getByText("Billing").closest('[role="row"]');
    expect(billingRow).not.toBeNull();

    fireEvent.click(
      within(billingRow as HTMLElement).getByRole("button", { name: "Review Billing" }),
    );
    expect(onReviewFeature).toHaveBeenCalledWith("feat-billing");
  });

  it("updates the map from the toolbar action", () => {
    const onUpdateMap = vi.fn();

    renderPanel({ onUpdateMap });

    fireEvent.click(screen.getByRole("button", { name: "Update map" }));
    expect(onUpdateMap).toHaveBeenCalledOnce();
  });

  it("filters visible map rows without changing the bulk review request", () => {
    const onReviewPending = vi.fn();

    renderPanel({ onReviewPending });

    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.queryByText("Profile settings")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search review queue"), {
      target: { value: "billing" },
    });
    expect(screen.getByText("1 of 3 shown")).toBeInTheDocument();
    expect(screen.queryByText("Authentication")).not.toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review all 2 pending and error map items",
      }),
    );
    expect(onReviewPending).toHaveBeenCalledWith(2);
  });

  it("allows viewing all statuses through the status filter", () => {
    renderPanel();

    fireEvent.click(screen.getByText("Filter"));
    const statusGroup = screen
      .getAllByText("Status")
      .find((element) => element.closest(".filter-group"))
      ?.closest(".filter-group");
    expect(statusGroup).not.toBeNull();

    fireEvent.click(within(statusGroup as HTMLElement).getByRole("button", { name: "All" }));
    expect(screen.getByText("3 of 3 shown")).toBeInTheDocument();
    expect(screen.getByText("Profile settings")).toBeInTheDocument();
  });

  it("closes the filter menu when clicking outside it", () => {
    renderPanel();

    fireEvent.click(screen.getByText("Filter"));
    expect(getFilterMenu()).toHaveProperty("open", true);

    fireEvent.mouseDown(screen.getByLabelText("Search review queue"));
    expect(getFilterMenu()).toHaveProperty("open", false);
  });
});

function renderPanel({
  onReviewFeature = vi.fn(),
  onReviewPending = vi.fn(),
  onUpdateMap = vi.fn(),
}: {
  onReviewFeature?: (featureId: string) => void;
  onReviewPending?: (limit: number) => void;
  onUpdateMap?: () => void;
} = {}) {
  return render(
    <ReviewMapPanel
      snapshot={makeSnapshot()}
      isLoading={false}
      isBusy={false}
      onReviewFeature={onReviewFeature}
      onReviewPending={onReviewPending}
      onUpdateMap={onUpdateMap}
    />,
  );
}

function getFilterMenu(): HTMLDetailsElement {
  const filterMenu = screen.getByText("Filter").closest("details");
  expect(filterMenu).not.toBeNull();
  return filterMenu as HTMLDetailsElement;
}

function makeSnapshot(): FeatureMapSnapshot {
  return {
    features: [
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
      {
        featureId: "feat-profile",
        title: "Profile settings",
        status: "reviewed",
        kind: "feature",
        source: "map",
        ownedFileCount: 2,
        contextFileCount: 0,
        testCount: 1,
        findingCount: 1,
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
      {
        featureId: "feat-billing",
        title: "Billing",
        status: "error",
        kind: "integration",
        source: "manual",
        ownedFileCount: 1,
        contextFileCount: 1,
        testCount: 0,
        findingCount: 0,
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    coverage: {
      totalFeatures: 3,
      pendingReviewCount: 2,
      pendingReviewFeatureIds: ["feat-auth", "feat-billing"],
      latestReviewRun: null,
      latestLimitedReviewRun: null,
      hasLimitedReviewRemainder: false,
    },
  };
}
