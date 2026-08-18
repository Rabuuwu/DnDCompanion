export const DEFAULT_API_BASE = 'https://dndcompanion-api.onrender.com';
const configuredApiBase = import.meta.env.VITE_API_BASE || window.__API_BASE__;
export const API_BASE = String(
  configuredApiBase || (import.meta.env.DEV ? window.location.origin : DEFAULT_API_BASE),
).replace(/\/$/, '');
export const SESSION_KEY = 'dnd-mobile-session';
export const WEB_APP_VERSION = typeof __DND_APP_VERSION__ === 'string' ? __DND_APP_VERSION__ : 'dev';
export const PWA_BASE = import.meta.env.BASE_URL;
export const REQUEST_TIMEOUT_MS = 8_000;
