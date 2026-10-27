"use client";

import { useEffect, useRef } from "react";

const EVERY_MS = 2000;

/** Calls `load` every two seconds while `active`, and stops when it is not. */
export function usePolling(load: () => unknown, active: boolean): void {
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => latest.current(), EVERY_MS);
    return () => clearInterval(timer);
  }, [active]);
}
