const Sentry = require('@sentry/node');

const enabled = Boolean(process.env.SENTRY_DSN);

if (enabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Math.max(0, Math.min(1, Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05))),
  });
}

function setupExpressMonitoring(app) {
  if (enabled) Sentry.setupExpressErrorHandler(app);
}

module.exports = { setupExpressMonitoring };
