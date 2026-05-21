import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type IconButtonTooltipPlacement = "top" | "bottom" | "left" | "right";

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "title"
> {
  readonly containerClassName?: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly tooltip?: string;
  readonly tooltipHidden?: boolean;
  readonly tooltipPlacement?: IconButtonTooltipPlacement;
}

interface TooltipPosition {
  readonly left: number;
  readonly top: number;
}

const tooltipOffset = 6;

export function IconButton({
  "aria-describedby": ariaDescribedBy,
  className,
  containerClassName,
  icon,
  label,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  tooltip,
  tooltipHidden = false,
  tooltipPlacement = "bottom",
  type = "button",
  ...props
}: IconButtonProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>({ left: 0, top: 0 });
  const tooltipText = tooltip ?? label;
  const shouldRenderTooltip = !tooltipHidden && tooltipText.trim() !== "";
  const describedBy = [
    ariaDescribedBy,
    shouldRenderTooltip && isTooltipVisible ? tooltipId : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  const updateTooltipPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltipElement = tooltipRef.current;
    if (trigger === null || tooltipElement === null) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const nextPosition = positionTooltip(triggerRect, tooltipRect, tooltipPlacement);
    setTooltipPosition(nextPosition);
  }, [tooltipPlacement]);

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
      className={["icon-tooltip-trigger", containerClassName].filter(Boolean).join(" ")}
      data-tooltip-hidden={tooltipHidden ? "true" : undefined}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      ref={triggerRef}
    >
      <button
        {...props}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-label={label}
        className={className}
        onBlur={(event) => {
          hideTooltip();
          onBlur?.(event);
        }}
        onFocus={(event) => {
          showTooltip();
          onFocus?.(event);
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        type={type}
      >
        {icon}
      </button>
      {shouldRenderTooltip && isTooltipVisible
        ? createPortal(
            <span
              aria-hidden="true"
              className="icon-tooltip"
              data-placement={tooltipPlacement}
              data-visible={isTooltipVisible ? "true" : undefined}
              id={tooltipId}
              ref={tooltipRef}
              style={{
                left: tooltipPosition.left,
                top: tooltipPosition.top,
              }}
            >
              {tooltipText}
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
  placement: IconButtonTooltipPlacement,
): TooltipPosition {
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
