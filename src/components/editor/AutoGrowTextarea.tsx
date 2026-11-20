"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const supportsFieldSizing = () =>
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/** Grows with its content: CSS `field-sizing: content`, with a scrollHeight fallback (Firefox, older Safari). */
export function AutoGrowTextarea({ className, value, ...props }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Assume native support for the server render; corrected on mount.
  const [native, setNative] = useState(true);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time feature detection, browser-only
    setNative(supportsFieldSizing());
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || native) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`; // + top/bottom border
    };
    fit();
    // Width changes (window or column resize) rewrap the text, so refit then too.
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === lastWidth) return; // our own height change; avoid a loop
      lastWidth = el.offsetWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, native]);

  return (
    <Textarea
      ref={ref}
      value={value}
      className={cn("resize-none", native && "overflow-hidden", className)}
      {...props}
    />
  );
}
