import { cn } from "cn";

/** Decorative ring spinner (aria-hidden). Stops under prefers-reduced-motion via the global reset. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  const border = size >= 22 ? 3 : 2;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-spinner-track border-t-primary",
        className,
      )}
      style={{ width: size, height: size, borderWidth: border, borderStyle: "solid" }}
    />
  );
}
