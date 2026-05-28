import type { ButtonHTMLAttributes, ReactNode } from "react";
import { TooltipTrigger, type TooltipPlacement } from "./TooltipTrigger";

type IconButtonTooltipPlacement = TooltipPlacement;

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
  const tooltipText = tooltip ?? label;

  return (
    <TooltipTrigger
      className={containerClassName}
      hidden={tooltipHidden}
      placement={tooltipPlacement}
      tooltip={tooltipText}
    >
      {({ describedBy, hideTooltip, showTooltip }) => {
        const mergedDescribedBy = [ariaDescribedBy, describedBy].filter(Boolean).join(" ");
        return (
          <button
            {...props}
            aria-describedby={mergedDescribedBy === "" ? undefined : mergedDescribedBy}
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
        );
      }}
    </TooltipTrigger>
  );
}
