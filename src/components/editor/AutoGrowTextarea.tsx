"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const supportsFieldSizing = () =>
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/** Grows with its content: CSS `field-sizing: content`, with a scrollHeight fallback (Firefox, older Safari). */
export function AutoGrowTextarea({ className, value, ...props }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || supportsFieldSizing()) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`; // + top/bottom border
  }, [value]);

  return (
    <Textarea
      ref={ref}
      value={value}
      className={cn("resize-none overflow-hidden", className)}
      {...props}
    />
  );
}
