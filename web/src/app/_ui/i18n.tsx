"use client";

/**
 * The app's language in the browser: the texts of the language chosen (messages/), and the
 * switch that changes it. The choice is kept in a cookie, so that the server renders the next
 * page in it too (lang.ts).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { COOKIE_PATH } from "@/lib/base-path";

import { LANG_COOKIE, LANGS, type Lang } from "./lang";
import { en, type Messages } from "./messages/en";
import { es } from "./messages/es";

const MESSAGES: Record<Lang, Messages> = { en, es };

interface I18n {
  lang: Lang;
  t: Messages;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n>({ lang: "en", t: en, setLang: () => undefined });

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export function I18nProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setState] = useState<Lang>(initial);
  const setLang = useCallback((next: Lang) => {
    document.cookie = `${LANG_COOKIE}=${next}; path=${COOKIE_PATH}; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.lang = next;
    setState(next);
  }, []);
  const value = useMemo(() => ({ lang, t: MESSAGES[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** EN | ES, as a small segmented switch. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { lang, t, setLang } = useI18n();
  return (
    <div role="group" aria-label={t.language.label} className={`inline-flex rounded-full bg-white/80 p-0.5 text-xs font-medium ring-1 ring-slate-200 backdrop-blur ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          title={t.language[l]}
          className={`rounded-full px-2.5 py-1 uppercase transition ${lang === l ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
