"use client";

/**
 * Every keyboard shortcut of the verification screen, grouped, in a window over the page.
 * Opened from its button in the footer or with ?, closed with Esc, ?, its button or a click
 * outside it.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";

import { useI18n } from "../../../_ui/i18n";
import { Keyboard, X } from "../../../_ui/icons";

/** "Alt+↓ / Alt+↑" as keys: one cap per key, "+" between keys, "/" between alternatives. */
function Combo({ combo }: { combo: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {combo.split(" / ").map((alt, i) => (
        <span key={alt} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-slate-400">/</span>}
          {alt.split("+").map((k, j) => (
            <span key={`${k}-${j}`} className="inline-flex items-center gap-1">
              {j > 0 && <span className="text-[10px] text-slate-400">+</span>}
              <kbd className="min-w-6 rounded-md bg-white px-1.5 py-0.5 text-center font-mono text-[11px] font-medium text-slate-700 shadow-[0_1px_0_rgb(15_23_42/0.12)] ring-1 ring-slate-200">
                {k}
              </kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const m = t.verify;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="card w-full max-w-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            <Keyboard className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="shortcuts-title" className="font-semibold">
              {m.shortcutsTitle}
            </h2>
            <p className="text-xs text-slate-500">{m.shortcutsHint}</p>
          </div>
          <button ref={close} type="button" onClick={onClose} aria-label={m.close} className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {m.keyGroups.map((g) => (
            <section key={g.title}>
              <h3 className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{g.title}</h3>
              <dl className="mt-2 space-y-3">
                {g.keys.map(([combo, text]) => (
                  <div key={combo}>
                    <dt>
                      <Combo combo={combo} />
                    </dt>
                    <dd className="mt-1 text-xs text-slate-600">{text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="mt-5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          {m.keysNote}{" "}
          <Link href="/" className="underline">
            {t.common.switchTechnician}
          </Link>{" "}
          {m.keysSwitch}
        </p>
      </div>
    </div>
  );
}
