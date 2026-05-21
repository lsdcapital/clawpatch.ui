import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "../../src/renderer/src/components/IconButton";

describe("IconButton tooltip positioning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setViewport(1024, 768);
  });

  it("flips bottom-placement tooltips above the trigger near the bottom viewport edge", async () => {
    setViewport(800, 500);

    const tooltip = await renderVisibleTooltip({
      placement: "bottom",
      tooltipRect: rect({ height: 18, left: 0, top: 0, width: 90 }),
      triggerRect: rect({ height: 20, left: 400, top: 470, width: 20 }),
    });

    await waitFor(() => {
      expect(tooltip).toHaveAttribute("data-placement", "top");
      expect(tooltip).toHaveStyle({ left: "365px", top: "446px" });
    });
  });

  it("flips top-placement tooltips below the trigger near the top viewport edge", async () => {
    setViewport(800, 500);

    const tooltip = await renderVisibleTooltip({
      placement: "top",
      tooltipRect: rect({ height: 18, left: 0, top: 0, width: 90 }),
      triggerRect: rect({ height: 20, left: 400, top: 10, width: 20 }),
    });

    await waitFor(() => {
      expect(tooltip).toHaveAttribute("data-placement", "bottom");
      expect(tooltip).toHaveStyle({ left: "365px", top: "36px" });
    });
  });

  it("clamps centered tooltip positions inside the viewport", async () => {
    setViewport(800, 500);

    const tooltip = await renderVisibleTooltip({
      placement: "bottom",
      tooltipRect: rect({ height: 18, left: 0, top: 0, width: 120 }),
      triggerRect: rect({ height: 20, left: 0, top: 100, width: 20 }),
    });

    await waitFor(() => {
      expect(tooltip).toHaveAttribute("data-placement", "bottom");
      expect(tooltip).toHaveStyle({ left: "8px", top: "126px" });
    });
  });

  it("clamps left and right placements vertically inside the viewport", async () => {
    setViewport(800, 500);

    const tooltip = await renderVisibleTooltip({
      placement: "right",
      tooltipRect: rect({ height: 60, left: 0, top: 0, width: 90 }),
      triggerRect: rect({ height: 20, left: 200, top: 0, width: 20 }),
    });

    await waitFor(() => {
      expect(tooltip).toHaveAttribute("data-placement", "right");
      expect(tooltip).toHaveStyle({ left: "226px", top: "8px" });
    });
  });
});

interface TooltipRenderOptions {
  readonly placement: "top" | "bottom" | "left" | "right";
  readonly tooltipRect: DOMRect;
  readonly triggerRect: DOMRect;
}

async function renderVisibleTooltip({
  placement,
  tooltipRect,
  triggerRect,
}: TooltipRenderOptions): Promise<HTMLElement> {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("icon-tooltip-trigger")) {
        return triggerRect;
      }
      if (this.classList.contains("icon-tooltip")) {
        return tooltipRect;
      }
      return rect({ height: 0, left: 0, top: 0, width: 0 });
    },
  );

  render(
    <IconButton
      icon={<span aria-hidden="true" />}
      label="Example action"
      tooltip="Example tooltip"
      tooltipPlacement={placement}
    />,
  );

  fireEvent.mouseEnter(screen.getByRole("button", { name: "Example action" }).parentElement!);

  return await screen.findByText("Example tooltip");
}

function rect({
  height,
  left,
  top,
  width,
}: {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}
