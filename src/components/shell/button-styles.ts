// Button class strings from the design canvas (heights 32 / 40 / 44, radius 8).
// Plain strings so they work on <button>, on Radix `asChild` parts and through `cn`.
import { cn } from "cn";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap " +
  "cursor-pointer transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0 " +
  "aria-disabled:cursor-not-allowed disabled:cursor-not-allowed";

const variants = {
  primary: "border-0 bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-control-border bg-card text-foreground hover:bg-muted",
  danger: "border-0 bg-destructive text-primary-foreground hover:bg-destructive/90",
  ghost: "border-0 bg-transparent text-foreground-2 hover:bg-muted hover:text-foreground",
} as const;

const sizes = {
  sm: "h-8 px-2.5 text-meta",
  md: "h-10 px-3.5",
  lg: "h-11 px-5",
  icon: "size-8 p-0",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "lg", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

/** Disabled look from the canvas tokens note (bg #F5F6F8, border #DADEE4, text #7C8594). */
export const disabledButtonClass =
  "border border-disabled-border bg-disabled text-disabled-foreground hover:bg-disabled";
