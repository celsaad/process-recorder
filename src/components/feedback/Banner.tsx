import { AlertTriangle, Info } from "lucide-react";
import { cn } from "cn";
import type { BannerProps } from "@/lib/ui-contracts";
import { buttonClass } from "@/components/shell/button-styles";

/**
 * Non-blocking notice. No `role` of its own (D13): whoever shows it announces it through
 * `useAnnounce` if it needs announcing.
 * - `warning`: full-width strip under the header (storage full).
 * - `info`: rounded notice inside the content (long-video notice, D16).
 */
export function Banner({ tone, children, action }: BannerProps) {
  if (tone === "info") {
    return (
      <div
        data-tone="info"
        className="flex items-start gap-2.5 rounded-lg border border-info-border bg-info px-4 py-3 text-sm text-foreground"
      >
        <Info aria-hidden="true" className="size-5 shrink-0 text-primary" strokeWidth={1.9} />
        <div className="min-w-0 flex-1 text-pretty">{children}</div>
        {action && (
          <button type="button" className={buttonClass("secondary", "md")} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-tone="warning"
      className={cn(
        "box-border flex flex-wrap items-center justify-between gap-3 border-b border-warning-border bg-warning",
        "px-[clamp(16px,4vw,32px)] py-2.5 text-sm text-warning-foreground",
      )}
    >
      <div className="flex flex-[1_1_320px] items-center gap-2.5">
        <AlertTriangle aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.9} />
        <div className="min-w-0">{children}</div>
      </div>
      {action && (
        <button
          type="button"
          className={buttonClass(
            "secondary",
            "lg",
            "border-warning-foreground px-4 text-warning-foreground hover:bg-warning",
          )}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
