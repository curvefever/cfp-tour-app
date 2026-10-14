import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "warning" | "accent" | "ghost";
type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-cfp-game-fold text-foreground hover:brightness-125",
  success: "bg-success text-on-primary hover:brightness-110",
  danger: "bg-cfp-danger-ground text-cfp-danger-text hover:brightness-125",
  warning: "bg-warning text-on-primary hover:brightness-110",
  accent: "bg-cfp-teal text-on-primary hover:brightness-110",
  ghost: "bg-transparent text-muted shadow-none hover:bg-surface-low hover:text-foreground",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-11 px-5 text-[15px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, size = "md", type = "button", variant = "secondary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-(--app-radius-button) border-0 font-bold shadow-[inset_0_-4px_0_var(--app-button-edge)] transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-35",
        variants[variant],
        sizes[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export function ButtonRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-3.5 flex flex-wrap gap-2.5", className)} {...props} />;
}
