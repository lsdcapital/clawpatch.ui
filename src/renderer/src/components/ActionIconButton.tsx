import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconButton } from "./IconButton";

type ActionIconButtonVariant = "primary" | "secondary" | "danger";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> {
  icon: ReactNode;
  label: string;
  title?: string;
  variant?: ActionIconButtonVariant;
}

export function ActionIconButton({
  className,
  icon,
  label,
  title,
  type = "button",
  variant = "secondary",
  ...props
}: Props) {
  const classes = ["action-icon-button", `action-icon-button-${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <IconButton
      {...props}
      className={classes}
      icon={icon}
      label={label}
      tooltip={title}
      type={type}
    />
  );
}
