import { API_BASE, REQUEST_TIMEOUT_MS } from './config.js';
import { clearSession, getStoredSession, saveSession } from './session-store.js';

export function requestTimeout() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

export async function refreshSession() {
  const session = getStoredSession();
  if (!session?.refreshToken) {
    if (session) clearSession();
    return null;
  }
  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      cache: 'no-store',
      signal: requestTimeout(),
    });
    if (!response.ok) {
      clearSession();
      return null;
    }
    const refreshedSession = await response.json();
    saveSession(refreshedSession);
    return refreshedSession;
  } catch {
    return session;
  }
}

let refreshPromise = null;

export async function authenticatedFetch(path, options = {}) {
  let session = getStoredSession();
  if (!session?.token) throw new Error('session_expired');
  const send = (token) =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: requestTimeout(),
    });
  let response = await send(session.token);
  if (response.status !== 401) return response;
  refreshPromise ||= refreshSession().finally(() => {
    refreshPromise = null;
  });
  session = await refreshPromise;
  if (!session?.token) throw new Error('session_expired');
  return send(session.token);
}

export async function fetchAllPages(path, { pageSize = 100 } = {}) {
  const items = [];
  let offset = 0;
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await authenticatedFetch(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    if (!response.ok) return { response, items };
    items.push(...(await response.json()));
    if (response.headers.get('X-Has-More') !== 'true') return { response, items };
    const nextOffset = Number(response.headers.get('X-Next-Offset'));
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) return { response, items };
    offset = nextOffset;
  }
}
