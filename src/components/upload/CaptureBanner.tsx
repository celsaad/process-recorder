import type { CaptureBannerProps } from "@/lib/ui-contracts";
import { Spinner } from "@/components/shell/Spinner";

/**
 * Compact banner above the step list while screenshots are captured (EditorCapturing board).
 * Visual only: the orchestrator hook announces "Capturing screenshots" (no `useAnnounce` here).
 */
export function CaptureBanner({ done, total }: CaptureBannerProps) {
  const shown = Math.min(done, total);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      <Spinner size={16} />
      <p className="text-sm font-semibold tabular-nums">
        Screenshots {shown} of {total}
      </p>
      <p className="text-sm text-foreground-2">You can edit the steps while the rest are captured.</p>
    </div>
  );
}
