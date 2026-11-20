"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveRegionProvider } from "./LiveRegion";

/**
 * The app-wide providers, mounted once by `layout.tsx`. The LiveRegionProvider's region is the
 * app's only `aria-live` region (D13): nothing here (or anywhere) mounts sonner's `<Toaster>`,
 * whose container is a second one. The export-failed toast is ExportButton's own element.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <LiveRegionProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </LiveRegionProvider>
  );
}
