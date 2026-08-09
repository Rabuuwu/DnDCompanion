import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { SESSION_KEY } from './config.js';

let cachedSession = null;

function parseSession(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function initializeSessionStore() {
  if (Capacitor.isNativePlatform()) {
    cachedSession = parseSession(await SecureStorage.get(SESSION_KEY));
    return;
  }
  cachedSession = parseSession(sessionStorage.getItem(SESSION_KEY));
  localStorage.removeItem(SESSION_KEY);
}

export function getStoredSession() {
  return cachedSession;
}

export function saveSession(session) {
  cachedSession = session;
  if (Capacitor.isNativePlatform()) {
    void SecureStorage.set(SESSION_KEY, session);
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

export function clearSession() {
  cachedSession = null;
  if (Capacitor.isNativePlatform()) {
    void SecureStorage.remove(SESSION_KEY);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
  localStorage.removeItem(SESSION_KEY);
}
