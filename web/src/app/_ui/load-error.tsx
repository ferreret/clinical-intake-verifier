"use client";

/**
 * A page's data that could not be loaded or refreshed: what happened, and whether the page is
 * trying again by itself. A failure that passes (no reply, the server failing) is retried by
 * the page's polling; any other waits for the technician.
 */
import { ApiError } from "./api";
import { useI18n } from "./i18n";

/** Worth trying again by itself: no reply, or the server failing. */
export function passing(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}

export function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <p role="alert" className="text-sm text-rose-700">
      {t.server(error.message)}
      {passing(error) && <span className="text-slate-500"> · {t.common.retrying}</span>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 font-medium underline underline-offset-2 hover:text-rose-900">
          {t.common.tryAgain}
        </button>
      )}
    </p>
  );
}
