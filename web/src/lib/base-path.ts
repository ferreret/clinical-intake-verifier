/**
 * The path the app is served under, when it shares an address with other apps
 * (`https://demos.example.dev/<path>/`): set at build time by BASE_PATH (next.config.ts), so
 * one image serves one path. Next.js adds it to links and navigation; what the app asks for
 * by address itself (the API, page images, illustrations) and its cookies need it here.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** An address of the app's own, under its path. */
export const withBase = (pathname: string) => `${BASE_PATH}${pathname}`;

/** The app's cookies stay within its path, apart from other apps on the same address. */
export const COOKIE_PATH = BASE_PATH || "/";
