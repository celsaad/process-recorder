"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce | null>(null);

/** One polite live region for the whole app (D13). Status text is announced, never visible. */
export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback<Announce>((next) => {
    if (timer.current) clearTimeout(timer.current);
    // Clear first so repeating the same message is announced again.
    setMessage("");
    timer.current = setTimeout(() => setMessage(next), 50);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): Announce {
  const announce = useContext(AnnounceContext);
  if (!announce) throw new Error("useAnnounce must be used inside LiveRegionProvider");
  return announce;
}
