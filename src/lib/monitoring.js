// Error monitoring (Sentry). Entirely optional: with no VITE_SENTRY_DSN the app
// behaves exactly as before and the Sentry code is never downloaded.
// The DSN comes only from the environment (Vercel / .env.local), never from git.

let sentry = null;

export async function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  try {
    sentry = await import("@sentry/react");
    sentry.init({
      dsn,
      release: import.meta.env.VITE_APP_RELEASE,
      environment: import.meta.env.VITE_APP_ENV || import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
    // Console helper to prove the pipeline works: window.pulseSentryTest()
    window.pulseSentryTest = () => sentry.captureException(new Error("Pulse Sentry test error"));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Monitoring failed to start:", e);
  }
}

export function reportError(error, context) {
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined);
}
