/**
 * The app's languages and how one is chosen: the visitor's choice, kept in a cookie, or else
 * the browser's preference; English when neither says Spanish. Safe on the server and in the
 * browser, so that a page is rendered in the language it will be shown in.
 */
export const LANGS = ["en", "es"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_COOKIE = "civ_lang";

export function isLang(value: unknown): value is Lang {
  return (LANGS as readonly unknown[]).includes(value);
}

/** The language for a request: its cookie, else its Accept-Language header (Catalan reads Spanish). */
export function pickLang(cookie: string | undefined, acceptLanguage: string | null): Lang {
  if (isLang(cookie)) return cookie;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (tag === "es" || tag === "ca") return "es";
    if (tag === "en") return "en";
  }
  return "en";
}
