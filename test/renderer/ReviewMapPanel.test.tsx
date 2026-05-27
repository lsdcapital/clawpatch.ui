import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReviewMapPanel } from "../../src/renderer/src/components/ReviewMapPanel";
import type { FeatureMapItem, FeatureMapSnapshot } from "../../src/shared/types";

describe("ReviewMapPanel", () => {
  it("shows the review queue header and runs bulk review by pending count", () => {
    const onReviewPending = vi.fn();

    renderPanel({ onReviewPending });

    expect(screen.getByRole("heading", { name: "Review Queue" })).toBeInTheDocument();
    expect(screen.getByText("2 pending/error of 3 map items")).toBeInTheDocument();
    const updateMapButton = screen.getByRole("button", { name: "Update map" });
    const reviewMappedFeaturesButton = screen.getByRole("button", {
      name: "Review all 2 mapped features pending review",
    });
    expect(reviewMappedFeaturesButton).toBeInTheDocument();
    expect(updateMapButton.compareDocumentPosition(reviewMappedFeaturesButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText(/Review \d+ remaining/)).not.toBeInTheDocument();
    expect(reviewMappedFeaturesButton).not.toHaveAttribute("title");
    fireEvent.mouseEnter(reviewMappedFeaturesButton.parentElement as HTMLElement);
    expect(screen.getByText("Review mapped features")).toHaveClass("icon-tooltip");

    fireEvent.click(reviewMappedFeaturesButton);
    expect(onReviewPending).toHaveBeenCalledWith({ limit: 2 });
  });

  it("reviews individual map items by feature id", () => {
    const onReviewFeature = vi.fn();

    renderPanel({ onReviewFeature });

    const billingRow = screen.getByText("Billing").closest('[role="row"]');
    expect(billingRow).not.toBeNull();

    fireEvent.click(
      within(billingRow as HTMLElement).getByRole("button", { name: "Review Billing" }),
    );
    expect(onReviewFeature).toHaveBeenCalledWith("feat-billing", {});
  });

  it("disables row review buttons only for active features", () => {
    renderPanel({ runningReviewFeatureId: "feat-auth", queuedReviewFeatureIds: ["feat-billing"] });

    expect(screen.getByRole("button", { name: "Running" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Queued" })).toBeDisabled();
    expect(screen.getByText("Running")).toHaveClass("review-action-state-running");
    expect(screen.getByText("Queued")).toHaveClass("review-action-state-queued");
  });

  it("does not disable row review buttons for unrelated busy toolbar actions", () => {
    renderPanel({ isBusy: true });

    expect(screen.getByRole("button", { name: "Update map" })).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Review all 2 mapped features pending review",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review Authentication" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Review Billing" })).not.toBeDisabled();
  });

  it("expands map rows with feature details and linked findings", () => {
    renderPanel();

    expect(screen.queryByText("Auth request handling")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Authentication" }));

    expect(screen.getByRole("button", { name: "Collapse Authentication" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Auth request handling")).toBeInTheDocument();
    expect(screen.getAllByText("src/auth.ts")).toHaveLength(2);
    expect(screen.getByText("src/session.ts")).toBeInTheDocument();
    expect(screen.getByText("src/auth.test.ts")).toBeInTheDocument();
    expect(screen.getByText("Login can bypass lockout")).toBeInTheDocument();
    expect(screen.getByText(/open\s+\/\s+high\s+\/\s+medium/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Authentication" }));
    expect(screen.queryByText("Auth request handling")).not.toBeInTheDocument();
  });

  it("shows the last completed review finding count", () => {
    renderPanel({
      lastReviewCompletion: {
        kind: "feature",
        repoId: "repo-auth",
        featureId: "feat-billing",
        findingCount: 0,
        reviewedFeatureCount: 1,
      },
    });

    expect(screen.getByText("Reviewed Billing: 0 findings")).toHaveClass("review-completion-note");
  });

  it("updates the map from the toolbar action", () => {
    const onUpdateMap = vi.fn();

    renderPanel({ onUpdateMap });

    fireEvent.click(screen.getByRole("button", { name: "Update map" }));
    expect(onUpdateMap).toHaveBeenCalledOnce();
  });

  it("passes focused review scope options for bulk and feature reviews", () => {
    const onReviewFeature = vi.fn();
    const onReviewPending = vi.fn();

    renderPanel({ onReviewFeature, onReviewPending });

    fireEvent.change(screen.getByLabelText("Review limit"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Review since ref"), {
      target: { value: "origin/main" },
    });
    fireEvent.click(screen.getByLabelText("Include dirty changes"));
    fireEvent.change(screen.getByLabelText("Review guidance"), {
      target: { value: "Focus on parser boundaries." },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review all 2 mapped features pending review",
      }),
    );
    expect(onReviewPending).toHaveBeenCalledWith({
      limit: 1,
      since: "origin/main",
      includeDirty: true,
      promptText: "Focus on parser boundaries.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Review Billing" }));
    expect(onReviewFeature).toHaveBeenCalledWith("feat-billing", {
      since: "origin/main",
      includeDirty: true,
      promptText: "Focus on parser boundaries.",
    });
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
        name: "Review all 2 mapped features pending review",
      }),
    );
    expect(onReviewPending).toHaveBeenCalledWith({ limit: 2 });
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
  isBusy = false,
  runningReviewFeatureId = null,
  queuedReviewFeatureIds = [],
  lastReviewCompletion = null,
}: {
  onReviewFeature?: ComponentProps<typeof ReviewMapPanel>["onReviewFeature"];
  onReviewPending?: ComponentProps<typeof ReviewMapPanel>["onReviewPending"];
  onUpdateMap?: () => void;
  isBusy?: boolean;
  runningReviewFeatureId?: string | null;
  queuedReviewFeatureIds?: readonly string[];
  lastReviewCompletion?: ComponentProps<typeof ReviewMapPanel>["lastReviewCompletion"];
} = {}) {
  return render(
    <ReviewMapPanel
      snapshot={makeSnapshot()}
      isLoading={false}
      isBusy={isBusy}
      runningReviewFeatureId={runningReviewFeatureId}
      queuedReviewFeatureIds={queuedReviewFeatureIds}
      lastReviewCompletion={lastReviewCompletion}
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
      makeFeature({
        featureId: "feat-auth",
        title: "Authentication",
        summary: "Auth request handling",
        status: "pending",
        kind: "feature",
        source: "map",
        entrypoints: [
          {
            path: "src/auth.ts",
            symbol: "authenticate",
            route: "/login",
            command: null,
          },
        ],
        ownedFiles: [{ path: "src/auth.ts", reason: "auth module" }],
        contextFiles: [{ path: "src/session.ts", reason: "session context" }],
        tests: [{ path: "src/auth.test.ts", reason: "auth tests" }],
        findingIds: ["fnd-auth"],
        linkedFindings: [
          {
            findingId: "fnd-auth",
            title: "Login can bypass lockout",
            status: "open",
            severity: "high",
            confidence: "medium",
          },
        ],
        ownedFileCount: 1,
        contextFileCount: 1,
        testCount: 1,
        findingCount: 1,
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
      makeFeature({
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
      }),
      makeFeature({
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
      }),
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

function makeFeature(
  overrides: Partial<FeatureMapItem> & Pick<FeatureMapItem, "featureId" | "title">,
): FeatureMapItem {
  return {
    summary: null,
    status: "pending",
    kind: "feature",
    source: "map",
    entrypoints: [],
    ownedFiles: [],
    contextFiles: [],
    tests: [],
    findingIds: [],
    linkedFindings: [],
    ownedFileCount: 0,
    contextFileCount: 0,
    testCount: 0,
    findingCount: 0,
    updatedAt: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}
