import * as Sentry from '@sentry/browser';

const dsn = String(import.meta.env.VITE_SENTRY_DSN || '').trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: typeof __DND_APP_VERSION__ === 'string' ? `dnd-companion@${__DND_APP_VERSION__}` : undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.headers;
      }
      return event;
    },
  });
}

export function captureClientError(error, context = {}) {
  console.error(error);
  if (dsn) Sentry.captureException(error, { extra: context });
}
