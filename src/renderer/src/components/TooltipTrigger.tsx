import type { FocusEventHandler, MouseEventHandler, ReactNode } from "react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

interface TooltipRenderProps {
  readonly describedBy: string | undefined;
  readonly hideTooltip: () => void;
  readonly showTooltip: () => void;
}

interface TooltipTriggerProps {
  readonly children: (props: TooltipRenderProps) => ReactNode;
  readonly className?: string;
  readonly hidden?: boolean;
  readonly onBlur?: FocusEventHandler<HTMLSpanElement>;
  readonly onFocus?: FocusEventHandler<HTMLSpanElement>;
  readonly onMouseEnter?: MouseEventHandler<HTMLSpanElement>;
  readonly onMouseLeave?: MouseEventHandler<HTMLSpanElement>;
  readonly placement?: TooltipPlacement;
  readonly tooltip: string;
}

interface TooltipPosition {
  readonly left: number;
  readonly placement: TooltipPlacement;
  readonly top: number;
}

const tooltipOffset = 6;
const tooltipViewportMargin = 8;

export function TooltipTrigger({
  children,
  className,
  hidden = false,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  placement = "bottom",
  tooltip,
}: TooltipTriggerProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>({
    left: 0,
    placement,
    top: 0,
  });
  const shouldRenderTooltip = !hidden && tooltip.trim() !== "";
  const describedBy = shouldRenderTooltip && isTooltipVisible ? tooltipId : undefined;

  const updateTooltipPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltipElement = tooltipRef.current;
    if (trigger === null || tooltipElement === null) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const nextPosition = positionTooltip(triggerRect, tooltipRect, placement);
    setTooltipPosition(nextPosition);
  }, [placement]);

  useLayoutEffect(() => {
    if (!isTooltipVisible || !shouldRenderTooltip) {
      return;
    }

    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);

    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [isTooltipVisible, shouldRenderTooltip, updateTooltipPosition]);

  const showTooltip = (): void => {
    if (shouldRenderTooltip) {
      setIsTooltipVisible(true);
    }
  };

  const hideTooltip = (): void => {
    setIsTooltipVisible(false);
  };

  return (
    <span
      className={["icon-tooltip-trigger", className].filter(Boolean).join(" ")}
      data-tooltip-hidden={hidden ? "true" : undefined}
      onBlur={(event) => {
        hideTooltip();
        onBlur?.(event);
      }}
      onFocus={(event) => {
        showTooltip();
        onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        showTooltip();
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        hideTooltip();
        onMouseLeave?.(event);
      }}
      ref={triggerRef}
    >
      {children({ describedBy, hideTooltip, showTooltip })}
      {shouldRenderTooltip && isTooltipVisible
        ? createPortal(
            <span
              aria-hidden="true"
              className="icon-tooltip"
              data-placement={tooltipPosition.placement}
              data-visible={isTooltipVisible ? "true" : undefined}
              id={tooltipId}
              ref={tooltipRef}
              style={{
                left: tooltipPosition.left,
                top: tooltipPosition.top,
              }}
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

function positionTooltip(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  placement: TooltipPlacement,
): TooltipPosition {
  const viewport = {
    height: window.innerHeight,
    width: window.innerWidth,
  };
  const preferredPosition = rawTooltipPosition(triggerRect, tooltipRect, placement);
  const oppositePlacement = oppositeTooltipPlacement(placement);
  const oppositePosition = rawTooltipPosition(triggerRect, tooltipRect, oppositePlacement);
  const effectivePlacement =
    overflowsMainAxis(preferredPosition, tooltipRect, placement, viewport) &&
    !overflowsMainAxis(oppositePosition, tooltipRect, oppositePlacement, viewport)
      ? oppositePlacement
      : placement;
  const effectivePosition = effectivePlacement === placement ? preferredPosition : oppositePosition;

  return {
    left: clampToViewport(effectivePosition.left, tooltipRect.width, viewport.width),
    placement: effectivePlacement,
    top: clampToViewport(effectivePosition.top, tooltipRect.height, viewport.height),
  };
}

function rawTooltipPosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  placement: TooltipPlacement,
): Omit<TooltipPosition, "placement"> {
  switch (placement) {
    case "top":
      return {
        left: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
        top: triggerRect.top - tooltipRect.height - tooltipOffset,
      };
    case "left":
      return {
        left: triggerRect.left - tooltipRect.width - tooltipOffset,
        top: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
      };
    case "right":
      return {
        left: triggerRect.right + tooltipOffset,
        top: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
      };
    case "bottom":
      return {
        left: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
        top: triggerRect.bottom + tooltipOffset,
      };
  }
}

function oppositeTooltipPlacement(placement: TooltipPlacement): TooltipPlacement {
  switch (placement) {
    case "top":
      return "bottom";
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

function overflowsMainAxis(
  position: Omit<TooltipPosition, "placement">,
  tooltipRect: DOMRect,
  placement: TooltipPlacement,
  viewport: { readonly height: number; readonly width: number },
): boolean {
  switch (placement) {
    case "top":
      return position.top < tooltipViewportMargin;
    case "bottom":
      return position.top + tooltipRect.height > viewport.height - tooltipViewportMargin;
    case "left":
      return position.left < tooltipViewportMargin;
    case "right":
      return position.left + tooltipRect.width > viewport.width - tooltipViewportMargin;
  }
}

function clampToViewport(value: number, size: number, viewportSize: number): number {
  const min = tooltipViewportMargin;
  const max = Math.max(min, viewportSize - size - tooltipViewportMargin);
  return Math.min(Math.max(value, min), max);
}
