"use client";

/**
 * A short notice that outlives the page it was given on: approving a document moves on to the
 * next one at once, and without it nothing said that the approval was recorded.
 */
import { useEffect, useState } from "react";

const EVENT = "civ:notice";
const SHOWN_MS = 4000;

export function notify(text: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }));
}

/** Where the notices show: once, in the shell that stays while pages change. */
export function Notices() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer = 0;
    const show = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setText(null), SHOWN_MS);
    };
    window.addEventListener(EVENT, show);
    return () => {
      window.removeEventListener(EVENT, show);
      window.clearTimeout(timer);
    };
  }, []);
  if (!text) return null;
  return (
    <div role="status" className="fixed right-4 bottom-4 z-50 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
      {text}
    </div>
  );
}
