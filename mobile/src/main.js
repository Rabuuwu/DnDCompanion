import './style.css';
import './styles/chat.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { LocalNotifications } from '@capacitor/local-notifications';
import { API_BASE, PWA_BASE, WEB_APP_VERSION } from './config.js';
import { clearSession, getStoredSession, initializeSessionStore, saveSession } from './session-store.js';
import { authenticatedFetch, fetchAllPages, refreshSession, requestTimeout } from './api-client.js';
import {
  CHARACTER_ATTRIBUTES,
  CHARACTER_AUXILIARY,
  CHARACTER_COMBAT,
  CHARACTER_FEATURES,
  CHARACTER_SKILL_GROUPS,
  CHARACTER_SPECIAL,
} from './character-schema.js';
import { automaticInventoryIcon, INVENTORY_ICON_KEYS, INVENTORY_ICONS } from './inventory-schema.js';
import { avatarMarkup, escapeHtml, formatFeatureText, prepareProfileImage } from './ui-utils.js';

const app = document.querySelector('#app');
let currentAppVersion = WEB_APP_VERSION;
let availableUpdate = null;
let deferredInstallPrompt = null;
let notificationPollTimer = null;
let notificationPollNow = null;
let notificationRouteHandler = null;
let pendingNotificationRoute = null;
let activeConversationFriendId = null;
let activeConversationRefresh = null;
let notificationPollInProgress = false;
let notificationStreamController = null;
let notificationStreamReconnectTimer = null;
let userUiPreferences = { collapsedSections: {} };
let uiPreferencesSaveTimer = null;
const REMINDER_KEY = 'dnd-update-reminder';
const NOTIFICATION_POLL_INTERVAL_MS = 5_000;
const NotificationSettings = registerPlugin('NotificationSettings');

function dispatchNotificationRoute(route) {
  if (!route?.type) return;
  if (notificationRouteHandler) {
    notificationRouteHandler(route);
  } else {
    pendingNotificationRoute = route;
  }
}

function notificationStateKey(userId) {
  return `dnd-notification-state-${userId}`;
}

function readNotificationState(userId) {
  try {
    const state = JSON.parse(localStorage.getItem(notificationStateKey(userId)) || '{}');
    return {
      messages: Array.isArray(state.messages) ? state.messages : [],
      invitations: Array.isArray(state.invitations) ? state.invitations : [],
      campaignContent: Array.isArray(state.campaignContent) ? state.campaignContent : [],
    };
  } catch {
    return { messages: [], invitations: [], campaignContent: [] };
  }
}

function saveNotificationState(userId, state) {
  localStorage.setItem(
    notificationStateKey(userId),
    JSON.stringify({
      messages: state.messages.slice(-200),
      invitations: state.invitations.slice(-200),
      campaignContent: state.campaignContent.slice(-200),
    }),
  );
}

function stopNotificationStream() {
  notificationStreamController?.abort();
  notificationStreamController = null;
  if (notificationStreamReconnectTimer) {
    window.clearTimeout(notificationStreamReconnectTimer);
    notificationStreamReconnectTimer = null;
  }
}

async function connectNotificationStream() {
  const session = getStoredSession();
  if (!session?.token || notificationStreamController) return;
  const controller = new AbortController();
  notificationStreamController = controller;

  try {
    const response = await fetch(`${API_BASE}/api/notifications/stream`, {
      headers: { Authorization: `Bearer ${session.token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 401) {
      await refreshSession();
      throw new Error('notification_stream_refresh');
    }
    if (!response.ok || !response.body) throw new Error('notification_stream_failed');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) {
        const dataLine = event.split(/\r?\n/).find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine.slice(5).trim());
          if (data.type) notificationPollNow?.();
        } catch {
          // Ignoruj niepełne zdarzenie i utrzymuj strumień.
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') console.error('Notification stream disconnected', error);
  } finally {
    if (notificationStreamController === controller) notificationStreamController = null;
    if (!controller.signal.aborted && getStoredSession()?.token) {
      notificationStreamReconnectTimer = window.setTimeout(connectNotificationStream, 2_000);
    }
  }
}

async function showSystemNotification({ id, title, body, route, avatar = '', campaignActions = false }) {
  if (Capacitor.isNativePlatform()) {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') {
      permission = await LocalNotifications.requestPermissions();
    }
    if (permission.display !== 'granted') return false;
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true },
          ...(campaignActions ? { actionTypeId: 'CAMPAIGN_INVITATION' } : {}),
          extra: route,
        },
      ],
    });
    return true;
  }

  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    icon: avatar || `${PWA_BASE}app-icon-192.png`,
    badge: `${PWA_BASE}app-icon-192.png`,
    tag: `${route.type}-${route.messageId || route.invitationId}`,
    renotify: false,
    data: route,
    actions: campaignActions
      ? [
          { action: 'accept', title: 'Dołącz' },
          { action: 'decline', title: 'Odrzuć' },
        ]
      : [],
  });
  return true;
}

function showInAppNotification({ id, title, body, route, avatar = '', campaignActions = false }) {
  if (document.visibilityState !== 'visible') return false;
  const toastId = `notification-${route.type}-${id}`;
  document.querySelector(`[data-in-app-notification="${toastId}"]`)?.remove();

  const toast = document.createElement('aside');
  toast.className = 'in-app-notification';
  toast.dataset.inAppNotification = toastId;
  toast.innerHTML = `
    <button type="button" aria-label="${escapeHtml(campaignActions ? 'Otwórz zaproszenie do kampanii' : route.type === 'message' ? `Otwórz rozmowę z ${title}` : 'Otwórz powiadomienie')}">
      ${avatarMarkup(avatar, title, 'notification-avatar')}
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(body)}</small>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  `;
  document.body.appendChild(toast);

  let closeTimer = window.setTimeout(() => toast.remove(), 8_000);
  toast.querySelector('button').addEventListener('click', () => {
    window.clearTimeout(closeTimer);
    toast.remove();
    dispatchNotificationRoute(route);
  });
  return true;
}

async function initializeNativeNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: 'CAMPAIGN_INVITATION',
        actions: [
          { id: 'accept', title: 'Dołącz' },
          { id: 'decline', title: 'Odrzuć', destructive: true },
        ],
      },
    ],
  });
  await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    dispatchNotificationRoute({
      ...(event.notification.extra || {}),
      action: event.actionId === 'tap' ? null : event.actionId,
    });
  });
}

initializeNativeNotifications().catch(console.error);

CapacitorApp.addListener('appStateChange', ({ isActive }) => {
  if (isActive) notificationPollNow?.();
}).catch(console.error);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') notificationPollNow?.();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'OPEN_NOTIFICATION') {
      dispatchNotificationRoute(event.data.route);
    }
  });
}

const initialNotificationParams = new URLSearchParams(window.location.search);
if (initialNotificationParams.has('notification')) {
  pendingNotificationRoute = {
    type: initialNotificationParams.get('notification'),
    friendId: Number(initialNotificationParams.get('friendId')) || undefined,
    username: initialNotificationParams.get('username') || undefined,
    invitationId: Number(initialNotificationParams.get('invitationId')) || undefined,
    notificationId: Number(initialNotificationParams.get('notificationId')) || undefined,
    campaignId: Number(initialNotificationParams.get('campaignId')) || undefined,
    campaignName: initialNotificationParams.get('campaignName') || undefined,
    inviterUsername: initialNotificationParams.get('inviterUsername') || undefined,
    action: initialNotificationParams.get('action') || undefined,
  };
  window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
}

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

async function installPwa() {
  if (isStandalonePwa()) {
    window.alert('Aplikacja PWA jest już zainstalowana.');
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  window.alert(
    isIos
      ? 'W Safari wybierz Udostępnij, a następnie „Dodaj do ekranu początkowego”.'
      : 'Otwórz menu przeglądarki i wybierz „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.',
  );
}

function bustCache(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(`${currentAppVersion}-${Date.now()}`)}`;
}

function parseVersion(version) {
  return String(version || '0')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function inventoryIconKey(item) {
  return INVENTORY_ICON_KEYS.has(item?.icon) ? item.icon : automaticInventoryIcon(item?.name) || 'backpack';
}

function inventoryIconMarkup(item) {
  const key = inventoryIconKey(item);
  const label = INVENTORY_ICONS.find(([iconKey]) => iconKey === key)?.[1] || 'Przedmiot';
  return `<img src="./img/${key}.png" alt="${escapeHtml(label)}" />`;
}

function inventoryIconPicker(selected = 'backpack') {
  const selectedKey = INVENTORY_ICON_KEYS.has(selected) ? selected : 'backpack';
  return `
    <fieldset class="inventory-icon-picker">
      <legend>Ikona przedmiotu</legend>
      <small>Dla rozpoznanych przedmiotów aplikacja wybierze ikonę automatycznie.</small>
      <div>
        ${INVENTORY_ICONS.map(
          ([key, label]) => `
          <label title="${escapeHtml(label)}">
            <input type="radio" name="icon" value="${key}" ${key === selectedKey ? 'checked' : ''} />
            <span><img src="./img/${key}.png" alt="" /></span>
            <small>${escapeHtml(label)}</small>
          </label>
        `,
        ).join('')}
      </div>
    </fieldset>
  `;
}

function inventoryDurationControl(duration = '') {
  const hasDuration = Boolean(String(duration || '').trim());
  return `
    <div class="inventory-duration-control${hasDuration ? ' has-duration' : ''}">
      <label>
        <input name="hasDuration" type="checkbox" ${hasDuration ? 'checked' : ''} />
        <span>Czas trwania</span>
      </label>
      <input
        name="duration"
        maxlength="100"
        value="${escapeHtml(duration)}"
        placeholder="Wpisz wartość"
        aria-label="Czas trwania"
        ${hasDuration ? '' : 'class="hidden" disabled'}
      />
    </div>
  `;
}

function parseInventory(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const iconMatch = line.match(/\s+\[icon=([a-z_]+)\]\s*$/i);
      const icon = INVENTORY_ICON_KEYS.has(iconMatch?.[1]) ? iconMatch[1] : '';
      const cleanLine = iconMatch ? line.slice(0, iconMatch.index).trim() : line;
      const durationMatch = cleanLine.match(/^(.*?)\s+⏱\s*(.+)$/u);
      const itemLine = durationMatch ? durationMatch[1].trim() : cleanLine;
      const duration = durationMatch ? durationMatch[2].trim().slice(0, 100) : '';
      const quantityMatch = itemLine.match(/^(.*?)\s+×\s*(\d+)$/u);
      if (!quantityMatch) return { name: itemLine, quantity: 1, duration, icon };
      return {
        name: quantityMatch[1].trim(),
        quantity: Math.max(1, Math.min(9999, Number(quantityMatch[2]) || 1)),
        duration,
        icon,
      };
    })
    .filter((item) => item.name);
}

function serializeInventory(items) {
  return items
    .map((item) => {
      const name = String(item.name || '').trim();
      const quantity = Math.max(1, Math.min(9999, Number(item.quantity) || 1));
      const duration = String(item.duration || '')
        .trim()
        .replace(/\r?\n/g, ' ')
        .slice(0, 100);
      const icon = INVENTORY_ICON_KEYS.has(item.icon) ? item.icon : '';
      return `${name} × ${quantity}${duration ? ` ⏱ ${duration}` : ''}${icon ? ` [icon=${icon}]` : ''}`;
    })
    .filter((line) => !line.startsWith(' × '))
    .join('\n')
    .slice(0, 10000);
}

async function loadUserUiPreferences() {
  userUiPreferences = { collapsedSections: {} };
  if (!getStoredSession()?.token) return;
  try {
    const response = await authenticatedFetch('/api/ui-preferences');
    if (!response.ok) return;
    const data = await response.json();
    const collapsedSections = data.settings?.collapsedSections;
    if (collapsedSections && typeof collapsedSections === 'object') {
      userUiPreferences.collapsedSections = { ...collapsedSections };
    }
  } catch {
    // Ustawienia interfejsu są synchronizowane w tle i nie blokują aplikacji.
  }
}

function scheduleUiPreferencesSave() {
  window.clearTimeout(uiPreferencesSaveTimer);
  uiPreferencesSaveTimer = window.setTimeout(async () => {
    if (!getStoredSession()?.token) return;
    try {
      await authenticatedFetch('/api/ui-preferences', {
        method: 'PUT',
        body: JSON.stringify({ settings: userUiPreferences }),
      });
    } catch {
      // Brak komunikatu celowo: zapis ustawień UI pozostaje niewidoczny dla użytkownika.
    }
  }, 350);
}

function bindUiSectionPreferences(root) {
  root?.querySelectorAll('details[data-ui-section]').forEach((details) => {
    details.addEventListener('toggle', () => {
      userUiPreferences.collapsedSections[details.dataset.uiSection] = !details.open;
      scheduleUiPreferencesSave();
    });
  });
}

let storedSession = getStoredSession();

function setUpdateBanner(message, { visible = true, showButton = false } = {}) {
  const text = document.querySelector('#update-banner-text');
  const button = document.querySelector('#update-now-btn');

  if (!text || !button) return;

  text.textContent = message;
  button.classList.toggle('hidden', !showButton);
  button.disabled = false;
}

function formatError(error) {
  if (!error) return 'Nieznany błąd';
  if (typeof error === 'string') return error;
  if (!navigator.onLine) return 'Brak połączenia z internetem';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 'Serwer nie odpowiedział w wymaganym czasie. Może się uruchamiać — spróbuj ponownie za chwilę';
  }
  if (error instanceof TypeError && /fetch|network|load/i.test(error.message || '')) {
    return 'Nie udało się połączyć z API. Sprawdź internet, konfigurację CORS lub stan serwera';
  }
  if (error.message) return error.message;
  return String(error);
}

function buildRequestError(endpoint, error) {
  const details = [
    `Endpoint: ${endpoint}`,
    `Błąd: ${formatError(error)}`,
    `Czas: ${new Date().toLocaleTimeString('pl-PL')}`,
  ];
  return details.join(' | ');
}

async function applyUpdateNow() {
  const bannerText = document.querySelector('#update-banner-text');
  const updateButton = document.querySelector('#update-now-btn');

  if (bannerText) bannerText.textContent = 'Pobieranie aktualizacji...';
  if (updateButton) updateButton.disabled = true;

  try {
    if (Capacitor.isNativePlatform()) {
      if (!availableUpdate?.url) throw new Error('Brak adresu pliku aktualizacji');
      if (bannerText) bannerText.textContent = 'Otwieram pobieranie aktualizacji…';
      await Browser.open({ url: availableUpdate.url });
      if (bannerText) {
        bannerText.textContent = 'Po pobraniu otwórz plik APK i potwierdź aktualizację.';
      }
      if (updateButton) updateButton.disabled = false;
      return;
    }

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
    }
  } catch (error) {
    if (bannerText) bannerText.textContent = `Nie udało się pobrać aktualizacji: ${error.message}`;
    if (updateButton) updateButton.disabled = false;
    return;
  }

  window.setTimeout(() => window.location.reload(), 800);
}

function renderApp(statusMessage = null) {
  stopNotificationStream();
  if (notificationPollTimer) {
    window.clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
  notificationPollNow = null;
  notificationRouteHandler = null;
  activeConversationFriendId = null;
  activeConversationRefresh = null;
  storedSession = getStoredSession();
  const safeUsername = escapeHtml(storedSession?.user?.username);
  document.body.classList.remove('standalone-content');
  document.body.classList.toggle('authenticated', Boolean(storedSession));
  app.innerHTML = `
    <main class="app-shell${storedSession ? ' authenticated-shell' : ''}">
      ${
        storedSession
          ? ''
          : `
      <div class="hero-band">
        <img class="brand-icon" src="./app-icon-192.png" alt="" />
        <div>
          <p class="eyebrow hero-tagline">Kampania w twojej kieszeni</p>
          <h1>D&amp;D Companion</h1>
        </div>
      </div>
      `
      }

      ${
        storedSession
          ? `
        <section class="app-main-screen">
          <header class="app-header">
            <div id="app-header-identity" class="header-identity">
              ${avatarMarkup(storedSession?.user?.avatar, storedSession?.user?.username, 'header-avatar')}
              <div>
                <p class="eyebrow">Witaj</p>
                <h2>${safeUsername}</h2>
              </div>
            </div>
            <div id="app-header-action"></div>
          </header>

          <section id="content-panel" class="panel-card">
            <div class="placeholder-panel">
              <h2>Lista postaci</h2>
              <p>Tu będzie lista Twoich postaci.</p>
            </div>
          </section>

          <section class="footer-nav">
            <button class="nav-item active" data-tab="characters" aria-label="Postacie" title="Postacie">
              <i class="nav-spartan-helmet" aria-hidden="true"></i>
              <span>Postacie</span>
            </button>
            <button class="nav-item" data-tab="friends" aria-label="Znajomi" title="Znajomi">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6" /><path d="M14 15c3.5-.5 5.8 1.2 7 4" /></svg>
              <span>Znajomi</span>
            </button>
            <button class="nav-item" data-tab="account" aria-label="Konto" title="Konto">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></svg>
              <span>Konto</span>
            </button>
          </section>
        </section>
      `
          : `
        <section class="auth-screen">
          <div class="auth-card compact">
            <div class="auth-switch">
              <button type="button" id="show-login" class="switch-pill active">Logowanie</button>
              <button type="button" id="show-register" class="switch-pill">Rejestracja</button>
            </div>

            <form id="login-form" class="auth-form active-form">
              <input id="login-username" name="username" type="text" placeholder="Nazwa użytkownika" value="${storedSession?.user?.username || ''}" autocomplete="username" required />
              <input id="login-password" name="password" type="password" placeholder="Hasło" autocomplete="current-password" required />
              <button type="submit" id="login-btn">Wejdź do aplikacji</button>
            </form>

            <form id="register-form" class="auth-form">
              <input id="register-username" name="username" type="text" placeholder="Nazwa użytkownika" autocomplete="username" required />
              <input id="register-password" name="password" type="password" placeholder="Hasło" autocomplete="new-password" required />
              <button type="submit" id="register-btn">Utwórz konto</button>
            </form>
            <p id="auth-message" class="form-error" role="alert"></p>

          </div>
        </section>
      `
      }

    </main>
  `;

  const loginForm = document.querySelector('#login-form');
  const registerForm = document.querySelector('#register-form');
  const loginUsernameInput = document.querySelector('#login-username');
  const loginPasswordInput = document.querySelector('#login-password');
  const registerUsernameInput = document.querySelector('#register-username');
  const registerPasswordInput = document.querySelector('#register-password');
  const loginBtn = document.querySelector('#login-btn');
  const registerBtn = document.querySelector('#register-btn');
  const authMessage = document.querySelector('#auth-message');
  const showLoginBtn = document.querySelector('#show-login');
  const showRegisterBtn = document.querySelector('#show-register');
  const navItems = Array.from(document.querySelectorAll('.nav-item'));

  if (showLoginBtn && showRegisterBtn) {
    showLoginBtn.classList.add('active');
    showRegisterBtn.classList.remove('active');
  }

  function setBusy(isBusy, button) {
    const targetButton = button || loginBtn;
    targetButton.disabled = isBusy;
    targetButton.textContent = isBusy ? 'Trwa...' : targetButton.dataset.defaultText || targetButton.textContent;
  }

  function switchForm(mode) {
    if (mode === 'register') {
      loginForm.classList.remove('active-form');
      registerForm.classList.add('active-form');
      showLoginBtn.classList.remove('active');
      showRegisterBtn.classList.add('active');
    } else {
      registerForm.classList.remove('active-form');
      loginForm.classList.add('active-form');
      showRegisterBtn.classList.remove('active');
      showLoginBtn.classList.add('active');
    }
  }

  async function handleAuthRequest(event, endpoint, payload, button, successMessage, errorMessage) {
    event.preventDefault();
    setBusy(true, button);
    if (authMessage) authMessage.textContent = '';

    try {
      const requestUrl = `${API_BASE}${endpoint}`;
      const response = await fetch(bustCache(requestUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: requestTimeout(),
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.error || errorMessage);
      }

      const session = {
        token: data.token,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        user: data.user,
      };

      saveSession(session);
      if (button === loginBtn) loginPasswordInput.value = '';
      if (button === registerBtn) registerPasswordInput.value = '';
      await loadUserUiPreferences();
      renderApp();
    } catch (error) {
      const requestUrl = `${API_BASE}${endpoint}`;
      if (authMessage) {
        authMessage.textContent = `${errorMessage}: ${buildRequestError(requestUrl, error)}`;
      }
    } finally {
      setBusy(false, button);
    }
  }

  async function handleLogin(event) {
    await handleAuthRequest(
      event,
      '/api/auth/login',
      { username: loginUsernameInput.value, password: loginPasswordInput.value },
      loginBtn,
      (username) => `Zalogowano jako ${username}`,
      'Błąd logowania',
    );
  }

  async function handleRegister(event) {
    await handleAuthRequest(
      event,
      '/api/auth/register',
      { username: registerUsernameInput.value, password: registerPasswordInput.value },
      registerBtn,
      (username) => `Konto utworzone dla ${username}`,
      'Błąd rejestracji',
    );
  }

  async function handleLogout() {
    const session = getStoredSession();
    try {
      if (session?.refreshToken) {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
          cache: 'no-store',
          signal: requestTimeout(),
        });
      }
    } finally {
      clearSession();
      userUiPreferences = { collapsedSections: {} };
      renderApp('Wylogowano');
    }
  }

  async function openNotificationSettings() {
    if (!Capacitor.isNativePlatform()) {
      if (!('Notification' in window)) {
        window.alert('Ta przeglądarka nie obsługuje powiadomień webowych.');
        return;
      }
      if (Notification.permission === 'granted') {
        window.alert('Powiadomienia dla PWA są włączone. Możesz nimi zarządzać w ustawieniach witryny w przeglądarce.');
        return;
      }
      if (Notification.permission === 'denied') {
        window.alert('Powiadomienia są zablokowane. Włącz je w ustawieniach tej witryny w przeglądarce.');
        return;
      }
      const permission = await Notification.requestPermission();
      window.alert(
        permission === 'granted' ? 'Powiadomienia dla PWA zostały włączone.' : 'Nie udzielono zgody na powiadomienia.',
      );
      return;
    }

    try {
      const permission = await LocalNotifications.requestPermissions();
      if (permission.display === 'granted') {
        window.alert('Powiadomienia dla aplikacji są włączone.');
        await pollNotifications();
        return;
      }
      await NotificationSettings.open();
    } catch {
      window.alert(
        Capacitor.getPlatform() === 'ios'
          ? 'Ustawienia powiadomień będą dostępne po przygotowaniu natywnej wersji iOS.'
          : 'Nie udało się otworzyć ustawień powiadomień.',
      );
    }
  }

  async function pollNotifications() {
    const session = getStoredSession();
    if (!session?.user?.id || notificationPollInProgress) return;
    notificationPollInProgress = true;

    try {
      const response = await authenticatedFetch('/api/notifications');
      if (!response.ok) return;
      const notifications = await response.json();
      const state = readNotificationState(session.user.id);
      const knownMessages = new Set(state.messages);
      const knownInvitations = new Set(state.invitations);
      const knownCampaignContent = new Set(state.campaignContent);
      let activeConversationUpdated = false;

      for (const message of notifications.messages || []) {
        if (knownMessages.has(message.id)) continue;
        if (activeConversationFriendId === message.sender.id) {
          if (!activeConversationUpdated && activeConversationRefresh) {
            await activeConversationRefresh();
            activeConversationUpdated = true;
          }
          state.messages.push(message.id);
          knownMessages.add(message.id);
          continue;
        }
        const notification = {
          id: message.id,
          title: message.sender.nickname || message.sender.username,
          body: message.body.length > 160 ? `${message.body.slice(0, 157)}…` : message.body,
          route: {
            type: 'message',
            messageId: message.id,
            friendId: message.sender.id,
            username: message.sender.username,
            avatar: message.sender.avatar,
          },
          avatar: message.sender.avatar,
        };
        const shownInApp = showInAppNotification(notification);
        const shownSystem = await showSystemNotification(notification);
        if (shownInApp || shownSystem) {
          state.messages.push(message.id);
          knownMessages.add(message.id);
        }
      }

      for (const invitation of notifications.campaignInvitations || []) {
        if (knownInvitations.has(invitation.id)) continue;
        const notification = {
          id: 1_000_000_000 + invitation.id,
          title: 'Zaproszenie do kampanii',
          body: `${invitation.inviter.username} zaprasza Cię do kampanii „${invitation.campaign.name}”.`,
          route: {
            type: 'campaign',
            invitationId: invitation.id,
            campaignName: invitation.campaign.name,
            inviterUsername: invitation.inviter.username,
            inviterAvatar: invitation.inviter.avatar,
          },
          avatar: invitation.inviter.avatar,
          campaignActions: true,
        };
        const shownInApp = showInAppNotification(notification);
        const shownSystem = await showSystemNotification(notification);
        if (shownInApp || shownSystem) {
          state.invitations.push(invitation.id);
          knownInvitations.add(invitation.id);
        }
      }

      for (const item of notifications.campaignContent || []) {
        if (knownCampaignContent.has(item.id)) continue;
        const notification = {
          id: 1_500_000_000 + item.id,
          title: item.type === 'campaign_secret' ? 'Odkryto nową informację' : 'Nowy materiał kampanii',
          body: `${item.campaign.name}: ${item.title}`,
          route: {
            type: 'campaign_content',
            notificationId: item.id,
            campaignId: item.campaign.id,
            campaignName: item.campaign.name,
          },
        };
        const shownInApp = showInAppNotification(notification);
        const shownSystem = await showSystemNotification(notification);
        if (shownInApp || shownSystem) {
          state.campaignContent.push(item.id);
          knownCampaignContent.add(item.id);
        }
      }

      saveNotificationState(session.user.id, state);
    } catch (error) {
      if (error.message !== 'session_expired') console.error('Notification polling failed', error);
    } finally {
      notificationPollInProgress = false;
    }
  }

  function startNotificationPolling() {
    if (notificationPollTimer) window.clearInterval(notificationPollTimer);
    if (!storedSession) return;
    notificationPollNow = pollNotifications;
    pollNotifications();
    notificationPollTimer = window.setInterval(pollNotifications, NOTIFICATION_POLL_INTERVAL_MS);
    connectNotificationStream();
  }

  async function chooseOwnCharacter(title = 'Wybierz postać') {
    const response = await authenticatedFetch('/api/characters');
    if (!response.ok) throw new Error('characters_load_failed');
    const characters = await response.json();
    if (!characters.length) {
      window.alert('Najpierw utwórz postać, którą możesz dołączyć do kampanii.');
      return null;
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'choice-dialog-backdrop';
      overlay.innerHTML = `
        <form class="choice-dialog">
          <h3>${escapeHtml(title)}</h3>
          <label>
            <span>Postać</span>
            <select name="characterId" required>
              ${characters
                .map(
                  (character) => `
                <option value="${character.id}">${escapeHtml(character.name)} — ${escapeHtml(character.race)}, poziom ${character.level}</option>
              `,
                )
                .join('')}
            </select>
          </label>
          <div>
            <button type="submit">Wybierz</button>
            <button type="button" class="secondary" data-cancel-character-choice>Anuluj</button>
          </div>
        </form>
      `;
      document.body.appendChild(overlay);
      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        finish(Number(new FormData(event.currentTarget).get('characterId')));
      });
      overlay.querySelector('[data-cancel-character-choice]').addEventListener('click', () => finish(null));
    });
  }

  async function respondToCampaignInvitation(invitationId, action, campaignName = '') {
    let characterId = null;
    if (action === 'accept') {
      characterId = await chooseOwnCharacter(`Którą postacią dołączasz do „${campaignName}”?`);
      if (!characterId) return false;
    }
    const response = await authenticatedFetch(`/api/campaign-invitations/${invitationId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action, ...(characterId ? { characterId } : {}) }),
    });
    if (!response.ok && response.status !== 404) throw new Error('invitation_response_failed');
    return true;
  }

  async function renderCharacters() {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;

    contentPanel.innerHTML = `
      <div class="characters-screen">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Twoja biblioteka</p>
            <h2>Postaci</h2>
          </div>
          <button id="new-character-btn" class="small">Dodaj postać</button>
        </div>
        <div id="character-editor"></div>
        <div id="characters-list" class="characters-list">
          <p>Ładowanie postaci...</p>
        </div>
      </div>
    `;

    const list = document.querySelector('#characters-list');
    let editor = document.querySelector('#character-editor');

    const fieldValue = (value, fallback = '') => escapeHtml(String(value ?? fallback));
    const combatAttribute = (key, value) => {
      const number = Number.parseInt(value, 10) || 0;
      return key === 'charisma' || number <= 0 ? number : Math.floor(number / 2);
    };
    const scaledAuxiliaryAttribute = (value, divisor) => {
      const number = Number.parseInt(value, 10) || 0;
      return number <= 0 ? number : Math.max(1, Math.floor(number / divisor));
    };
    const auxiliaryValues = (attributeValues) => ({
      reflex: scaledAuxiliaryAttribute(attributeValues.dexterity, 1),
      intuition: scaledAuxiliaryAttribute(attributeValues.intelligence, 2),
      arcana: scaledAuxiliaryAttribute(attributeValues.wisdom, 4),
      perception: scaledAuxiliaryAttribute(attributeValues.intelligence, 2),
    });
    const section = (title, content, open = false, uiKey = '') => {
      const hasSavedState = uiKey && Object.prototype.hasOwnProperty.call(userUiPreferences.collapsedSections, uiKey);
      const isOpen = hasSavedState ? !userUiPreferences.collapsedSections[uiKey] : open;
      return `
      <details class="character-section" ${uiKey ? `data-ui-section="${uiKey}"` : ''} ${isOpen ? 'open' : ''}>
        <summary>${title}</summary>
        <div class="character-section-content">${content}</div>
      </details>
    `;
    };
    const rangedAttributeOptions = (selected = 'strength') =>
      CHARACTER_ATTRIBUTES.map(
        ([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${label}</option>`,
      ).join('');
    const rangedFormulaTermRow = (term = {}) => {
      const type = ['percent', 'fraction', 'flat'].includes(term.type) ? term.type : 'percent';
      return `
        <div class="ranged-formula-term" data-ranged-formula-term>
          <select data-formula-field="type" aria-label="Rodzaj członu wzoru">
            <option value="percent" ${type === 'percent' ? 'selected' : ''}>Procent statystyki</option>
            <option value="fraction" ${type === 'fraction' ? 'selected' : ''}>Ułamek statystyki</option>
            <option value="flat" ${type === 'flat' ? 'selected' : ''}>Stała liczba</option>
          </select>
          ${
            type === 'percent'
              ? `
            <input data-formula-field="value" type="number" min="-1000" max="1000" value="${fieldValue(term.value, 100)}" aria-label="Procent" />
            <span>%</span>
            <select data-formula-field="attribute" aria-label="Statystyka">${rangedAttributeOptions(term.attribute)}</select>
          `
              : type === 'fraction'
                ? `
            <input data-formula-field="numerator" type="number" min="-100" max="100" value="${fieldValue(term.numerator, 1)}" aria-label="Licznik" />
            <span>/</span>
            <input data-formula-field="denominator" type="number" min="1" max="100" value="${fieldValue(term.denominator, 2)}" aria-label="Mianownik" />
            <select data-formula-field="attribute" aria-label="Statystyka">${rangedAttributeOptions(term.attribute)}</select>
          `
                : `
            <input data-formula-field="value" type="number" min="-99999" max="99999" value="${fieldValue(term.value, 0)}" aria-label="Stała wartość" />
          `
          }
          <button type="button" class="icon-button delete" data-remove-formula-term aria-label="Usuń człon wzoru" title="Usuń człon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M5 7l1 13h12l1-13" /><path d="M9 7V4h6v3" />
            </svg>
          </button>
        </div>
      `;
    };
    const rangedFormulaTermValue = (row) => {
      const field = (name) => row.querySelector(`[data-formula-field="${name}"]`)?.value;
      const type = field('type') || 'flat';
      if (type === 'percent') {
        return { type, value: Number(field('value')), attribute: field('attribute') };
      }
      if (type === 'fraction') {
        return {
          type,
          numerator: Number(field('numerator')),
          denominator: Number(field('denominator')),
          attribute: field('attribute'),
        };
      }
      return { type: 'flat', value: Number(field('value')) };
    };
    const defaultAuxiliaryFormulaTerms = {
      reflex: [{ type: 'percent', value: 100, attribute: 'dexterity' }],
      intuition: [{ type: 'percent', value: 50, attribute: 'intelligence' }],
      arcana: [{ type: 'percent', value: 25, attribute: 'wisdom' }],
      perception: [{ type: 'percent', value: 50, attribute: 'intelligence' }],
    };
    const storedFormulaTerms = (stat, fallback = []) => {
      if (Array.isArray(stat?.formulaTerms) && stat.formulaTerms.length) return stat.formulaTerms;
      const legacyValue = Number(stat?.value);
      return Number.isFinite(legacyValue) && String(stat?.value ?? '').trim()
        ? [{ type: 'flat', value: legacyValue }]
        : fallback;
    };
    const statFormulaBuilder = (scope, key, stat, fallback = []) => {
      const terms = storedFormulaTerms(stat, fallback);
      return `
        <div class="ranged-formula-builder stat-formula-builder" data-stat-formula-builder="${scope}-${key}">
          <div>
            <strong>Wzór</strong>
            ${stat?.formula && !stat?.formulaTerms?.length ? `<small>Poprzedni opis: ${escapeHtml(stat.formula)}</small>` : '<small>Wynik przelicza się automatycznie ze statystyk głównych.</small>'}
          </div>
          <div class="ranged-formula-list" data-ranged-formula-list>
            ${terms.map(rangedFormulaTermRow).join('')}
          </div>
          <button type="button" class="secondary small" data-add-formula-term>Dodaj człon wzoru</button>
        </div>
      `;
    };
    const evaluateFormulaTerms = (terms, attributes) =>
      Math.trunc(
        terms.reduce((sum, term) => {
          if (term.type === 'flat') return sum + (Number(term.value) || 0);
          const base = Number(attributes[term.attribute]) || 0;
          if (base < 0) return sum + base;
          const scaled =
            term.type === 'percent'
              ? (base * (Number(term.value) || 0)) / 100
              : (base * (Number(term.numerator) || 0)) / Math.max(1, Number(term.denominator) || 1);
          return sum + (scaled > 0 ? Math.max(1, scaled) : scaled);
        }, 0),
      );
    const formulaTermsText = (terms = []) =>
      terms
        .map((term) => {
          const attribute = CHARACTER_ATTRIBUTES.find(([key]) => key === term.attribute)?.[1] || 'Statystyka';
          if (term.type === 'percent') return `${Number(term.value) || 0}% ${attribute}`;
          if (term.type === 'fraction') {
            return `${Number(term.numerator) || 0}/${Math.max(1, Number(term.denominator) || 1)} ${attribute}`;
          }
          return String(Number(term.value) || 0);
        })
        .join(' + ')
        .replace(/\+ -/g, '− ');
    const featureRow = (type, item = {}) => `
      <div class="feature-editor-row" data-feature-row="${type}">
        <div class="feature-editor-heading">
          <button type="button" class="feature-drag-handle" data-feature-drag-handle aria-label="Zmień kolejność wpisu" title="Przeciągnij, aby zmienić kolejność">⠿</button>
          <input data-feature-field="name" maxlength="100" placeholder="Nazwa" value="${fieldValue(item.name)}" />
        </div>
        <textarea data-feature-field="description" maxlength="1000" rows="3" placeholder="Opis działania">${fieldValue(item.description)}</textarea>
        <div class="feature-timing-fields">
          ${
            type === 'campActions'
              ? `
            <label>
              <span>Czas trwania</span>
              <input data-feature-field="duration" maxlength="100" placeholder="np. 2 godziny" value="${fieldValue(item.duration)}" required />
            </label>
          `
              : ''
          }
          <label>
            <span>Cooldown (CD)</span>
            <input data-feature-field="cooldown" maxlength="100" placeholder="np. 3 tury lub raz na dzień" value="${fieldValue(item.cooldown)}" />
          </label>
        </div>
        ${
          type === 'abilities'
            ? `
          <div class="ranged-spell-editor">
            <label class="ranged-spell-toggle">
              <input data-feature-field="ranged" type="checkbox" ${item.ranged ? 'checked' : ''} />
              <span>Spell zasięgowy</span>
            </label>
            <div class="ranged-spell-fields${item.ranged ? '' : ' hidden'}" data-ranged-spell-fields>
              <label>
                <span>Zasięg spella</span>
                <input data-feature-field="range" maxlength="100" placeholder="np. 20 metrów" value="${fieldValue(item.range)}" ${item.ranged ? 'required' : 'disabled'} />
              </label>
              <div class="ranged-formula-builder">
                <div>
                  <strong>Wzór</strong>
                  <small>Dodaj kilka członów, np. 50% Siły + 1/3 Kondycji + 15.</small>
                </div>
                <div class="ranged-formula-list" data-ranged-formula-list>
                  ${(item.formulaTerms || []).map(rangedFormulaTermRow).join('')}
                </div>
                <button type="button" class="secondary small" data-add-formula-term>Dodaj człon wzoru</button>
              </div>
            </div>
          </div>
        `
            : ''
        }
        <div class="feature-editor-actions">
          ${
            type === 'abilities'
              ? `
            <label class="tooth-cost-input">
              <span>Koszt</span>
              <input data-feature-field="toothCost" type="number" min="0" max="999" value="${fieldValue(item.toothCost, 0)}" />
              <span aria-hidden="true">⚙</span>
            </label>
          `
              : ''
          }
          <button type="button" class="icon-button delete" data-remove-feature aria-label="Usuń wpis" title="Usuń">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M5 7l1 13h12l1-13" />
              <path d="M9 7V4h6v3" />
            </svg>
          </button>
        </div>
      </div>
    `;
    const guildRow = (guild = {}) => `
      <div class="guild-editor-row" data-guild-row>
        <label class="guild-name-field">
          <span>Nazwa gildii</span>
          <input data-guild-field="name" maxlength="100" placeholder="np. Gildia Magów" value="${fieldValue(guild.name)}" required />
        </label>
        <label>
          <span>Ranga</span>
          <input data-guild-field="rank" maxlength="50" placeholder="np. Adept" value="${fieldValue(guild.rank)}" />
        </label>
        <label>
          <span>Profesja gildii</span>
          <input data-guild-field="profession" maxlength="100" placeholder="np. Alchemik" value="${fieldValue(guild.profession)}" />
        </label>
        <button type="button" class="danger small" data-remove-guild>Usuń</button>
      </div>
    `;
    const customSkillRow = (group, item = {}) => `
      <div class="custom-skill-row" data-custom-skill-row data-custom-skill-group="${group}">
        <label>
          <span>Nazwa podstatystyki</span>
          <input data-custom-skill-field="name" maxlength="100" placeholder="np. Kowalstwo" value="${fieldValue(item.name)}" required />
        </label>
        <label>
          <span>Wartość (%)</span>
          <input data-custom-skill-field="percent" type="number" min="0" max="1000" value="${fieldValue(item.percent, 100)}" required />
        </label>
        <button type="button" class="icon-button delete" data-remove-custom-skill aria-label="Usuń podstatystykę" title="Usuń">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M5 7l1 13h12l1-13" />
            <path d="M9 7V4h6v3" />
          </svg>
        </button>
      </div>
    `;
    const resizeFeatureDescription = (textarea) => {
      if (!textarea?.matches('[data-feature-field="description"]')) return;
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };

    function showEditor(character = null) {
      const appHeader = document.querySelector('.app-header');
      const footerNav = document.querySelector('.footer-nav');
      let characterAvatar = character?.avatar || '';

      appHeader?.classList.add('hidden');
      footerNav?.classList.add('hidden');
      contentPanel.innerHTML = '<div id="character-editor" class="character-editor-standalone"></div>';
      editor = contentPanel.querySelector('#character-editor');

      const leaveEditor = () => {
        appHeader?.classList.remove('hidden');
        footerNav?.classList.remove('hidden');
      };

      const attributes = CHARACTER_ATTRIBUTES.map(([key, label]) => {
        const adventure = character?.attributes?.[key]?.adventure ?? 0;
        return `
          <label class="stat-input">
            <span>${label}</span>
            <input name="attribute-${key}" type="number" min="-100" max="1000" value="${fieldValue(adventure, 0)}" />
            <small>Walka: <strong data-combat-preview="${key}">${combatAttribute(key, adventure)}</strong></small>
          </label>
        `;
      }).join('');
      const combat = CHARACTER_COMBAT.map(
        ([key, label]) => `
        <div class="formula-row${key === 'initiative' ? ' value-only' : ''}">
          <label><span>${label}</span><input name="combat-${key}-value" data-formula-result="combat-${key}" placeholder="Wartość" value="${fieldValue(character?.combat?.[key]?.value, 0)}" ${key === 'initiative' ? '' : 'readonly'} /></label>
          ${
            key === 'initiative'
              ? ''
              : `
            ${statFormulaBuilder('combat', key, character?.combat?.[key])}
          `
          }
        </div>
      `,
      ).join('');
      const currentAttributeValues = Object.fromEntries(
        CHARACTER_ATTRIBUTES.map(([key]) => [key, character?.attributes?.[key]?.adventure ?? 0]),
      );
      const calculatedCurrentAuxiliary = auxiliaryValues(currentAttributeValues);
      const currentAuxiliary = Object.fromEntries(
        CHARACTER_AUXILIARY.map(([key]) => [
          key,
          character?.auxiliary?.[key]?.value ?? calculatedCurrentAuxiliary[key],
        ]),
      );
      const auxiliary = CHARACTER_AUXILIARY.map(
        ([key, label]) => `
        <div class="auxiliary-preview">
          <label class="auxiliary-value" for="auxiliary-${key}">
            <span>${label}</span>
            <input id="auxiliary-${key}" name="auxiliary-${key}" data-auxiliary-preview="${key}" data-formula-result="auxiliary-${key}" type="number" min="-99999" max="99999" value="${fieldValue(currentAuxiliary[key], calculatedCurrentAuxiliary[key])}" readonly />
          </label>
          ${statFormulaBuilder('auxiliary', key, character?.auxiliary?.[key], defaultAuxiliaryFormulaTerms[key])}
        </div>
      `,
      ).join('');
      const skills = CHARACTER_SKILL_GROUPS.map(
        ([group, entries, groupKey]) => `
        <div class="skill-group">
          <h4>${group}</h4>
          ${entries
            .map(
              ([key, label]) => `
            <div class="skill-row">
              <label><span>${label}</span><input name="skill-${key}-percent" type="number" min="0" max="1000" value="${fieldValue(character?.skills?.[key]?.percent, character ? 0 : 100)}" /></label>
              <span class="percent-mark">%</span>
              <input name="skill-${key}-note" placeholder="Notatka (opcjonalnie)" value="${fieldValue(character?.skills?.[key]?.note)}" />
            </div>
          `,
            )
            .join('')}
          <div class="custom-skill-list" data-custom-skill-list="${groupKey}">
            ${(character?.customSkills || [])
              .filter((item) => item.group === groupKey)
              .map((item) => customSkillRow(groupKey, item))
              .join('')}
          </div>
          <button type="button" class="secondary small" data-add-custom-skill="${groupKey}">Dodaj własną podstatystykę</button>
        </div>
      `,
      ).join('');
      const special = CHARACTER_SPECIAL.map(
        ([key, label]) => `
        <div class="special-row">
          <span>${label}</span>
          <input name="special-${key}-current" type="number" min="0" max="999" value="${fieldValue(character?.special?.[key]?.current, 0)}" aria-label="${label} obecnie" />
          <span>/</span>
          <input name="special-${key}-max" type="number" min="0" max="999" value="${fieldValue(character?.special?.[key]?.max, character ? 0 : 11)}" aria-label="${label} maksimum" />
        </div>
      `,
      ).join('');
      const features = CHARACTER_FEATURES.map(
        ([type, label, addLabel]) => `
        ${section(
          label,
          `
          <div class="feature-editor-list" data-feature-list="${type}">
            ${(character?.features?.[type] || []).map((item) => featureRow(type, item)).join('')}
          </div>
          <button type="button" class="secondary small" data-add-feature="${type}">${addLabel}</button>
        `,
          false,
          `editor.features.${type}`,
        )}
      `,
      ).join('');
      const characterGuilds =
        Array.isArray(character?.guilds) && character.guilds.length
          ? character.guilds
          : character?.guildRank
            ? [{ name: 'Dotychczasowa gildia', rank: character.guildRank }]
            : [];

      editor.innerHTML = `
        <form id="character-form" class="character-form">
          <h3>${character ? 'Edytuj postać' : 'Nowa postać'}</h3>
          ${section(
            'Dane podstawowe',
            `
            <div class="avatar-editor">
              <div id="character-avatar-preview">
                ${avatarMarkup(characterAvatar, character?.name || 'Postać', 'character-avatar')}
              </div>
              <div>
                <strong>Zdjęcie postaci</strong>
                <small>Wybierz zdjęcie z urządzenia. Zostanie automatycznie zmniejszone.</small>
                <div class="avatar-editor-actions">
                  <label class="button secondary small" for="character-avatar-input">Wybierz zdjęcie</label>
                  <input id="character-avatar-input" class="visually-hidden" type="file" accept="image/*" />
                  <button id="remove-character-avatar" class="secondary small${characterAvatar ? '' : ' hidden'}" type="button">Usuń zdjęcie</button>
                </div>
                <label class="character-motto-input">
                  <span>Motto postaci</span>
                  <input name="motto" maxlength="200" placeholder="np. Nigdy się nie poddawaj" value="${fieldValue(character?.motto)}" />
                </label>
              </div>
            </div>
            <div class="character-fields">
              <label><span>Imię</span><input name="name" maxlength="100" value="${fieldValue(character?.name)}" required /></label>
              <label><span>Rasa</span><input name="race" maxlength="100" value="${fieldValue(character?.race)}" required /></label>
              <label class="wide"><span>Klasa / klasy</span><input name="classes" maxlength="150" placeholder="np. kowal / paladyn" value="${fieldValue(character?.classes || character?.className)}" required /></label>
              <label><span>Wiek</span><input name="age" type="number" min="0" max="1000" value="${fieldValue(character?.age, 0)}" /></label>
              <label><span>Wzrost</span><input name="height" maxlength="30" placeholder="np. 1,85 m" value="${fieldValue(character?.height)}" /></label>
              <label><span>Waga</span><input name="weight" maxlength="30" placeholder="np. 80 kg" value="${fieldValue(character?.weight)}" /></label>
              <label><span>Poziom</span><input name="level" type="number" min="1" max="100" value="${fieldValue(character?.level, 1)}" required /></label>
              <label><span>Punkty</span><input name="points" type="number" value="${fieldValue(character?.points, 0)}" /></label>
              <label><span>Minimum punktów</span><input name="minimumPoints" type="number" value="${fieldValue(character?.minimumPoints, -10)}" /></label>
            </div>
          `,
            true,
            'editor.basic',
          )}
          ${section(
            'Gildie',
            `
            <div class="guild-editor-list" data-guild-list>
              ${characterGuilds.map((guild) => guildRow(guild)).join('')}
            </div>
            <button type="button" class="secondary small" data-add-guild>Dodaj gildię</button>
          `,
            true,
            'editor.guilds',
          )}
          ${section('Statystyki główne', `<p class="section-note">Wartość bojowa oblicza się automatycznie.</p><div class="attribute-grid">${attributes}</div>`, true, 'editor.stats.main')}
          ${section('Statystyki walki', combat, false, 'editor.stats.combat')}
          ${section('Statystyki pomocnicze', `<div class="auxiliary-grid">${auxiliary}</div>`, false, 'editor.stats.auxiliary')}
          ${section('Podstatystyki', skills, false, 'editor.stats.skills')}
          ${section('Rozwój specjalny', special, false, 'editor.stats.special')}
          ${features}
          <div class="form-actions">
            <button type="submit">${character ? 'Zapisz zmiany' : 'Utwórz postać'}</button>
            <button id="cancel-character-btn" type="button" class="secondary">Anuluj</button>
          </div>
          <p id="character-form-error" class="form-error"></p>
        </form>
      `;

      bindUiSectionPreferences(editor);

      document.querySelector('#cancel-character-btn')?.addEventListener('click', () => {
        leaveEditor();
        renderCharacters();
      });
      const characterAvatarInput = editor.querySelector('#character-avatar-input');
      const removeCharacterAvatar = editor.querySelector('#remove-character-avatar');
      characterAvatarInput?.addEventListener('change', async () => {
        const file = characterAvatarInput.files?.[0];
        if (!file) return;
        try {
          characterAvatar = await prepareProfileImage(file);
          editor.querySelector('#character-avatar-preview').innerHTML = avatarMarkup(
            characterAvatar,
            editor.querySelector('[name="name"]')?.value || character?.name || 'Postać',
            'character-avatar',
          );
          removeCharacterAvatar?.classList.remove('hidden');
        } catch {
          window.alert('Nie udało się wczytać zdjęcia. Wybierz plik graficzny o rozmiarze do 15 MB.');
        } finally {
          characterAvatarInput.value = '';
        }
      });
      removeCharacterAvatar?.addEventListener('click', () => {
        characterAvatar = '';
        editor.querySelector('#character-avatar-preview').innerHTML = avatarMarkup(
          '',
          editor.querySelector('[name="name"]')?.value || character?.name || 'Postać',
          'character-avatar',
        );
        removeCharacterAvatar.classList.add('hidden');
      });

      const recalculateStatFormulas = () => {
        const attributeValues = Object.fromEntries(
          CHARACTER_ATTRIBUTES.map(([attributeKey]) => [
            attributeKey,
            Number(editor.querySelector(`[name="attribute-${attributeKey}"]`)?.value) || 0,
          ]),
        );
        editor.querySelectorAll('[data-stat-formula-builder]').forEach((builder) => {
          const terms = [...builder.querySelectorAll('[data-ranged-formula-term]')].map(rangedFormulaTermValue);
          const output = editor.querySelector(`[data-formula-result="${builder.dataset.statFormulaBuilder}"]`);
          if (output) output.value = evaluateFormulaTerms(terms, attributeValues);
        });
      };

      CHARACTER_ATTRIBUTES.forEach(([key]) => {
        const input = document.querySelector(`[name="attribute-${key}"]`);
        input?.addEventListener('input', () => {
          const preview = document.querySelector(`[data-combat-preview="${key}"]`);
          if (preview) preview.textContent = combatAttribute(key, input.value);
          recalculateStatFormulas();
        });
      });

      editor.querySelectorAll('[data-add-feature]').forEach((button) => {
        button.addEventListener('click', () => {
          const type = button.dataset.addFeature;
          const featureList = editor.querySelector(`[data-feature-list="${type}"]`);
          featureList?.insertAdjacentHTML('beforeend', featureRow(type));
          resizeFeatureDescription(featureList?.lastElementChild?.querySelector('[data-feature-field="description"]'));
        });
      });
      editor.addEventListener('input', (event) => {
        resizeFeatureDescription(event.target);
        if (event.target.matches('[data-formula-field]')) recalculateStatFormulas();
      });
      editor.addEventListener('keydown', (event) => {
        const handle = event.target.closest('[data-feature-drag-handle]');
        if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const row = handle.closest('[data-feature-row]');
        const sibling = event.key === 'ArrowUp' ? row?.previousElementSibling : row?.nextElementSibling;
        if (!row || !sibling?.matches('[data-feature-row]')) return;
        event.preventDefault();
        if (event.key === 'ArrowUp') row.parentElement.insertBefore(row, sibling);
        else row.parentElement.insertBefore(sibling, row);
        handle.focus();
      });
      editor.addEventListener('pointerdown', (event) => {
        const handle = event.target.closest('[data-feature-drag-handle]');
        if (!handle || event.isPrimary === false) return;
        const draggedRow = handle.closest('[data-feature-row]');
        const featureList = draggedRow?.closest('[data-feature-list]');
        if (!draggedRow || !featureList) return;

        event.preventDefault();
        const originalNextSibling = draggedRow.nextElementSibling;
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          // Niektóre wersje iOS nie pozwalają przechwycić wskaźnika od razu.
        }
        draggedRow.classList.add('dragging');
        featureList.classList.add('reordering');

        const moveFeature = (moveEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return;
          moveEvent.preventDefault();
          const siblings = [...featureList.querySelectorAll(':scope > [data-feature-row]')].filter(
            (row) => row !== draggedRow,
          );
          const nextRow = siblings.find((row) => {
            const bounds = row.getBoundingClientRect();
            return moveEvent.clientY < bounds.top + bounds.height / 2;
          });
          if (nextRow) featureList.insertBefore(draggedRow, nextRow);
          else featureList.appendChild(draggedRow);

          const scrollBounds = contentPanel.getBoundingClientRect();
          const scrollEdge = Math.min(80, scrollBounds.height * 0.18);
          if (moveEvent.clientY < scrollBounds.top + scrollEdge) contentPanel.scrollBy({ top: -18 });
          else if (moveEvent.clientY > scrollBounds.bottom - scrollEdge) contentPanel.scrollBy({ top: 18 });
        };
        const cleanup = (finishEvent) => {
          window.removeEventListener('pointermove', moveFeature);
          window.removeEventListener('pointerup', finishFeatureReorder);
          window.removeEventListener('pointercancel', cancelFeatureReorder);
          if (handle.hasPointerCapture?.(finishEvent.pointerId)) handle.releasePointerCapture(finishEvent.pointerId);
          draggedRow.classList.remove('dragging');
          featureList.classList.remove('reordering');
        };
        const finishFeatureReorder = (finishEvent) => cleanup(finishEvent);
        const cancelFeatureReorder = (cancelEvent) => {
          cleanup(cancelEvent);
          if (originalNextSibling?.parentElement === featureList)
            featureList.insertBefore(draggedRow, originalNextSibling);
          else featureList.appendChild(draggedRow);
        };

        window.addEventListener('pointermove', moveFeature, { passive: false });
        window.addEventListener('pointerup', finishFeatureReorder);
        window.addEventListener('pointercancel', cancelFeatureReorder);
      });
      editor.addEventListener('change', (event) => {
        if (event.target.matches('[data-feature-field="ranged"]')) {
          const feature = event.target.closest('[data-feature-row="abilities"]');
          const fields = feature?.querySelector('[data-ranged-spell-fields]');
          const rangeInput = fields?.querySelector('[data-feature-field="range"]');
          fields?.classList.toggle('hidden', !event.target.checked);
          if (rangeInput) {
            rangeInput.disabled = !event.target.checked;
            rangeInput.required = event.target.checked;
          }
        }
        if (event.target.matches('[data-formula-field="type"]')) {
          const row = event.target.closest('[data-ranged-formula-term]');
          if (!row) return;
          const nextType = event.target.value;
          const attribute = row.querySelector('[data-formula-field="attribute"]')?.value || 'strength';
          const previousValue = Number(row.querySelector('[data-formula-field="value"]')?.value);
          const nextTerm =
            nextType === 'fraction'
              ? { type: nextType, numerator: 1, denominator: 2, attribute }
              : {
                  type: nextType,
                  value: Number.isFinite(previousValue) ? previousValue : nextType === 'percent' ? 100 : 0,
                  attribute,
                };
          row.insertAdjacentHTML('beforebegin', rangedFormulaTermRow(nextTerm));
          row.remove();
          recalculateStatFormulas();
        }
      });
      editor.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-feature]');
        if (removeButton) removeButton.closest('[data-feature-row]')?.remove();
        const removeGuildButton = event.target.closest('[data-remove-guild]');
        if (removeGuildButton) removeGuildButton.closest('[data-guild-row]')?.remove();
        const removeCustomSkillButton = event.target.closest('[data-remove-custom-skill]');
        if (removeCustomSkillButton) removeCustomSkillButton.closest('[data-custom-skill-row]')?.remove();
        const removeFormulaTerm = event.target.closest('[data-remove-formula-term]');
        if (removeFormulaTerm) {
          removeFormulaTerm.closest('[data-ranged-formula-term]')?.remove();
          recalculateStatFormulas();
        }
        const addFormulaTerm = event.target.closest('[data-add-formula-term]');
        if (addFormulaTerm) {
          addFormulaTerm
            .closest('.ranged-formula-builder')
            ?.querySelector('[data-ranged-formula-list]')
            ?.insertAdjacentHTML('beforeend', rangedFormulaTermRow());
          recalculateStatFormulas();
        }
      });
      editor.querySelector('[data-add-guild]')?.addEventListener('click', () => {
        editor.querySelector('[data-guild-list]')?.insertAdjacentHTML('beforeend', guildRow());
      });
      editor.querySelectorAll('[data-add-custom-skill]').forEach((button) => {
        button.addEventListener('click', () => {
          const group = button.dataset.addCustomSkill;
          editor
            .querySelector(`[data-custom-skill-list="${group}"]`)
            ?.insertAdjacentHTML('beforeend', customSkillRow(group));
        });
      });
      window.requestAnimationFrame(() => {
        editor.querySelectorAll('[data-feature-field="description"]').forEach(resizeFeatureDescription);
        recalculateStatFormulas();
      });

      document.querySelector('#character-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submitButton = form.querySelector('button[type="submit"]');
        const errorElement = form.querySelector('#character-form-error');
        const formData = new FormData(form);
        const payload = {
          name: formData.get('name'),
          avatar: characterAvatar,
          motto: formData.get('motto'),
          race: formData.get('race'),
          classes: formData.get('classes'),
          age: Number(formData.get('age')),
          height: formData.get('height'),
          weight: formData.get('weight'),
          level: Number(formData.get('level')),
          points: Number(formData.get('points')),
          minimumPoints: Number(formData.get('minimumPoints')),
          guilds: Array.from(form.querySelectorAll('[data-guild-row]')).map((row) => ({
            name: row.querySelector('[data-guild-field="name"]').value,
            rank: row.querySelector('[data-guild-field="rank"]').value,
            profession: row.querySelector('[data-guild-field="profession"]').value,
          })),
          inventory: character?.inventory || '',
          notebook: character?.notebook || { mode: 'text', text: '', strokes: [] },
          attributes: Object.fromEntries(
            CHARACTER_ATTRIBUTES.map(([key]) => [key, Number(formData.get(`attribute-${key}`))]),
          ),
          combat: Object.fromEntries(
            CHARACTER_COMBAT.map(([key]) => [
              key,
              {
                value: formData.get(`combat-${key}-value`),
                formula: '',
                formulaTerms:
                  key === 'initiative'
                    ? []
                    : [
                        ...form.querySelectorAll(
                          `[data-stat-formula-builder="combat-${key}"] [data-ranged-formula-term]`,
                        ),
                      ].map(rangedFormulaTermValue),
              },
            ]),
          ),
          auxiliary: Object.fromEntries(
            CHARACTER_AUXILIARY.map(([key]) => [
              key,
              {
                value: Number(formData.get(`auxiliary-${key}`)),
                formula: '',
                formulaTerms: [
                  ...form.querySelectorAll(`[data-stat-formula-builder="auxiliary-${key}"] [data-ranged-formula-term]`),
                ].map(rangedFormulaTermValue),
              },
            ]),
          ),
          skills: Object.fromEntries(
            CHARACTER_SKILL_GROUPS.flatMap(([, entries]) => entries).map(([key]) => [
              key,
              {
                percent: Number(formData.get(`skill-${key}-percent`)),
                note: formData.get(`skill-${key}-note`),
              },
            ]),
          ),
          customSkills: Array.from(form.querySelectorAll('[data-custom-skill-row]'))
            .map((row) => ({
              group: row.dataset.customSkillGroup,
              name: row.querySelector('[data-custom-skill-field="name"]').value,
              percent: Number(row.querySelector('[data-custom-skill-field="percent"]').value),
            }))
            .filter((item) => item.name.trim()),
          special: Object.fromEntries(
            CHARACTER_SPECIAL.map(([key]) => [
              key,
              {
                current: Number(formData.get(`special-${key}-current`)),
                max: Number(formData.get(`special-${key}-max`)),
              },
            ]),
          ),
          features: Object.fromEntries(
            CHARACTER_FEATURES.map(([type]) => [
              type,
              [...form.querySelectorAll(`[data-feature-row="${type}"]`)]
                .map((row) => ({
                  name: row.querySelector('[data-feature-field="name"]').value,
                  description: row.querySelector('[data-feature-field="description"]').value,
                  cooldown: row.querySelector('[data-feature-field="cooldown"]').value,
                  ...(type === 'campActions'
                    ? {
                        duration: row.querySelector('[data-feature-field="duration"]').value,
                      }
                    : {}),
                  ...(type === 'abilities'
                    ? {
                        toothCost: Number(row.querySelector('[data-feature-field="toothCost"]').value),
                        ranged: row.querySelector('[data-feature-field="ranged"]').checked,
                        range: row.querySelector('[data-feature-field="range"]').value,
                        formulaTerms: [...row.querySelectorAll('[data-ranged-formula-term]')].map(
                          rangedFormulaTermValue,
                        ),
                      }
                    : {}),
                }))
                .filter((item) => item.name.trim()),
            ]),
          ),
        };

        submitButton.disabled = true;
        errorElement.textContent = '';
        try {
          const path = character ? `/api/characters/${character.id}` : '/api/characters';
          const response = await authenticatedFetch(path, {
            method: character ? 'PUT' : 'POST',
            body: JSON.stringify(payload),
          });
          const data = response.status === 204 ? {} : await response.json();
          if (!response.ok) throw new Error(data.error || 'character_save_failed');
          leaveEditor();
          await renderCharacters();
        } catch (error) {
          errorElement.textContent =
            error.message === 'session_expired'
              ? 'Sesja wygasła. Zaloguj się ponownie.'
              : 'Nie udało się zapisać postaci.';
          submitButton.disabled = false;
        }
      });
    }

    function showCharacter(character) {
      document.querySelector('.character-footer-tabs')?.remove();
      const headerIdentity = document.querySelector('#app-header-identity');
      const headerAction = document.querySelector('#app-header-action');
      const footerNav = document.querySelector('.footer-nav');
      const attributeRows = CHARACTER_ATTRIBUTES.map(([key, label]) => {
        const stat = character.attributes?.[key] || { adventure: 0, combat: 0 };
        return `<div class="sheet-row"><span>${label}</span><strong>${stat.adventure} / ${stat.combat}</strong></div>`;
      }).join('');
      const formulaRows = (definitions, values) =>
        definitions
          .map(([key, label]) => {
            const stat = values?.[key] || {};
            const formula = stat.formulaTerms?.length ? formulaTermsText(stat.formulaTerms) : stat.formula;
            return `<div class="sheet-stat"><span>${label}</span><strong>${escapeHtml(stat.value || '—')}</strong>${key !== 'initiative' && formula ? `<small>${escapeHtml(formula)}</small>` : ''}</div>`;
          })
          .join('');
      const skillRows = CHARACTER_SKILL_GROUPS.map(
        ([group, entries, groupKey]) => `
        <div class="sheet-skill-group"><h4>${group}</h4>${entries
          .map(([key, label]) => {
            const skill = character.skills?.[key] || {};
            return `<div class="sheet-row"><span>${label}${skill.note ? ` <small>(${escapeHtml(skill.note)})</small>` : ''}</span><strong>${skill.percent ?? 0}% = ${skill.result ?? 0}</strong></div>`;
          })
          .join('')}${(character.customSkills || [])
          .filter((item) => item.group === groupKey)
          .map(
            (item) =>
              `<div class="sheet-row custom"><span>${escapeHtml(item.name)}</span><strong>${item.percent ?? 0}% = ${item.result ?? 0}</strong></div>`,
          )
          .join('')}</div>
      `,
      ).join('');
      const specialRows = CHARACTER_SPECIAL.map(([key, label]) => {
        const value = character.special?.[key] || {};
        return `<div class="sheet-row"><span>${label}</span><strong>${value.current ?? 0} / ${value.max ?? 0}</strong></div>`;
      }).join('');
      const featureLists = CHARACTER_FEATURES.map(([type, label]) => {
        const items = character.features?.[type] || [];
        const content = items.length
          ? `<div class="feature-sheet-list" data-feature-order-list="${type}">${items
              .map(
                (item, index) => `
              <article class="feature-sheet-item" data-feature-order-item="${index}">
                <div class="feature-sheet-heading">
                  <button type="button" class="feature-sheet-drag-handle" data-feature-sheet-drag aria-label="Zmień kolejność ${escapeHtml(item.name)}" title="Przeciągnij, aby zmienić kolejność">⠿</button>
                  <h4>${escapeHtml(item.name)}</h4>
                  ${type === 'abilities' ? `<strong>${Number(item.toothCost) || 0} ⏱️</strong>` : ''}
                </div>
                ${
                  item.duration || item.cooldown || item.ranged
                    ? `
                  <div class="feature-sheet-meta">
                    ${item.duration ? `<span>Czas trwania: <strong>${escapeHtml(item.duration)}</strong></span>` : ''}
                    ${item.cooldown ? `<span>Cooldown: <strong>${escapeHtml(item.cooldown)}</strong></span>` : ''}
                    ${item.ranged ? `<span>Zasięg: <strong>${escapeHtml(item.range || 'Nie podano')}</strong></span>` : ''}
                    ${item.ranged && item.formulaTerms?.length ? `<span class="wide">Wzór: <strong>${escapeHtml(formulaTermsText(item.formulaTerms))}</strong></span>` : ''}
                  </div>
                `
                    : ''
                }
                ${item.description ? `<div class="formatted-feature-description">${formatFeatureText(item.description)}</div>` : ''}
              </article>
            `,
              )
              .join('')}</div><p class="feature-order-status" data-feature-order-status="${type}" role="status"></p>`
          : '<p class="section-note">Brak wpisów.</p>';
        return section(label, content, true, `character.features.${type}`);
      }).join('');
      const guildRows = (character.guilds || []).length
        ? `<div class="character-guild-list">${character.guilds
            .map(
              (guild) => `
            <div class="character-guild">
              <span aria-hidden="true">🛡️</span>
              <div>
                <strong>${escapeHtml(guild.name)}</strong>
                <small>Ranga: ${escapeHtml(guild.rank || 'Bez rangi')}</small>
                ${guild.profession ? `<small>Profesja: ${escapeHtml(guild.profession)}</small>` : ''}
              </div>
            </div>
          `,
            )
            .join('')}</div>`
        : '<p class="section-note">Postać nie należy do żadnej gildii.</p>';

      if (headerIdentity) {
        headerIdentity.innerHTML = `
          ${avatarMarkup(character.avatar, character.name, 'header-avatar')}
          <div>
            <p class="eyebrow">Aktywna postać</p>
            <h2>${escapeHtml(character.name)} <span class="header-race">(${escapeHtml(character.race)})</span></h2>
          </div>
        `;
      }
      if (headerAction) {
        headerAction.innerHTML = '<button id="leave-character" class="secondary small">Wyjdź z postaci</button>';
      }
      if (footerNav) footerNav.classList.add('hidden');

      contentPanel.innerHTML = `
        <div class="character-dashboard">
          <nav class="character-tabs" aria-label="Karta postaci">
            <button class="character-tab active" data-character-tab="data" aria-label="Dane postaci" title="Dane postaci">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></svg>
              <span>Dane</span>
            </button>
            <button class="character-tab" data-character-tab="stats" aria-label="Statystyki" title="Statystyki">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10" /><path d="M12 20V4" /><path d="M19 20v-7" /></svg>
              <span>Statystyki</span>
            </button>
            <button class="character-tab" data-character-tab="features" aria-label="Umiejętności" title="Umiejętności">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" /><path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></svg>
              <span>Umiejętności</span>
            </button>
            <button class="character-tab" data-character-tab="inventory" aria-label="Ekwipunek" title="Ekwipunek">
              <svg viewBox="0 0 512 512" aria-hidden="true" class="inventory-backpack-icon"><path fill="currentColor" stroke="none" d="m186.438 20.56-13.184 26.365q10.202-.39 20.47-.686l3.84-7.68h116.874l3.77 7.54q10.258.281 20.456.66l-13.102-26.2H186.437zm69.56 42.742c-45.757.056-91.452 1.566-135.38 4.363-3.24 50.58-8.4 100.987-.786 145.824 89.297 12.395 180.102 12.985 272.764-.054 7.055-30.988 5.117-84.68-1.04-145.89-43.974-2.893-89.73-4.3-135.558-4.244zm153.783 5.54c6.42 64.12 9.113 119.825-1.135 155.22l-1.61 5.56-5.726.842c-98.8 14.528-195.613 13.81-290.605.002l-6.285-.914-1.246-6.23c-9.89-49.49-4.085-102.785-.664-154.42-4.89.354-9.765.72-14.602 1.107-8.596 58.568-9.39 116.957-.05 175.292 110.24 12.088 222.275 12.205 336.203-.01 8.502-57.83 8.29-116.25-.017-175.313-4.725-.4-9.485-.776-14.262-1.14zM255.966 92.3c32.526-.025 65.067 2.746 97.574 8.39l7.46 1.295v7.572c0 15.554 1.683 35.105-12.69 50.25-9.912 10.444-25.655 17.337-51.31 20.585v18.164h-82v-18.452c-23.992-3.37-39.352-10.175-49.363-20.185C150.807 145.093 151 125.56 151 109.56v-7.594l7.484-1.278c32.444-5.54 64.955-8.362 97.48-8.386zm.012 17.994c-28.96.022-57.913 2.444-86.858 6.996.265 12.28 1.635 22.296 9.243 29.904 5.914 5.914 16.952 11.416 36.637 14.582v-29.22h82v29.51c21.367-3.115 32.66-8.755 38.254-14.65 7.033-7.41 7.696-17.502 7.73-30.124-29-4.63-58.006-7.02-87.007-6.998zM233 150.56v30h46v-30zm209.674 92.42a619 619 0 0 1-1.61 10.87c.214 2.352.42 4.706.63 7.06L471 290.213v-22.24l-28.326-24.995zm-373.485.12L41 267.973v22.24l29.318-29.318c.205-2.327.406-4.655.616-6.982a542 542 0 0 1-1.745-10.813m354.634 20.397a1638 1638 0 0 1-30.824 2.967v74.095h16v66h-16v80.615c10.318-.633 20.63-1.313 30.928-2.082 9.445-74.01 6.478-147.698-.104-221.596zm-335.576.03C81.725 338.09 78.58 412.1 88.06 485.1q15.487 1.184 30.94 2.145V406.56h-16v-66h16v-74.024a1537 1537 0 0 1-30.752-3.01zm286.752 4.4q-15.021 1.14-30 1.992v70.64h30zm-238 .085v72.547h30v-70.55a1557 1557 0 0 1-30-1.997m190 2.825c-47.65 2.173-94.984 2.19-142 .078v19.314c23.95-5.165 47.8-7.652 71.516-7.59 23.638.06 47.145 2.654 70.484 7.626v-19.43zM68.05 288.62 41 315.67v56.89h23.06c.376-27.987 1.88-55.975 3.99-83.94m375.948.047c2.12 27.872 3.61 55.83 3.957 83.892H471v-56.89zm-187.52 11.95c-23.68-.063-47.487 2.577-71.478 8.052v31.89h16v18.443c17.033 5.346 31.73 8.493 46 9.426v-2.87h18v2.868c14.27-.932 28.967-4.08 46-9.425V340.56h16v-31.866c-23.42-5.267-46.907-8.016-70.523-8.078zM121 358.558v30h22v-23h18v23h22v-30zm208 0v30h22v-23h18v23h22v-30zM201 377.8v28.76h-16v15.857c48.528 10.865 95.713 10.664 142 .045V406.56h-16V377.8c-16.332 4.747-31.283 7.52-46 8.326v11.433h-18v-11.434c-14.717-.806-29.668-3.58-46-8.326zM41 390.56v14h23.14q-.134-7-.163-14zm407.012 0a935 935 0 0 1-.18 14H471v-14zM137 406.56v19.798c6.137 7.214 11.222 9.77 14.934 9.844 3.734.075 8.697-2.122 15.066-9.79V406.56h-6v7h-18v-7zm208 0v19.798c6.137 7.214 11.222 9.77 14.934 9.844 3.734.075 8.697-2.122 15.066-9.79V406.56h-6v7h-18v-7zm-304 16v35.154c5.596 5.51 8.677 8.25 11.846 9.306 2.454.818 7.713 1.15 15.045 1.317-1.544-15.25-2.586-30.51-3.204-45.778H41zm406.27 0c-.628 15.224-1.674 30.483-3.21 45.78 7.358-.168 12.635-.5 15.094-1.32 3.17-1.056 6.25-3.795 11.846-9.306V422.56zM185 440.842v49.498c47.55 1.51 94.877 1.446 142-.074V440.9c-46.316 10.03-93.74 10.185-142-.057zm-48 9.123v38.318q15.015.809 30 1.408v-39.678c-4.86 2.786-10.01 4.293-15.43 4.184-5.192-.104-10.036-1.624-14.57-4.232m208 0v39.654c10.01-.403 20.01-.878 30-1.412v-38.194c-4.86 2.786-10.01 4.293-15.43 4.184-5.192-.104-10.036-1.624-14.57-4.232" /></svg>
              <span>Ekwipunek</span>
            </button>
            <button class="character-tab" data-character-tab="notebook" aria-label="Notatnik" title="Notatnik">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h13v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M8 3v18" /><path d="M11 8h5" /><path d="M11 12h5" /></svg>
              <span>Notatnik</span>
            </button>
          </nav>
          <div class="character-tab-panels">
            <section class="character-tab-panel active" data-character-panel="data">
              <div class="character-profile-banner">
                <div>
                  ${avatarMarkup(character.avatar, character.name, 'character-avatar large')}
                  <strong>${escapeHtml(character.name)}</strong>
                </div>
                ${character.motto ? `<em>${escapeHtml(character.motto)}</em>` : ''}
              </div>
              <div class="sheet-profile">
                <span>Klasa: <strong>${escapeHtml(character.classes || character.className)}</strong></span>
                <span>Poziom: <strong>${character.level}</strong></span>
                <span>Wiek: <strong>${character.age || '—'}</strong></span>
                <span>Wzrost: <strong>${escapeHtml(character.height || '—')}</strong></span>
                <span>Waga: <strong>${escapeHtml(character.weight || '—')}</strong></span>
                <span>Punkty: <strong>${character.points} (minimum ${character.minimumPoints})</strong></span>
              </div>
              ${section('Gildie', guildRows, true, 'character.data.guilds')}
              ${section('Drużyna', '<div id="character-team-content"><p class="loading-copy">Pobieranie drużyny…</p></div>', true, 'character.data.team')}
            </section>
            <section class="character-tab-panel" data-character-panel="stats">
              ${section('Statystyki główne', attributeRows, true, 'character.stats.main')}
              ${section('Walka', `<div class="sheet-stat-grid">${formulaRows(CHARACTER_COMBAT, character.combat)}</div>`, true, 'character.stats.combat')}
              ${section('Statystyki pomocnicze', `<div class="sheet-stat-grid">${formulaRows(CHARACTER_AUXILIARY, character.auxiliary)}</div>`, true, 'character.stats.auxiliary')}
              ${section('Podstatystyki', skillRows, true, 'character.stats.skills')}
              ${section('Rozwój specjalny', specialRows, true, 'character.stats.special')}
            </section>
            <section class="character-tab-panel" data-character-panel="features">
              ${featureLists}
            </section>
            <section class="character-tab-panel" data-character-panel="inventory">
              <div class="inventory-screen">
                <div id="inventory-list" class="inventory-list"></div>
                <section class="inventory-add-card">
                  <button id="open-add-inventory-item" class="inventory-add-trigger" type="button">
                    <span class="inventory-icon add">+</span>
                    <span>
                      <strong>Dodaj przedmiot</strong>
                      <small>Wpisz nazwę i ilość</small>
                    </span>
                  </button>
                  <form id="inventory-item-form" class="inventory-item-form hidden">
                    <label>
                      <span>Nazwa przedmiotu</span>
                      <input name="name" maxlength="150" placeholder="np. Mikstura leczenia" required />
                    </label>
                  <label>
                    <span>Ilość</span>
                    <input name="quantity" type="number" min="1" max="9999" value="1" inputmode="numeric" required />
                  </label>
                  ${inventoryDurationControl()}
                  ${inventoryIconPicker()}
                  <div class="dm-form-actions">
                    <button type="button" class="secondary" data-cancel-inventory-add>Anuluj</button>
                    <button type="submit">Dodaj do ekwipunku</button>
                  </div>
                  </form>
                </section>
                <p id="inventory-status" class="inventory-status" role="status"></p>
              </div>
            </section>
            <section class="character-tab-panel" data-character-panel="notebook">
              <div class="notebook-screen">
                <div class="notebook-floating-menu">
                  <button type="button" class="notebook-menu-toggle" data-notebook-menu-toggle aria-expanded="false" aria-label="Otwórz narzędzia notatnika" title="Narzędzia notatnika">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></svg>
                  </button>
                  <div class="notebook-menu-panel" data-notebook-menu>
                    <div class="notebook-mode-switch" role="group" aria-label="Tryb notatnika">
                      <button type="button" class="secondary active" data-notebook-mode="text" aria-label="Pisanie klawiaturą" title="Klawiatura">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>
                        <span>Klawiatura</span>
                      </button>
                      <button type="button" class="secondary" data-notebook-mode="draw" aria-label="Rysowanie na kartce" title="Kartka">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z" /><path d="M15 3v4h4" /><path d="m8 16 6-6 2 2-6 6H8z" /></svg>
                        <span>Kartka</span>
                      </button>
                    </div>
                    <div class="notebook-draw-toolbar hidden" data-notebook-draw-tools>
                      <div class="notebook-primary-tools" role="toolbar" aria-label="Narzędzia kartki">
                        <button type="button" class="secondary" data-notebook-undo aria-label="Cofnij ostatnią kreskę" title="Cofnij"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5" /><path d="M5 12h8a6 6 0 0 1 6 6" /></svg><span>Cofnij</span></button>
                        <button type="button" class="secondary" data-notebook-tool="pan" aria-label="Przesuwanie kartki" title="Przesuwaj"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M2 12h20" /><path d="m8 6 4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" /></svg><span>Przesuwaj</span></button>
                        <button type="button" class="secondary active" data-notebook-tool="pen" aria-label="Rysowanie" title="Rysuj"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4-1 11-11-3-3L5 16z" /><path d="m14 7 3 3" /></svg><span>Rysuj</span></button>
                        <button type="button" class="secondary" data-notebook-tool="eraser" aria-label="Gumka" title="Gumka"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 15 8-9 7 6-7 8H8z" /><path d="m9 12 6 5" /></svg><span>Gumka</span></button>
                        <div class="notebook-color-picker">
                          <button type="button" class="secondary" data-notebook-color-toggle aria-label="Wybierz kolor" title="Kolor"><span id="notebook-color-preview" aria-hidden="true"></span><span>Kolor</span></button>
                          <div class="notebook-color-popover hidden" data-notebook-color-popover>
                            <canvas id="notebook-color-wheel" width="144" height="144" aria-label="Koło wyboru koloru"></canvas>
                          </div>
                        </div>
                      </div>
                      <span class="notebook-zoom-label" title="Przybliżenie kartki"><strong id="notebook-zoom-value">100%</strong></span>
                    </div>
                  </div>
                </div>
                <div class="notebook-text-panel" data-notebook-panel="text">
                  <textarea id="notebook-text" maxlength="50000" placeholder="Zacznij pisać notatki…"></textarea>
                </div>
                <div class="notebook-draw-panel hidden" data-notebook-panel="draw">
                  <div class="notebook-canvas-wrap">
                    <canvas id="notebook-canvas" aria-label="Nieskończona kartka notatnika"></canvas>
                  </div>
                </div>
                <p id="notebook-status" class="notebook-status" role="status">Zmiany zapisują się automatycznie.</p>
              </div>
            </section>
          </div>
        </div>
      `;

      bindUiSectionPreferences(contentPanel);

      const characterTabs = contentPanel.querySelector('.character-tabs');
      if (characterTabs && footerNav) {
        characterTabs.classList.add('character-footer-tabs');
        footerNav.before(characterTabs);
      }

      document.querySelector('#leave-character')?.addEventListener('click', () => {
        characterTabs?.remove();
        if (headerIdentity) {
          headerIdentity.innerHTML = `
            ${avatarMarkup(storedSession?.user?.avatar, storedSession?.user?.username, 'header-avatar')}
            <div><p class="eyebrow">Witaj</p><h2>${safeUsername}</h2></div>
          `;
        }
        if (headerAction) headerAction.innerHTML = '';
        if (footerNav) footerNav.classList.remove('hidden');
        renderCharacters();
      });
      characterTabs?.querySelectorAll('[data-character-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          characterTabs
            .querySelectorAll('[data-character-tab]')
            .forEach((item) => item.classList.toggle('active', item === button));
          contentPanel.querySelectorAll('[data-character-panel]').forEach((panel) => {
            panel.classList.toggle('active', panel.dataset.characterPanel === button.dataset.characterTab);
          });
          if (button.dataset.characterTab === 'notebook') {
            contentPanel.querySelector('.character-dashboard')?.classList.add('notebook-active');
            window.requestAnimationFrame(renderNotebookCanvas);
          } else {
            contentPanel.querySelector('.character-dashboard')?.classList.remove('notebook-active');
          }
        });
      });

      const persistFeatureOrder = async (featureList) => {
        const type = featureList.dataset.featureOrderList;
        const status = contentPanel.querySelector(`[data-feature-order-status="${type}"]`);
        const orderedIndices = [...featureList.querySelectorAll(':scope > [data-feature-order-item]')].map((item) =>
          Number(item.dataset.featureOrderItem),
        );
        const nextItems = orderedIndices.map((index) => character.features[type][index]);
        if (status) status.textContent = 'Zapisywanie kolejności…';
        try {
          const response = await authenticatedFetch(`/api/characters/${character.id}/features/order`, {
            method: 'PATCH',
            body: JSON.stringify({ type, items: nextItems }),
          });
          if (!response.ok) throw new Error('feature_order_save_failed');
          const updated = await response.json();
          character.features = updated.features;
          [...featureList.querySelectorAll(':scope > [data-feature-order-item]')].forEach((item, index) => {
            item.dataset.featureOrderItem = String(index);
          });
          if (status) status.textContent = 'Kolejność została zapisana.';
        } catch {
          [...featureList.querySelectorAll(':scope > [data-feature-order-item]')]
            .sort((left, right) => Number(left.dataset.featureOrderItem) - Number(right.dataset.featureOrderItem))
            .forEach((item) => featureList.appendChild(item));
          if (status) status.textContent = 'Nie udało się zapisać kolejności.';
        }
      };

      contentPanel.querySelector('[data-character-panel="features"]')?.addEventListener('keydown', (event) => {
        const handle = event.target.closest('[data-feature-sheet-drag]');
        if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const item = handle.closest('[data-feature-order-item]');
        const sibling = event.key === 'ArrowUp' ? item?.previousElementSibling : item?.nextElementSibling;
        if (!item || !sibling?.matches('[data-feature-order-item]')) return;
        event.preventDefault();
        if (event.key === 'ArrowUp') item.parentElement.insertBefore(item, sibling);
        else item.parentElement.insertBefore(sibling, item);
        handle.focus();
        void persistFeatureOrder(item.parentElement);
      });

      contentPanel.querySelector('[data-character-panel="features"]')?.addEventListener('pointerdown', (event) => {
        const handle = event.target.closest('[data-feature-sheet-drag]');
        if (!handle || event.isPrimary === false) return;
        const draggedItem = handle.closest('[data-feature-order-item]');
        const featureList = draggedItem?.closest('[data-feature-order-list]');
        if (!draggedItem || !featureList) return;
        event.preventDefault();
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          // Niektóre wersje iOS nie pozwalają przechwycić wskaźnika od razu.
        }
        draggedItem.classList.add('dragging');
        featureList.classList.add('reordering');

        const moveFeature = (moveEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return;
          moveEvent.preventDefault();
          const siblings = [...featureList.querySelectorAll(':scope > [data-feature-order-item]')].filter(
            (item) => item !== draggedItem,
          );
          const nextItem = siblings.find((item) => {
            const bounds = item.getBoundingClientRect();
            return moveEvent.clientY < bounds.top + bounds.height / 2;
          });
          if (nextItem) featureList.insertBefore(draggedItem, nextItem);
          else featureList.appendChild(draggedItem);

          const scrollBounds = contentPanel.getBoundingClientRect();
          const scrollEdge = Math.min(80, scrollBounds.height * 0.18);
          if (moveEvent.clientY < scrollBounds.top + scrollEdge) contentPanel.scrollBy({ top: -18 });
          else if (moveEvent.clientY > scrollBounds.bottom - scrollEdge) contentPanel.scrollBy({ top: 18 });
        };
        const finishFeatureReorder = (finishEvent) => {
          window.removeEventListener('pointermove', moveFeature);
          window.removeEventListener('pointerup', finishFeatureReorder);
          window.removeEventListener('pointercancel', cancelFeatureReorder);
          if (handle.hasPointerCapture?.(finishEvent.pointerId)) handle.releasePointerCapture(finishEvent.pointerId);
          draggedItem.classList.remove('dragging');
          featureList.classList.remove('reordering');
          void persistFeatureOrder(featureList);
        };
        const cancelFeatureReorder = (cancelEvent) => {
          window.removeEventListener('pointermove', moveFeature);
          window.removeEventListener('pointerup', finishFeatureReorder);
          window.removeEventListener('pointercancel', cancelFeatureReorder);
          if (handle.hasPointerCapture?.(cancelEvent.pointerId)) handle.releasePointerCapture(cancelEvent.pointerId);
          draggedItem.classList.remove('dragging');
          featureList.classList.remove('reordering');
          [...featureList.querySelectorAll(':scope > [data-feature-order-item]')]
            .sort((left, right) => Number(left.dataset.featureOrderItem) - Number(right.dataset.featureOrderItem))
            .forEach((item) => featureList.appendChild(item));
        };
        window.addEventListener('pointermove', moveFeature, { passive: false });
        window.addEventListener('pointerup', finishFeatureReorder);
        window.addEventListener('pointercancel', cancelFeatureReorder);
      });

      const notebook = {
        mode: character.notebook?.mode === 'draw' ? 'draw' : 'text',
        text: String(character.notebook?.text || ''),
        strokes: Array.isArray(character.notebook?.strokes) ? character.notebook.strokes : [],
      };
      const notebookText = contentPanel.querySelector('#notebook-text');
      const notebookCanvas = contentPanel.querySelector('#notebook-canvas');
      const notebookCanvasWrap = notebookCanvas?.closest('.notebook-canvas-wrap');
      const notebookStatus = contentPanel.querySelector('#notebook-status');
      const notebookZoomValue = contentPanel.querySelector('#notebook-zoom-value');
      const notebookColorWheel = contentPanel.querySelector('#notebook-color-wheel');
      const notebookColorPreview = contentPanel.querySelector('#notebook-color-preview');
      const notebookColorPopover = contentPanel.querySelector('[data-notebook-color-popover]');
      const notebookView = { x: 0, y: 0, scale: 1 };
      const notebookPointers = new Map();
      let notebookTool = 'pen';
      let activeNotebookStroke = null;
      let notebookPanStart = null;
      let notebookPinch = null;
      let notebookSaveTimer = null;
      let notebookSaving = false;
      let notebookSaveQueued = false;
      let notebookPenColor = '#1f2937';
      let notebookColorMarker = null;

      const updateNotebookStatus = (message, isError = false) => {
        if (!notebookStatus) return;
        notebookStatus.textContent = message;
        notebookStatus.classList.toggle('error', isError);
      };

      async function saveNotebook() {
        if (notebookSaving) {
          notebookSaveQueued = true;
          return;
        }
        notebookSaving = true;
        updateNotebookStatus('Zapisywanie…');
        try {
          const response = await authenticatedFetch(`/api/characters/${character.id}/notebook`, {
            method: 'PATCH',
            body: JSON.stringify({ notebook }),
          });
          if (!response.ok) throw new Error('notebook_save_failed');
          const updated = await response.json();
          character.notebook = updated.notebook;
          updateNotebookStatus('Zapisano automatycznie.');
        } catch {
          updateNotebookStatus('Nie udało się zapisać notatnika.', true);
        } finally {
          notebookSaving = false;
          if (notebookSaveQueued) {
            notebookSaveQueued = false;
            saveNotebook();
          }
        }
      }

      function scheduleNotebookSave(delay = 650) {
        window.clearTimeout(notebookSaveTimer);
        notebookSaveTimer = window.setTimeout(saveNotebook, delay);
      }

      function setNotebookMode(mode) {
        notebook.mode = mode === 'draw' ? 'draw' : 'text';
        contentPanel.querySelectorAll('[data-notebook-mode]').forEach((button) => {
          button.classList.toggle('active', button.dataset.notebookMode === notebook.mode);
        });
        contentPanel.querySelector('[data-notebook-draw-tools]')?.classList.toggle('hidden', notebook.mode !== 'draw');
        contentPanel.querySelectorAll('[data-notebook-panel]').forEach((panel) => {
          panel.classList.toggle('hidden', panel.dataset.notebookPanel !== notebook.mode);
        });
        if (notebook.mode === 'draw') window.requestAnimationFrame(renderNotebookCanvas);
        scheduleNotebookSave(150);
      }

      function notebookScreenPoint(event) {
        const bounds = notebookCanvas.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      }

      function notebookWorldPoint(point) {
        return {
          x: (point.x - notebookView.x) / notebookView.scale,
          y: (point.y - notebookView.y) / notebookView.scale,
        };
      }

      function setNotebookZoom(nextScale, centerX, centerY) {
        const scale = Math.max(0.2, Math.min(5, nextScale));
        const worldX = (centerX - notebookView.x) / notebookView.scale;
        const worldY = (centerY - notebookView.y) / notebookView.scale;
        notebookView.scale = scale;
        notebookView.x = centerX - worldX * scale;
        notebookView.y = centerY - worldY * scale;
        if (notebookZoomValue) notebookZoomValue.textContent = `${Math.round(scale * 100)}%`;
        renderNotebookCanvas();
      }

      function hsvToRgb(hue, saturation, value) {
        const chroma = value * saturation;
        const section = hue / 60;
        const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
        const [red, green, blue] =
          section < 1
            ? [chroma, intermediate, 0]
            : section < 2
              ? [intermediate, chroma, 0]
              : section < 3
                ? [0, chroma, intermediate]
                : section < 4
                  ? [0, intermediate, chroma]
                  : section < 5
                    ? [intermediate, 0, chroma]
                    : [chroma, 0, intermediate];
        const match = value - chroma;
        return [red, green, blue].map((channel) => Math.round((channel + match) * 255));
      }

      function rgbHex(red, green, blue) {
        return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
      }

      function renderNotebookColorWheel() {
        if (!notebookColorWheel) return;
        const context = notebookColorWheel.getContext('2d');
        const size = notebookColorWheel.width;
        const radius = size / 2;
        const image = context.createImageData(size, size);
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const offsetX = x - radius;
            const offsetY = y - radius;
            const distance = Math.hypot(offsetX, offsetY);
            const index = (y * size + x) * 4;
            if (distance > radius - 2) {
              image.data[index + 3] = 0;
              continue;
            }
            const hue = ((Math.atan2(offsetY, offsetX) * 180) / Math.PI + 360) % 360;
            const saturation = Math.min(1, distance / (radius - 2));
            const [red, green, blue] = hsvToRgb(hue, saturation, 0.88);
            image.data[index] = red;
            image.data[index + 1] = green;
            image.data[index + 2] = blue;
            image.data[index + 3] = 255;
          }
        }
        context.putImageData(image, 0, 0);
        if (notebookColorMarker) {
          context.beginPath();
          context.arc(notebookColorMarker.x, notebookColorMarker.y, 6, 0, Math.PI * 2);
          context.strokeStyle = '#ffffff';
          context.lineWidth = 3;
          context.stroke();
          context.strokeStyle = '#111827';
          context.lineWidth = 1;
          context.stroke();
        }
        if (notebookColorPreview) notebookColorPreview.style.background = notebookPenColor;
      }

      function selectNotebookColor(event) {
        const bounds = notebookColorWheel.getBoundingClientRect();
        const scaleX = notebookColorWheel.width / bounds.width;
        const scaleY = notebookColorWheel.height / bounds.height;
        const point = { x: (event.clientX - bounds.left) * scaleX, y: (event.clientY - bounds.top) * scaleY };
        const radius = notebookColorWheel.width / 2;
        const offsetX = point.x - radius;
        const offsetY = point.y - radius;
        const distance = Math.hypot(offsetX, offsetY);
        if (distance > radius) return;
        const hue = ((Math.atan2(offsetY, offsetX) * 180) / Math.PI + 360) % 360;
        const saturation = Math.min(1, distance / (radius - 2));
        notebookPenColor = rgbHex(...hsvToRgb(hue, saturation, 0.88));
        notebookColorMarker = point;
        renderNotebookColorWheel();
      }

      function renderNotebookCanvas() {
        if (!notebookCanvas || !notebookCanvasWrap) return;
        const bounds = notebookCanvasWrap.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.round(bounds.width * ratio);
        const height = Math.round(bounds.height * ratio);
        if (notebookCanvas.width !== width || notebookCanvas.height !== height) {
          notebookCanvas.width = width;
          notebookCanvas.height = height;
        }
        const context = notebookCanvas.getContext('2d');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = '#fffdf7';
        context.fillRect(0, 0, bounds.width, bounds.height);

        const grid = 50 * notebookView.scale;
        const startX = ((notebookView.x % grid) + grid) % grid;
        const startY = ((notebookView.y % grid) + grid) % grid;
        context.strokeStyle = 'rgba(100, 116, 139, 0.13)';
        context.lineWidth = 1;
        context.beginPath();
        for (let x = startX; x < bounds.width; x += grid) {
          context.moveTo(x, 0);
          context.lineTo(x, bounds.height);
        }
        for (let y = startY; y < bounds.height; y += grid) {
          context.moveTo(0, y);
          context.lineTo(bounds.width, y);
        }
        context.stroke();

        context.setTransform(
          ratio * notebookView.scale,
          0,
          0,
          ratio * notebookView.scale,
          ratio * notebookView.x,
          ratio * notebookView.y,
        );
        context.lineCap = 'round';
        context.lineJoin = 'round';
        notebook.strokes.forEach((stroke) => {
          if (!stroke.points?.length) return;
          context.strokeStyle = stroke.color || '#1f2937';
          context.lineWidth = Number(stroke.width) || 3;
          context.beginPath();
          context.moveTo(stroke.points[0].x, stroke.points[0].y);
          stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
          if (stroke.points.length === 1) context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01);
          context.stroke();
        });
      }

      function distanceToNotebookSegment(point, start, end) {
        const deltaX = end.x - start.x;
        const deltaY = end.y - start.y;
        if (!deltaX && !deltaY) return Math.hypot(point.x - start.x, point.y - start.y);
        const position = Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / (deltaX * deltaX + deltaY * deltaY),
          ),
        );
        return Math.hypot(point.x - (start.x + position * deltaX), point.y - (start.y + position * deltaY));
      }

      function eraseNotebookAt(screenPoint) {
        const point = notebookWorldPoint(screenPoint);
        const radius = 14 / notebookView.scale;
        const previousLength = notebook.strokes.length;
        notebook.strokes = notebook.strokes.filter((stroke) => {
          const points = stroke.points || [];
          return !points.some((current, index) => {
            if (index === 0) return Math.hypot(point.x - current.x, point.y - current.y) <= radius;
            return distanceToNotebookSegment(point, points[index - 1], current) <= radius;
          });
        });
        if (notebook.strokes.length !== previousLength) {
          renderNotebookCanvas();
          scheduleNotebookSave(250);
        }
      }

      notebookText.value = notebook.text;
      notebookText.addEventListener('input', () => {
        notebook.text = notebookText.value;
        scheduleNotebookSave();
      });
      contentPanel.querySelectorAll('[data-notebook-mode]').forEach((button) => {
        button.addEventListener('click', () => setNotebookMode(button.dataset.notebookMode));
      });
      const notebookFloatingMenu = contentPanel.querySelector('.notebook-floating-menu');
      const notebookMenuToggle = contentPanel.querySelector('[data-notebook-menu-toggle]');
      notebookMenuToggle?.addEventListener('click', () => {
        const isOpen = notebookFloatingMenu?.classList.toggle('open') || false;
        notebookMenuToggle.setAttribute('aria-expanded', String(isOpen));
        notebookMenuToggle.setAttribute(
          'aria-label',
          isOpen ? 'Zamknij narzędzia notatnika' : 'Otwórz narzędzia notatnika',
        );
        if (!isOpen) notebookColorPopover?.classList.add('hidden');
      });
      contentPanel.querySelectorAll('[data-notebook-tool]').forEach((button) => {
        button.addEventListener('click', () => {
          notebookTool = button.dataset.notebookTool;
          contentPanel.querySelectorAll('[data-notebook-tool]').forEach((item) => {
            item.classList.toggle('active', item === button);
          });
          notebookCanvas.classList.toggle('pan-tool', notebookTool === 'pan');
          notebookCanvas.classList.toggle('eraser-tool', notebookTool === 'eraser');
        });
      });
      contentPanel.querySelector('[data-notebook-color-toggle]')?.addEventListener('click', () => {
        notebookColorPopover?.classList.toggle('hidden');
      });
      contentPanel.querySelector('[data-notebook-undo]')?.addEventListener('click', () => {
        notebook.strokes.pop();
        renderNotebookCanvas();
        scheduleNotebookSave(150);
      });
      contentPanel.querySelectorAll('[data-notebook-zoom]').forEach((button) => {
        button.addEventListener('click', () => {
          const bounds = notebookCanvas.getBoundingClientRect();
          const factor = button.dataset.notebookZoom === 'in' ? 1.25 : 0.8;
          setNotebookZoom(notebookView.scale * factor, bounds.width / 2, bounds.height / 2);
        });
      });
      notebookCanvas?.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          const point = notebookScreenPoint(event);
          setNotebookZoom(notebookView.scale * (event.deltaY < 0 ? 1.1 : 0.9), point.x, point.y);
        },
        { passive: false },
      );
      notebookColorWheel?.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        notebookColorWheel.setPointerCapture?.(event.pointerId);
        selectNotebookColor(event);
      });
      notebookColorWheel?.addEventListener('pointermove', (event) => {
        if (!notebookColorWheel.hasPointerCapture?.(event.pointerId)) return;
        event.preventDefault();
        selectNotebookColor(event);
      });
      notebookCanvas?.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        notebookCanvas.setPointerCapture?.(event.pointerId);
        const point = notebookScreenPoint(event);
        notebookPointers.set(event.pointerId, point);
        if (notebookPointers.size === 2) {
          activeNotebookStroke = null;
          const [first, second] = [...notebookPointers.values()];
          const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
          notebookPinch = {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            scale: notebookView.scale,
            world: notebookWorldPoint(center),
          };
          return;
        }
        if (notebookTool === 'pan') {
          notebookPanStart = { point, x: notebookView.x, y: notebookView.y };
          return;
        }
        if (notebookTool === 'eraser') {
          eraseNotebookAt(point);
          return;
        }
        activeNotebookStroke = {
          color: notebookPenColor,
          width: event.pointerType === 'pen' ? 2.5 : 3,
          points: [notebookWorldPoint(point)],
        };
        notebook.strokes.push(activeNotebookStroke);
        renderNotebookCanvas();
      });
      notebookCanvas?.addEventListener('pointermove', (event) => {
        if (!notebookPointers.has(event.pointerId)) return;
        event.preventDefault();
        const point = notebookScreenPoint(event);
        notebookPointers.set(event.pointerId, point);
        if (notebookPointers.size >= 2 && notebookPinch) {
          const [first, second] = [...notebookPointers.values()];
          const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
          const distance = Math.hypot(second.x - first.x, second.y - first.y);
          const scale = Math.max(
            0.2,
            Math.min(5, (notebookPinch.scale * distance) / Math.max(1, notebookPinch.distance)),
          );
          notebookView.scale = scale;
          notebookView.x = center.x - notebookPinch.world.x * scale;
          notebookView.y = center.y - notebookPinch.world.y * scale;
          if (notebookZoomValue) notebookZoomValue.textContent = `${Math.round(scale * 100)}%`;
          renderNotebookCanvas();
        } else if (notebookTool === 'pan' && notebookPanStart) {
          notebookView.x = notebookPanStart.x + point.x - notebookPanStart.point.x;
          notebookView.y = notebookPanStart.y + point.y - notebookPanStart.point.y;
          renderNotebookCanvas();
        } else if (notebookTool === 'eraser') {
          eraseNotebookAt(point);
        } else if (activeNotebookStroke) {
          activeNotebookStroke.points.push(notebookWorldPoint(point));
          renderNotebookCanvas();
        }
      });
      const finishNotebookPointer = (event) => {
        if (!notebookPointers.has(event.pointerId)) return;
        notebookPointers.delete(event.pointerId);
        if (activeNotebookStroke) scheduleNotebookSave(200);
        activeNotebookStroke = null;
        notebookPanStart = null;
        if (notebookPointers.size < 2) notebookPinch = null;
      };
      notebookCanvas?.addEventListener('pointerup', finishNotebookPointer);
      notebookCanvas?.addEventListener('pointercancel', finishNotebookPointer);
      new ResizeObserver(renderNotebookCanvas).observe(notebookCanvasWrap);
      renderNotebookColorWheel();
      setNotebookMode(notebook.mode);

      async function showCampaignCharacter(campaignId, campaignName, member) {
        characterTabs?.classList.add('hidden');
        contentPanel.innerHTML = `
          <div class="team-character-screen">
            <div class="section-heading">
              <div>
                <p class="eyebrow">${escapeHtml(campaignName)}</p>
                <h2>${escapeHtml(member.name)}</h2>
              </div>
              <button id="team-character-back" class="secondary small">Wróć</button>
            </div>
            <div id="team-character-details">
              <p class="loading-copy">Pobieranie danych postaci…</p>
            </div>
          </div>
        `;
        document.querySelector('#team-character-back')?.addEventListener('click', () => showCharacter(character));
        const details = document.querySelector('#team-character-details');
        try {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/characters/${member.id}`);
          if (!response.ok) throw new Error('team_character_load_failed');
          const teammate = await response.json();
          const teammateAttributes = CHARACTER_ATTRIBUTES.map(([key, label]) => {
            const stat = teammate.attributes?.[key] || { adventure: 0, combat: 0 };
            return `<div class="sheet-row"><span>${label}</span><strong>${stat.adventure} / ${stat.combat}</strong></div>`;
          }).join('');
          const teammateFormulaRows = (definitions, values) =>
            definitions
              .map(([key, label]) => {
                const stat = values?.[key] || {};
                const formula = stat.formulaTerms?.length ? formulaTermsText(stat.formulaTerms) : stat.formula;
                return `<div class="sheet-stat"><span>${label}</span><strong>${escapeHtml(stat.value || '—')}</strong>${key !== 'initiative' && formula ? `<small>${escapeHtml(formula)}</small>` : ''}</div>`;
              })
              .join('');
          const teammateSkills = CHARACTER_SKILL_GROUPS.map(
            ([group, entries, groupKey]) => `
            <div class="sheet-skill-group">
              <h4>${group}</h4>
              ${entries
                .map(([key, label]) => {
                  const skill = teammate.skills?.[key] || {};
                  return `<div class="sheet-row"><span>${label}</span><strong>${skill.percent ?? 0}% = ${skill.result ?? 0}</strong></div>`;
                })
                .join('')}
              ${(teammate.customSkills || [])
                .filter((item) => item.group === groupKey)
                .map(
                  (item) => `
                <div class="sheet-row custom"><span>${escapeHtml(item.name)}</span><strong>${item.percent}% = ${item.result}</strong></div>
              `,
                )
                .join('')}
            </div>
          `,
          ).join('');
          const teammateGuilds = (teammate.guilds || []).length
            ? teammate.guilds
                .map(
                  (guild) =>
                    `<div class="sheet-row"><span>${escapeHtml(guild.name)}</span><strong>${escapeHtml([guild.rank || 'Bez rangi', guild.profession].filter(Boolean).join(' • '))}</strong></div>`,
                )
                .join('')
            : '<p class="section-note">Brak gildii.</p>';
          details.innerHTML = `
            <div class="character-profile-banner">
              <div>
                ${avatarMarkup(teammate.avatar, teammate.name, 'character-avatar large')}
                <strong>${escapeHtml(teammate.name)}</strong>
              </div>
              ${teammate.motto ? `<em>${escapeHtml(teammate.motto)}</em>` : ''}
            </div>
            <div class="sheet-profile">
              <span>Gracz: <strong>${escapeHtml(teammate.user.username)}</strong></span>
              <span>Rasa: <strong>${escapeHtml(teammate.race)}</strong></span>
              <span>Klasa: <strong>${escapeHtml(teammate.classes)}</strong></span>
              <span>Poziom: <strong>${teammate.level}</strong></span>
              <span>Wiek: <strong>${teammate.age || '—'}</strong></span>
              <span>Wzrost: <strong>${escapeHtml(teammate.height || '—')}</strong></span>
              <span>Waga: <strong>${escapeHtml(teammate.weight || '—')}</strong></span>
            </div>
            ${section('Gildie', teammateGuilds, true)}
            ${section('Statystyki główne', teammateAttributes, true)}
            ${section('Walka', `<div class="sheet-stat-grid">${teammateFormulaRows(CHARACTER_COMBAT, teammate.combat)}</div>`, true)}
            ${section('Statystyki pomocnicze', `<div class="sheet-stat-grid">${teammateFormulaRows(CHARACTER_AUXILIARY, teammate.auxiliary)}</div>`, true)}
            ${section('Podstatystyki', teammateSkills, true)}
          `;
        } catch {
          details.innerHTML = '<div class="empty-state"><p>Nie udało się pobrać danych postaci.</p></div>';
        }
      }

      function dmFeatureSections(teammate) {
        return CHARACTER_FEATURES.map(([type, label]) => {
          const items = teammate.features?.[type] || [];
          const content = items.length
            ? `<div class="feature-sheet-list">${items
                .map(
                  (item) => `
            <article class="feature-sheet-item">
              <div class="feature-sheet-heading"><h4>${escapeHtml(item.name)}</h4>${type === 'abilities' ? `<strong>${Number(item.toothCost) || 0} ⏱️</strong>` : ''}</div>
              <div class="feature-sheet-meta">
                ${item.duration ? `<span>Czas trwania: <strong>${escapeHtml(item.duration)}</strong></span>` : ''}
                ${item.cooldown ? `<span>Cooldown: <strong>${escapeHtml(item.cooldown)}</strong></span>` : ''}
                ${item.ranged ? `<span>Zasięg: <strong>${escapeHtml(item.range || 'Nie podano')}</strong></span>` : ''}
                ${item.ranged && item.formulaTerms?.length ? `<span class="wide">Wzór: <strong>${escapeHtml(formulaTermsText(item.formulaTerms))}</strong></span>` : ''}
              </div>
              ${item.description ? `<div class="formatted-feature-description">${formatFeatureText(item.description)}</div>` : ''}
            </article>
          `,
                )
                .join('')}</div>`
            : '<p class="section-note">Brak wpisów.</p>';
          return section(label, content, true);
        }).join('');
      }

      function renderDmNotebookPreview(canvas, notebook) {
        if (!canvas) return;
        const strokes = Array.isArray(notebook?.strokes) ? notebook.strokes : [];
        const width = Math.max(260, canvas.clientWidth || 320);
        const height = 240;
        const ratio = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        context.scale(ratio, ratio);
        context.fillStyle = '#fffdf7';
        context.fillRect(0, 0, width, height);
        context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
        context.lineWidth = 1;
        for (let x = 20; x < width; x += 20) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, height);
          context.stroke();
        }
        for (let y = 20; y < height; y += 20) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(width, y);
          context.stroke();
        }
        const points = strokes.flatMap((stroke) => (Array.isArray(stroke.points) ? stroke.points : []));
        if (!points.length) return;
        const minX = Math.min(...points.map((point) => Number(point.x) || 0));
        const maxX = Math.max(...points.map((point) => Number(point.x) || 0));
        const minY = Math.min(...points.map((point) => Number(point.y) || 0));
        const maxY = Math.max(...points.map((point) => Number(point.y) || 0));
        const scale = Math.min((width - 32) / Math.max(1, maxX - minX), (height - 32) / Math.max(1, maxY - minY), 2);
        const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
        const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;
        strokes.forEach((stroke) => {
          if (!stroke.points?.length) return;
          context.beginPath();
          stroke.points.forEach((point, index) => {
            const x = (Number(point.x) || 0) * scale + offsetX;
            const y = (Number(point.y) || 0) * scale + offsetY;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.strokeStyle = /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : '#1f2937';
          context.lineWidth = Math.max(1, (Number(stroke.width) || 3) * scale);
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.stroke();
        });
      }

      function bindDmCharacterCard(container, teammate, campaignId, memberId) {
        renderDmNotebookPreview(container.querySelector('[data-dm-notebook-preview]'), teammate.notebook);
        let noteTimer;
        container.querySelectorAll('[data-dm-member-note], [data-dm-character-note]').forEach((textarea) => {
          textarea.addEventListener('input', () => {
            teammate.dmNote = textarea.value;
            container.querySelectorAll('[data-dm-member-note], [data-dm-character-note]').forEach((other) => {
              if (other !== textarea) other.value = textarea.value;
            });
            window.clearTimeout(noteTimer);
            noteTimer = window.setTimeout(
              () =>
                authenticatedFetch(`/api/campaigns/${campaignId}/dm/characters/${memberId}/note`, {
                  method: 'PUT',
                  body: JSON.stringify({ content: textarea.value }),
                }).catch(() => {}),
              500,
            );
          });
        });
        const inventoryForm = container.querySelector('[data-dm-add-inventory]');
        container.querySelector('[data-dm-open-inventory]')?.addEventListener('click', (event) => {
          inventoryForm?.classList.toggle('hidden');
          event.currentTarget.classList.toggle('open');
        });
        inventoryForm?.querySelector('[data-cancel-dm-inventory]')?.addEventListener('click', () => {
          inventoryForm.reset();
          inventoryForm.classList.add('hidden');
          container.querySelector('[data-dm-open-inventory]')?.classList.remove('open');
        });
        inventoryForm
          ?.querySelector('input[name="name"]')
          ?.addEventListener('input', () => selectAutomaticInventoryIcon(inventoryForm));
        inventoryForm?.querySelectorAll('input[name="icon"]').forEach((input) =>
          input.addEventListener('change', () => {
            inventoryForm.dataset.iconManuallySelected = 'true';
          }),
        );
        inventoryForm
          ?.querySelector('input[name="hasDuration"]')
          ?.addEventListener('change', (event) => toggleInventoryDuration(event.target));
        inventoryForm?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submit = inventoryForm.querySelector('button[type="submit"]');
          const data = new FormData(inventoryForm);
          submit.disabled = true;
          try {
            const response = await authenticatedFetch(
              `/api/campaigns/${campaignId}/dm/characters/${memberId}/inventory`,
              {
                method: 'POST',
                body: JSON.stringify({
                  name: data.get('name'),
                  quantity: Number(data.get('quantity')) || 1,
                  duration: data.get('duration') || '',
                  icon: data.get('icon') || '',
                }),
              },
            );
            if (!response.ok) throw new Error('dm_inventory_add_failed');
            teammate.inventory = (await response.json()).inventory;
            await showDmCharacter(
              campaignId,
              teammate.campaignName || '',
              { id: memberId, name: teammate.name },
              'inventory',
            );
          } catch {
            submit.disabled = false;
          }
        });
      }

      async function showDmCharacter(campaignId, campaignName, member, initialTab = 'summary') {
        contentPanel.innerHTML = `
          <div class="dm-panel-screen dm-character-screen">
            <div class="section-heading">
              <div><p class="eyebrow">Panel DM • ${escapeHtml(campaignName)}</p><h2>${escapeHtml(member.name)}</h2></div>
              <button id="dm-character-back" class="secondary small">Wróć</button>
            </div>
            <div id="dm-character-content"><p class="loading-copy">Pobieranie pełnej karty postaci…</p></div>
          </div>`;
        document
          .querySelector('#dm-character-back')
          ?.addEventListener('click', () => openDmPanel(campaignId, campaignName, 'team'));
        const target = document.querySelector('#dm-character-content');
        try {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/characters/${member.id}`);
          if (!response.ok) throw new Error('dm_character_load_failed');
          const teammate = await response.json();
          const attributes = CHARACTER_ATTRIBUTES.map(([key, label]) => {
            const stat = teammate.attributes?.[key] || { adventure: 0, combat: 0 };
            return `<div class="sheet-row"><span>${label}</span><strong>${stat.adventure} / ${stat.combat}</strong></div>`;
          }).join('');
          const formulaRows = (definitions, values) =>
            definitions
              .map(([key, label]) => {
                const stat = values?.[key] || {};
                const formula = stat.formulaTerms?.length ? formulaTermsText(stat.formulaTerms) : stat.formula;
                return `<div class="sheet-stat"><span>${label}</span><strong>${escapeHtml(stat.value || '—')}</strong>${key !== 'initiative' && formula ? `<small>${escapeHtml(formula)}</small>` : ''}</div>`;
              })
              .join('');
          const skills = CHARACTER_SKILL_GROUPS.map(
            ([group, entries, groupKey]) => `
            <div class="sheet-skill-group"><h4>${group}</h4>
              ${entries
                .map(([key, label]) => {
                  const skill = teammate.skills?.[key] || {};
                  return `<div class="sheet-row"><span>${label}</span><strong>${skill.percent ?? 0}% = ${skill.result ?? 0}</strong></div>`;
                })
                .join('')}
              ${(teammate.customSkills || [])
                .filter((item) => item.group === groupKey)
                .map(
                  (item) =>
                    `<div class="sheet-row custom"><span>${escapeHtml(item.name)}</span><strong>${item.percent ?? 0}% = ${item.result ?? 0}</strong></div>`,
                )
                .join('')}
            </div>`,
          ).join('');
          const special = CHARACTER_SPECIAL.map(([key, label]) => {
            const value = teammate.special?.[key] || {};
            return `<div class="sheet-row"><span>${label}</span><strong>${value.current ?? 0} / ${value.max ?? 0}</strong></div>`;
          }).join('');
          const guilds = (teammate.guilds || []).length
            ? teammate.guilds
                .map(
                  (guild) =>
                    `<div class="sheet-row"><span>${escapeHtml(guild.name)}</span><strong>${escapeHtml([guild.rank, guild.profession].filter(Boolean).join(' • ') || 'Bez rangi')}</strong></div>`,
                )
                .join('')
            : '<p class="section-note">Brak gildii.</p>';
          const inventory = parseInventory(teammate.inventory);
          const inventoryRows = inventory.length
            ? inventory
                .map(
                  (item) =>
                    `<div class="sheet-row"><span>${escapeHtml(item.name)}${item.duration ? ` • ${escapeHtml(item.duration)}` : ''}</span><strong>× ${item.quantity}</strong></div>`,
                )
                .join('')
            : '<p class="section-note">Ekwipunek jest pusty.</p>';
          teammate.campaignName = campaignName;
          target.innerHTML = `
            <div class="dm-character-tabs" role="tablist" aria-label="Szczegóły postaci">
              <button class="secondary" data-dm-character-tab="summary">Podsumowanie</button>
              <button class="secondary" data-dm-character-tab="sheet">Karta postaci</button>
              <button class="secondary" data-dm-character-tab="inventory">Ekwipunek</button>
              <button class="secondary" data-dm-character-tab="notes">Notatki DM</button>
              <button class="secondary" data-dm-character-tab="threads">Wątki i sekrety</button>
            </div>
            <div class="dm-character-panel" data-dm-character-panel="summary">
              <div class="character-profile-banner"><div>${avatarMarkup(teammate.avatar, teammate.name, 'character-avatar large')}<strong>${escapeHtml(teammate.name)}</strong></div>${teammate.motto ? `<em>${escapeHtml(teammate.motto)}</em>` : ''}</div>
              <div class="sheet-profile">
                <span>Gracz: <strong>${escapeHtml(teammate.user.username)}</strong></span><span>Rasa: <strong>${escapeHtml(teammate.race || '—')}</strong></span>
                <span>Klasa: <strong>${escapeHtml(teammate.classes || '—')}</strong></span><span>Poziom: <strong>${teammate.level}</strong></span>
                <span>Wiek: <strong>${teammate.age || '—'}</strong></span><span>Wzrost: <strong>${escapeHtml(teammate.height || '—')}</strong></span>
                <span>Waga: <strong>${escapeHtml(teammate.weight || '—')}</strong></span><span>Punkty: <strong>${teammate.points} (minimum ${teammate.minimumPoints})</strong></span>
              </div>
            </div>
            <div class="dm-character-panel" data-dm-character-panel="sheet">
              ${section('Gildie', guilds, true)}
              ${section('Statystyki główne', attributes, true)}
              ${section('Walka', `<div class="sheet-stat-grid">${formulaRows(CHARACTER_COMBAT, teammate.combat)}</div>`, true)}
              ${section('Statystyki pomocnicze', `<div class="sheet-stat-grid">${formulaRows(CHARACTER_AUXILIARY, teammate.auxiliary)}</div>`, true)}
              ${section('Podstatystyki', skills, true)}
              ${section('Rozwój specjalny', special, true)}
              ${dmFeatureSections(teammate)}
              ${section('Notatnik postaci', `<div class="dm-character-notebook">${teammate.notebook?.text ? `<p>${escapeHtml(teammate.notebook.text).replace(/\r?\n/g, '<br>')}</p>` : '<p class="section-note">Brak notatek tekstowych.</p>'}<canvas class="dm-notebook-preview" data-dm-notebook-preview aria-label="Podgląd rysunku z notatnika"></canvas><small>Kreski na kartce: ${teammate.notebook?.strokes?.length || 0}</small></div>`, true)}
            </div>
            <div class="dm-character-panel" data-dm-character-panel="inventory">
              ${section('Ekwipunek', `${inventoryRows}<section class="inventory-add-card"><button class="inventory-add-trigger" type="button" data-dm-open-inventory><span class="inventory-icon add">+</span><span><strong>Dodaj przedmiot</strong><small>Dodaj przedmiot jako DM</small></span></button><form class="inventory-item-form dm-inventory-add-form hidden" data-dm-add-inventory><label><span>Nazwa przedmiotu</span><input name="name" maxlength="150" required></label><label><span>Ilość</span><input name="quantity" type="number" min="1" max="9999" value="1" required></label>${inventoryDurationControl()}${inventoryIconPicker()}<div class="dm-form-actions"><button type="button" class="secondary small" data-cancel-dm-inventory>Anuluj</button><button type="submit" class="small">Dodaj do ekwipunku</button></div></form></section>`, true)}
            </div>
            <div class="dm-character-panel" data-dm-character-panel="notes">
              <label class="dm-note-field general"><span>Prywatne notatki DM o tej postaci</span><textarea data-dm-character-note maxlength="50000" placeholder="Twoje prywatne notatki…">${escapeHtml(teammate.dmNote)}</textarea></label>
            </div>
            <div class="dm-character-panel" data-dm-character-panel="threads"><div class="empty-state"><h3>Wątki i sekrety</h3><p>Ten moduł zostanie dodany w kolejnym etapie rozwoju Panelu DM.</p></div></div>
          `;
          const setCharacterTab = (tab) => {
            target
              .querySelectorAll('[data-dm-character-tab]')
              .forEach((button) => button.classList.toggle('active', button.dataset.dmCharacterTab === tab));
            target
              .querySelectorAll('[data-dm-character-panel]')
              .forEach((panel) => panel.classList.toggle('active', panel.dataset.dmCharacterPanel === tab));
            target.scrollTop = 0;
          };
          target.querySelectorAll('[data-dm-character-tab]').forEach((button) => {
            button.addEventListener('click', () => setCharacterTab(button.dataset.dmCharacterTab));
          });
          setCharacterTab(initialTab);
          bindDmCharacterCard(target, teammate, campaignId, member.id);
        } catch {
          target.innerHTML = '<div class="empty-state"><p>Nie udało się pobrać pełnej karty postaci.</p></div>';
        }
      }

      async function openDmPanel(campaignId, campaignName, initialSection = 'dashboard') {
        characterTabs?.classList.add('hidden');
        if (headerIdentity) {
          headerIdentity.innerHTML = `
            <div>
              <p class="eyebrow">Mistrz Gry</p>
              <h2>Panel DM <span class="header-race">(${escapeHtml(campaignName)})</span></h2>
            </div>`;
        }
        if (headerAction) headerAction.innerHTML = '<button id="dm-panel-back" class="secondary small">Wróć</button>';
        contentPanel.innerHTML = `
          <div class="dm-panel-screen dm-panel-main dm-workspace">
            <nav class="dm-panel-tabs" aria-label="Sekcje Panelu DM">
              <button class="secondary" data-dm-section="dashboard"><span aria-hidden="true">⌂</span><span>Pulpit</span></button>
              <button class="secondary" data-dm-section="team"><span aria-hidden="true">♟</span><span>Drużyna</span></button>
              <button class="secondary" data-dm-section="campaign"><span aria-hidden="true">◇</span><span>Kampania</span></button>
              <button class="secondary" data-dm-section="materials"><span aria-hidden="true">▧</span><span>Materiały</span></button>
              <button class="secondary" data-dm-section="settings"><span aria-hidden="true">⚙</span><span>Ustawienia</span></button>
            </nav>
            <div id="dm-panel-content" tabindex="-1"><p class="loading-copy">Pobieranie Panelu DM…</p></div>
            <div class="dm-quick-actions">
              <button type="button" class="dm-floating-action" aria-expanded="false" aria-controls="dm-quick-menu" title="Szybkie działania">+</button>
              <div id="dm-quick-menu" class="dm-quick-menu hidden">
                <button type="button" data-dm-quick="note">Szybka notatka</button>
                <button type="button" data-dm-quick="npcs">Nowy NPC</button>
                <button type="button" data-dm-quick="quests">Nowe zadanie</button>
                <button type="button" data-dm-quick="materials">Nowy materiał</button>
              </div>
            </div>
          </div>`;
        headerAction?.querySelector('#dm-panel-back')?.addEventListener('click', () => showCharacter(character));
        const target = document.querySelector('#dm-panel-content');
        const formatDate = (value) => (value ? new Date(value).toLocaleDateString('pl-PL') : 'Brak');
        let generalNoteTimer;
        const loadDashboard = async () => {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/dashboard`);
          if (!response.ok) throw new Error('dm_dashboard_load_failed');
          const dashboard = await response.json();
          target.innerHTML = `
            <section class="dm-dashboard-header">
              ${dashboard.campaign.image ? `<img class="dm-campaign-image" src="${escapeHtml(dashboard.campaign.image)}" alt="Grafika kampanii ${escapeHtml(dashboard.campaign.name)}">` : '<div class="dm-campaign-image" aria-hidden="true">D&amp;D</div>'}
              <div><p class="eyebrow">Pulpit kampanii</p><h3>${escapeHtml(dashboard.campaign.name)}</h3><p>${dashboard.memberCount} ${dashboard.memberCount === 1 ? 'członek' : 'członków'} drużyny</p></div>
            </section>
            <section><div class="section-heading"><div><p class="eyebrow">Drużyna</p><h3>Szybki podgląd</h3></div><button class="secondary small" data-dm-section-link="team">Zobacz całą</button></div>
              <div class="dm-dashboard-team">${dashboard.members.length ? dashboard.members.map((item) => `<button type="button" class="dm-dashboard-member" data-dm-member="${item.id}">${avatarMarkup(item.avatar, item.name, 'friend-avatar')}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.user.username)} • ${escapeHtml(item.race || 'brak rasy')} • ${escapeHtml(item.classes || 'brak klasy')} • poz. ${item.level}</small></span>${item.hasDmNote ? '<span class="dm-note-indicator" title="Ma prywatną notatkę DM">●</span>' : ''}</button>`).join('') : '<div class="empty-state"><p>W kampanii nie ma jeszcze przypisanych postaci.</p></div>'}</div>
            </section>
            <section><div class="section-heading"><div><p class="eyebrow">Stan kampanii</p><h3>Najważniejsze obszary</h3></div></div>
              <div class="dm-status-grid">
                <button data-dm-section-link="campaign"><strong>Aktywne zadania</strong><span>${dashboard.counts?.activeQuests || 0}</span></button>
                <button data-dm-section-link="campaign"><strong>Otwarte wątki</strong><span>${dashboard.counts?.activeThreads || 0}</span></button>
                <button data-dm-section-link="team"><strong>Notatki DM</strong><span>${dashboard.lastNoteUpdate ? `Ostatnia zmiana ${formatDate(dashboard.lastNoteUpdate)}` : 'Brak zapisanych notatek'}</span></button>
                <button data-dm-section-link="campaign"><strong>NPC kampanii</strong><span>${dashboard.counts?.npcs || 0}</span></button>
              </div>
            </section>`;
          target.querySelectorAll('[data-dm-member]').forEach((button) => {
            const selected = dashboard.members.find((item) => item.id === Number(button.dataset.dmMember));
            button.addEventListener('click', () => showDmCharacter(campaignId, campaignName, selected));
          });
        };
        const loadTeam = async () => {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm`);
          if (!response.ok) throw new Error('dm_team_load_failed');
          const panel = await response.json();
          target.innerHTML = `
            <section class="dm-team-section"><div class="section-heading"><div><p class="eyebrow">Drużyna</p><h3>${panel.members.length} ${panel.members.length === 1 ? 'postać' : 'postaci'}</h3></div></div>
              <div class="dm-member-list">${panel.members.length ? panel.members.map((item) => `<button type="button" class="dm-member-card" data-dm-member="${item.id}">${avatarMarkup(item.avatar, item.name, 'friend-avatar')}<span><strong>${escapeHtml(item.name)}</strong><small>Gracz: ${escapeHtml(item.user.username)}<br>${escapeHtml(item.race || 'Brak rasy')} • ${escapeHtml(item.classes || 'Brak klasy')} • poziom ${item.level}</small>${item.dmNote ? `<em>${escapeHtml(item.dmNote.slice(0, 100))}${item.dmNote.length > 100 ? '…' : ''}</em>` : ''}</span><span aria-hidden="true">›</span></button>`).join('') : '<div class="empty-state"><p>Brak członków drużyny.</p></div>'}</div>
            </section>
            <label class="dm-note-field general"><span>Ogólna prywatna notatka DM</span><textarea data-dm-general-note maxlength="50000" placeholder="Miejsca, wydarzenia i plany kampanii…">${escapeHtml(panel.generalNote)}</textarea><small data-dm-note-status>Zmiany zapisują się automatycznie.</small></label>`;
          target.querySelectorAll('[data-dm-member]').forEach((button) => {
            const selected = panel.members.find((item) => item.id === Number(button.dataset.dmMember));
            button.addEventListener('click', () => showDmCharacter(campaignId, campaignName, selected));
          });
          target.querySelector('[data-dm-general-note]')?.addEventListener('input', (event) => {
            const status = target.querySelector('[data-dm-note-status]');
            if (status) status.textContent = 'Zapisywanie…';
            window.clearTimeout(generalNoteTimer);
            generalNoteTimer = window.setTimeout(async () => {
              try {
                const saveResponse = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/note`, {
                  method: 'PUT',
                  body: JSON.stringify({ content: event.target.value }),
                });
                if (!saveResponse.ok) throw new Error('dm_note_save_failed');
                if (status) status.textContent = 'Zapisano.';
              } catch {
                if (status) status.textContent = 'Nie udało się zapisać. Spróbuj ponownie.';
              }
            }, 500);
          });
        };
        const noteCategories = [
          'Pomysły',
          'Przygotowanie kampanii',
          'Fabuła',
          'Gracze',
          'Zasady własne',
          'Luźne',
          'Archiwum',
        ];
        const loadNotes = async () => {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/notes`);
          if (!response.ok) throw new Error('dm_notes_load_failed');
          const notes = await response.json();
          target.innerHTML = `
            ${campaignSubnav('notes')}
            <div class="dm-module-toolbar"><div><p class="eyebrow">Kampania</p><h3>Notatki DM</h3></div><button type="button" data-new-dm-note>+ Nowa notatka</button></div>
            <div class="dm-notes-layout"><div class="dm-record-list">${notes.length ? notes.map((note) => `<button type="button" class="dm-record-card${note.is_pinned ? ' pinned' : ''}" data-dm-note-id="${note.id}"><strong>${escapeHtml(note.title)}</strong><small>${escapeHtml(note.category)} • ${formatDate(note.updated_at)}</small></button>`).join('') : '<div class="empty-state"><p>Nie masz jeszcze uporządkowanych notatek.</p></div>'}</div><div class="dm-note-editor"><div class="empty-state"><p>Wybierz notatkę albo utwórz nową.</p></div></div></div>`;
          bindCampaignSubnav();
          const editor = target.querySelector('.dm-note-editor');
          const openEditor = (note = null) => {
            editor.innerHTML = `<form class="dm-workspace-form" data-dm-note-form>
              <label><span>Tytuł</span><input name="title" maxlength="200" value="${escapeHtml(note?.title || '')}" required></label>
              <div class="dm-form-row"><label><span>Kategoria</span><select name="category">${noteCategories.map((category) => `<option${(note?.category || 'Luźne') === category ? ' selected' : ''}>${category}</option>`).join('')}</select></label><label><span>Tagi, po przecinku</span><input name="tags" value="${escapeHtml((note?.tags || []).join(', '))}"></label></div>
              <label class="dm-check-row"><input type="checkbox" name="isPinned"${note?.is_pinned ? ' checked' : ''}><span>Przypnij notatkę</span></label>
              <label class="dm-grow-field"><span>Treść</span><textarea name="content" maxlength="50000">${escapeHtml(note?.content || '')}</textarea></label>
              <div class="dm-form-actions"><small data-save-state>${note ? 'Zmiany zapisują się automatycznie.' : 'Uzupełnij tytuł i treść.'}</small>${note ? '<button type="button" class="danger small" data-archive-note>Archiwizuj</button>' : '<div class="dm-form-actions"><button type="button" class="secondary" data-cancel-note>Anuluj</button><button type="submit">Utwórz notatkę</button></div>'}</div>
            </form>`;
            const form = editor.querySelector('[data-dm-note-form]');
            if (!note) {
              form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const data = new FormData(form);
                const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/notes`, {
                  method: 'POST',
                  body: JSON.stringify({
                    title: data.get('title'),
                    content: data.get('content'),
                    category: data.get('category'),
                    tags: String(data.get('tags') || '')
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                    isPinned: data.get('isPinned') === 'on',
                  }),
                });
                if (!result.ok) return window.alert('Nie udało się utworzyć notatki.');
                await loadNotes();
              });
              form.querySelector('[data-cancel-note]')?.addEventListener('click', () => {
                editor.innerHTML = '<div class="empty-state"><p>Wybierz notatkę albo utwórz nową.</p></div>';
              });
              form.querySelector('input[name="title"]')?.focus();
              return;
            }
            let saveTimer;
            form.addEventListener('input', () => {
              const state = form.querySelector('[data-save-state]');
              state.textContent = 'Zapisywanie…';
              window.clearTimeout(saveTimer);
              saveTimer = window.setTimeout(async () => {
                const data = new FormData(form);
                const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/notes/${note.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    title: data.get('title'),
                    content: data.get('content'),
                    category: data.get('category'),
                    tags: String(data.get('tags') || '')
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                    isPinned: data.get('isPinned') === 'on',
                  }),
                });
                state.textContent = result.ok ? 'Zapisano.' : 'Błąd zapisu.';
              }, 700);
            });
            form.querySelector('[data-archive-note]')?.addEventListener('click', async () => {
              if (!window.confirm('Przenieść tę notatkę do archiwum?')) return;
              const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/notes/${note.id}`, {
                method: 'DELETE',
              });
              if (result.ok) await loadNotes();
            });
          };
          target.querySelector('[data-new-dm-note]')?.addEventListener('click', () => openEditor());
          target
            .querySelectorAll('[data-dm-note-id]')
            .forEach((button) =>
              button.addEventListener('click', () =>
                openEditor(notes.find((note) => Number(note.id) === Number(button.dataset.dmNoteId))),
              ),
            );
        };
        const loadSessionDetails = async (sessionId) => {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/sessions/${sessionId}`);
          if (!response.ok) throw new Error('dm_session_load_failed');
          const session = await response.json();
          const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 16) : '');
          target.innerHTML = `<div class="dm-module-toolbar"><button type="button" class="secondary" data-back-sessions>← Sesje</button><div><p class="eyebrow">Sesja ${session.number}</p><h3>${escapeHtml(session.title)}</h3></div></div>
            <form class="dm-workspace-form" data-session-editor>
              <div class="dm-form-row"><label><span>Tytuł</span><input name="title" maxlength="200" value="${escapeHtml(session.title)}" required></label><label><span>Status</span><select name="status">${[
                ['planned', 'Planowana'],
                ['active', 'W trakcie'],
                ['completed', 'Zakończona'],
                ['cancelled', 'Anulowana'],
              ]
                .map(
                  ([value, label]) =>
                    `<option value="${value}"${session.status === value ? ' selected' : ''}>${label}</option>`,
                )
                .join('')}</select></label></div>
              <div class="dm-form-row"><label><span>Planowana data</span><input name="plannedAt" type="datetime-local" value="${dateInput(session.planned_at)}"></label><label><span>Faktyczna data</span><input name="actualAt" type="datetime-local" value="${dateInput(session.actual_at)}"></label></div>
              <div class="dm-session-columns"><label><span>Plan DM</span><textarea name="plan" maxlength="50000">${escapeHtml(session.plan)}</textarea></label><label><span>Notatki na żywo</span><textarea name="liveNotes" maxlength="50000">${escapeHtml(session.live_notes)}</textarea></label><label><span>Podsumowanie robocze</span><textarea name="summary" maxlength="10000">${escapeHtml(session.summary)}</textarea></label><label><span>Podsumowanie dla graczy</span><textarea name="publicSummary" maxlength="10000">${escapeHtml(session.public_summary)}</textarea></label><label><span>Prywatne podsumowanie DM</span><textarea name="privateSummary" maxlength="10000">${escapeHtml(session.private_summary)}</textarea></label><label><span>Możliwe nagrody</span><textarea name="rewards" maxlength="10000">${escapeHtml(session.rewards)}</textarea></label></div>
              <div class="dm-form-actions"><small data-session-save-state>Zmiany zapisują się automatycznie.</small></div>
            </form>
            <section><div class="dm-module-toolbar"><h3>Sceny</h3><button type="button" class="small" data-add-scene>+ Scena</button></div><div class="dm-record-list">${session.scenes.length ? session.scenes.map((scene, index) => `<article class="dm-scene-row"><div><strong>${escapeHtml(scene.title)}</strong><small>${escapeHtml(scene.description || '')}</small></div><select data-scene-status="${scene.id}"><option value="planned"${scene.status === 'planned' ? ' selected' : ''}>Planowana</option><option value="completed"${scene.status === 'completed' ? ' selected' : ''}>Zrealizowana</option><option value="skipped"${scene.status === 'skipped' ? ' selected' : ''}>Pominięta</option><option value="moved"${scene.status === 'moved' ? ' selected' : ''}>Przeniesiona</option></select><div><button class="small secondary" data-scene-up="${scene.id}"${index === 0 ? ' disabled' : ''}>↑</button><button class="small secondary" data-scene-down="${scene.id}"${index === session.scenes.length - 1 ? ' disabled' : ''}>↓</button></div></article>`).join('') : '<div class="empty-state"><p>Brak scen w planie.</p></div>'}</div></section>
            <section><div class="dm-module-toolbar"><h3>Wydarzenia</h3><button type="button" class="small" data-add-event>+ Wydarzenie</button></div><div class="dm-record-list">${session.events.length ? session.events.map((event) => `<article class="dm-record-card"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.event_type)} • ${new Date(event.created_at).toLocaleString('pl-PL')}</small><p>${escapeHtml(event.content)}</p></article>`).join('') : '<div class="empty-state"><p>Brak zapisanych wydarzeń.</p></div>'}</div></section>`;
          target.querySelector('[data-back-sessions]')?.addEventListener('click', () => loadSessions());
          const editor = target.querySelector('[data-session-editor]');
          let timer;
          editor.addEventListener('input', () => {
            const state = editor.querySelector('[data-session-save-state]');
            state.textContent = 'Zapisywanie…';
            window.clearTimeout(timer);
            timer = window.setTimeout(async () => {
              const data = new FormData(editor);
              const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/sessions/${session.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  number: session.number,
                  title: data.get('title'),
                  status: data.get('status'),
                  plannedAt: data.get('plannedAt') || null,
                  actualAt: data.get('actualAt') || null,
                  participants: session.participants,
                  summary: data.get('summary'),
                  publicSummary: data.get('publicSummary'),
                  privateSummary: data.get('privateSummary'),
                  plan: data.get('plan'),
                  liveNotes: data.get('liveNotes'),
                  rewards: data.get('rewards'),
                  checklist: session.checklist,
                }),
              });
              state.textContent = result.ok ? 'Zapisano.' : 'Błąd zapisu.';
            }, 700);
          });
          target.querySelector('[data-add-scene]')?.addEventListener('click', async () => {
            const title = window.prompt('Tytuł sceny:');
            if (!title) return;
            const description = window.prompt('Krótki opis sceny:') || '';
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/sessions/${session.id}/scenes`, {
              method: 'POST',
              body: JSON.stringify({ title, description }),
            });
            if (result.ok) await loadSessionDetails(session.id);
          });
          const updateSceneRecord = async (scene, updates) =>
            authenticatedFetch(`/api/campaigns/${campaignId}/dm/sessions/${session.id}/scenes/${scene.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                title: scene.title,
                description: scene.description,
                status: updates.status ?? scene.status,
                sortOrder: updates.sortOrder ?? scene.sort_order,
                relations: scene.relations,
              }),
            });
          target.querySelectorAll('[data-scene-status]').forEach((select) =>
            select.addEventListener('change', async () => {
              const scene = session.scenes.find((item) => Number(item.id) === Number(select.dataset.sceneStatus));
              await updateSceneRecord(scene, { status: select.value });
            }),
          );
          const moveScene = async (id, direction) => {
            const index = session.scenes.findIndex((item) => Number(item.id) === Number(id));
            const other = session.scenes[index + direction];
            if (!other) return;
            await Promise.all([
              updateSceneRecord(session.scenes[index], { sortOrder: other.sort_order }),
              updateSceneRecord(other, { sortOrder: session.scenes[index].sort_order }),
            ]);
            await loadSessionDetails(session.id);
          };
          target
            .querySelectorAll('[data-scene-up]')
            .forEach((button) => button.addEventListener('click', () => moveScene(button.dataset.sceneUp, -1)));
          target
            .querySelectorAll('[data-scene-down]')
            .forEach((button) => button.addEventListener('click', () => moveScene(button.dataset.sceneDown, 1)));
          target.querySelector('[data-add-event]')?.addEventListener('click', async () => {
            const title = window.prompt('Tytuł wydarzenia:');
            if (!title) return;
            const content = window.prompt('Opis wydarzenia:') || '';
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/sessions/${session.id}/events`, {
              method: 'POST',
              body: JSON.stringify({ eventType: 'custom', title, content, visibility: 'dm' }),
            });
            if (result.ok) await loadSessionDetails(session.id);
          });
        };
        const loadSessions = async () => {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/sessions`);
          if (!response.ok) throw new Error('dm_sessions_load_failed');
          const sessions = await response.json();
          target.innerHTML = `<div class="dm-module-toolbar"><div><p class="eyebrow">Prawdziwa gra przy stole</p><h3>Sesje</h3></div><button type="button" data-create-session>+ Nowa sesja</button></div><div class="dm-record-list">${sessions.length ? sessions.map((session) => `<button type="button" class="dm-record-card" data-session-id="${session.id}"><strong>#${session.number} ${escapeHtml(session.title)}</strong><small>${escapeHtml(session.status)} • ${formatDate(session.planned_at || session.actual_at)}</small><p>${escapeHtml(session.summary || 'Brak podsumowania')}</p></button>`).join('') : '<div class="empty-state"><p>Nie zaplanowano jeszcze żadnej sesji.</p></div>'}</div>`;
          target.querySelector('[data-create-session]')?.addEventListener('click', async () => {
            const title = window.prompt('Tytuł sesji:');
            if (!title) return;
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/sessions`, {
              method: 'POST',
              body: JSON.stringify({ title, number: (sessions[0]?.number || 0) + 1 }),
            });
            if (result.ok) await loadSessionDetails((await result.json()).id);
          });
          target
            .querySelectorAll('[data-session-id]')
            .forEach((button) =>
              button.addEventListener('click', () => loadSessionDetails(Number(button.dataset.sessionId))),
            );
        };
        const campaignModules = {
          quests: {
            title: 'Zadania',
            singular: 'zadanie',
            statuses: [
              ['prepared', 'Przygotowane'],
              ['available', 'Dostępne'],
              ['active', 'Aktywne'],
              ['paused', 'Wstrzymane'],
              ['completed', 'Ukończone'],
              ['failed', 'Nieudane'],
              ['hidden', 'Ukryte'],
            ],
            fields: [
              ['mainGoal', 'Cel główny'],
              ['commissioner', 'Zleceniodawca'],
              ['relatedNpcs', 'Powiązani NPC'],
              ['relatedLocations', 'Powiązane lokacje'],
              ['rewards', 'Nagrody'],
              ['resolution', 'Prywatne rozwiązanie'],
            ],
          },
          npcs: {
            title: 'NPC',
            singular: 'NPC',
            statuses: [
              ['active', 'Aktywny'],
              ['missing', 'Zaginiony'],
              ['dead', 'Martwy'],
              ['unknown', 'Nieznany'],
            ],
            fields: [
              ['appearance', 'Wygląd'],
              ['personality', 'Charakter i sposób mówienia'],
              ['role', 'Rola'],
              ['faction', 'Frakcja'],
              ['location', 'Aktualna lokacja'],
              ['attitudeToParty', 'Stosunek do drużyny'],
              ['goals', 'Cele'],
              ['secrets', 'Cele i sekrety'],
              ['relations', 'Relacje i historia spotkań'],
            ],
          },
          locations: {
            title: 'Lokacje',
            singular: 'lokację',
            statuses: [],
            fields: [
              ['locationType', 'Typ lokacji'],
              ['parentName', 'Lokacja nadrzędna'],
              ['relatedNpcs', 'NPC'],
              ['relatedQuests', 'Zadania i wątki'],
              ['secrets', 'Sekrety'],
              ['history', 'Historia wydarzeń'],
              ['materials', 'Materiały'],
            ],
          },
          factions: {
            title: 'Frakcje',
            singular: 'frakcję',
            statuses: [],
            fields: [
              ['attitude', 'Stosunek do drużyny'],
              ['goals', 'Cele'],
              ['leader', 'Przywódca i członkowie'],
              ['headquarters', 'Siedziba'],
              ['allies', 'Sojusznicy'],
              ['enemies', 'Przeciwnicy'],
              ['plans', 'Prywatne plany'],
            ],
          },
          threads: {
            title: 'Wątki',
            singular: 'wątek',
            statuses: [
              ['idea', 'Pomysł'],
              ['prepared', 'Przygotowany'],
              ['active', 'Aktywny'],
              ['paused', 'Zawieszony'],
              ['resolved', 'Rozwiązany'],
              ['abandoned', 'Porzucony'],
            ],
            fields: [
              ['priority', 'Priorytet'],
              ['characters', 'Postacie'],
              ['npcs', 'NPC'],
              ['locations', 'Lokacje'],
              ['factions', 'Frakcje'],
              ['plannedDevelopments', 'Planowane rozwinięcia'],
              ['discoveredInformation', 'Informacje odkryte przez graczy'],
            ],
          },
        };
        const loadCampaignModule = async (module) => {
          if (module === 'notes') return loadNotes();
          if (module === 'secrets') return loadSecrets();
          const config = campaignModules[module];
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/content/${module}`);
          if (!response.ok) throw new Error('dm_content_load_failed');
          const records = await response.json();
          target.innerHTML = `${campaignSubnav(module)}<div class="dm-module-toolbar"><h3>${config.title}</h3><button type="button" data-new-record>+ Dodaj</button></div><div class="dm-content-layout"><div class="dm-record-list">${records.length ? records.map((record) => `<button type="button" class="dm-record-card" data-record-id="${record.id}"><strong>${escapeHtml(record.name || record.title)}</strong><small>${escapeHtml(record.status || record.visibility || '')} • ${formatDate(record.updated_at)}</small></button>`).join('') : '<div class="empty-state"><p>Brak wpisów.</p></div>'}</div><div class="dm-record-editor"><div class="empty-state"><p>Wybierz wpis albo dodaj nowy.</p></div></div></div>`;
          bindCampaignSubnav();
          const editor = target.querySelector('.dm-record-editor');
          const openRecord = async (record = null) => {
            const extraFields = (config.fields || [])
              .map(
                ([key, label]) =>
                  `<label><span>${label}</span><textarea data-extra-field="${key}" maxlength="5000">${escapeHtml(record?.data?.[key] || record?.[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] || '')}</textarea></label>`,
              )
              .join('');
            editor.innerHTML = `<form class="dm-workspace-form" data-record-form><label><span>Nazwa</span><input name="name" maxlength="200" value="${escapeHtml(record?.name || record?.title || '')}" required></label>${config.statuses.length ? `<label><span>Status</span><select name="status">${config.statuses.map(([value, label]) => `<option value="${value}"${record?.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}<label><span>Opis dla graczy</span><textarea name="publicContent" maxlength="10000">${escapeHtml(record?.public_content || '')}</textarea></label><label><span>Prywatne informacje DM</span><textarea name="privateContent" maxlength="20000">${escapeHtml(record?.private_content || '')}</textarea></label>${extraFields}<label><span>Widoczność</span><select name="visibility"><option value="dm">Tylko DM</option><option value="party"${record?.visibility === 'party' ? ' selected' : ''}>Cała drużyna</option></select></label><div class="dm-form-actions"><button type="button" class="secondary" data-cancel-record>Anuluj</button><button type="submit">${record ? 'Zapisz' : 'Utwórz'}</button>${record ? '<button type="button" class="danger" data-archive-record>Archiwizuj</button>' : ''}</div></form>`;
            const form = editor.querySelector('[data-record-form]');
            form.querySelector('[data-cancel-record]')?.addEventListener('click', () => {
              editor.innerHTML = '<div class="empty-state"><p>Wybierz wpis albo dodaj nowy.</p></div>';
            });
            form.addEventListener('submit', async (event) => {
              event.preventDefault();
              const data = new FormData(form);
              const extraData = Object.fromEntries(
                [...form.querySelectorAll('[data-extra-field]')].map((field) => [
                  field.dataset.extraField,
                  field.value,
                ]),
              );
              const path = `/api/campaigns/${campaignId}/dm/content/${module}${record ? `/${record.id}` : ''}`;
              const result = await authenticatedFetch(path, {
                method: record ? 'PUT' : 'POST',
                body: JSON.stringify({
                  name: data.get('name'),
                  title: data.get('name'),
                  status: data.get('status'),
                  publicContent: data.get('publicContent'),
                  privateContent: data.get('privateContent'),
                  visibility: data.get('visibility'),
                  data: { ...(record?.data || {}), ...extraData },
                  locationType: extraData.locationType,
                  attitude: extraData.attitude,
                  priority: extraData.priority,
                }),
              });
              if (result.ok) await loadCampaignModule(module);
              else window.alert('Nie udało się zapisać wpisu.');
            });
            form.querySelector('[data-archive-record]')?.addEventListener('click', async () => {
              if (!window.confirm('Zarchiwizować ten wpis?')) return;
              const result = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/content/${module}/${record.id}`,
                { method: 'DELETE' },
              );
              if (result.ok) await loadCampaignModule(module);
            });
            if (module === 'quests' && record) {
              const stepsResponse = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/quests/${record.id}/steps`,
              );
              const steps = stepsResponse.ok ? await stepsResponse.json() : [];
              form.insertAdjacentHTML(
                'afterend',
                `<section class="dm-workspace-form"><div class="dm-module-toolbar"><h4>Etapy zadania</h4><button type="button" class="small" data-add-quest-step>+ Etap</button></div><div class="dm-record-list">${steps.map((step) => `<article class="dm-member-role"><label class="dm-check-row"><input type="checkbox" data-toggle-quest-step="${step.id}"${step.is_completed ? ' checked' : ''}><span>${escapeHtml(step.title)}</span></label><button type="button" class="danger small" data-delete-quest-step="${step.id}">Usuń</button></article>`).join('') || '<p class="section-note">Brak etapów.</p>'}</div></section>`,
              );
              editor.querySelector('[data-add-quest-step]')?.addEventListener('click', async () => {
                const title = window.prompt('Nazwa etapu:');
                if (!title) return;
                const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/quests/${record.id}/steps`, {
                  method: 'POST',
                  body: JSON.stringify({ title }),
                });
                if (result.ok) await openRecord(record);
              });
              editor.querySelectorAll('[data-toggle-quest-step]').forEach((checkbox) =>
                checkbox.addEventListener('change', async () => {
                  const step = steps.find((item) => Number(item.id) === Number(checkbox.dataset.toggleQuestStep));
                  await authenticatedFetch(`/api/campaigns/${campaignId}/dm/quests/${record.id}/steps/${step.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                      title: step.title,
                      isCompleted: checkbox.checked,
                      sortOrder: step.sort_order,
                    }),
                  });
                }),
              );
              editor.querySelectorAll('[data-delete-quest-step]').forEach((button) =>
                button.addEventListener('click', async () => {
                  const result = await authenticatedFetch(
                    `/api/campaigns/${campaignId}/dm/quests/${record.id}/steps/${button.dataset.deleteQuestStep}`,
                    { method: 'DELETE' },
                  );
                  if (result.ok) await openRecord(record);
                }),
              );
            }
          };
          target.querySelector('[data-new-record]')?.addEventListener('click', () => openRecord());
          target
            .querySelectorAll('[data-record-id]')
            .forEach((button) =>
              button.addEventListener('click', () =>
                openRecord(records.find((record) => Number(record.id) === Number(button.dataset.recordId))),
              ),
            );
        };
        const campaignSubnav = (active) =>
          `<div class="dm-subnav">${[
            ['quests', 'Zadania'],
            ['npcs', 'NPC'],
            ['locations', 'Lokacje'],
            ['factions', 'Frakcje'],
            ['threads', 'Wątki'],
            ['secrets', 'Sekrety'],
            ['notes', 'Notatki'],
          ]
            .map(
              ([key, label]) =>
                `<button type="button" class="secondary${active === key ? ' active' : ''}" data-campaign-module="${key}">${label}</button>`,
            )
            .join('')}</div>`;
        const bindCampaignSubnav = () =>
          target
            .querySelectorAll('[data-campaign-module]')
            .forEach((button) =>
              button.addEventListener('click', () => loadCampaignModule(button.dataset.campaignModule)),
            );
        const loadSecrets = async () => {
          const [secretResponse, teamResponse] = await Promise.all([
            authenticatedFetch(`/api/campaigns/${campaignId}/dm/secrets`),
            authenticatedFetch(`/api/campaigns/${campaignId}/dm`),
          ]);
          if (!secretResponse.ok || !teamResponse.ok) throw new Error('dm_secrets_load_failed');
          const secrets = await secretResponse.json();
          const team = await teamResponse.json();
          target.innerHTML = `${campaignSubnav('secrets')}<div class="dm-module-toolbar"><h3>Sekrety i wskazówki</h3><button data-new-secret>+ Dodaj</button></div><div class="dm-record-list">${secrets.map((secret) => `<article class="dm-record-card"><strong>${escapeHtml(secret.title)}</strong><small>${escapeHtml(secret.secret_type)} • ${escapeHtml(secret.discovery_status)}</small><p>${escapeHtml(secret.content)}</p><div class="dm-form-actions"><button class="small" data-reveal-secret="${secret.id}">Ujawnij…</button><button class="small secondary" data-edit-secret="${secret.id}">Edytuj</button><button class="small danger" data-archive-secret="${secret.id}">Archiwizuj</button></div></article>`).join('') || '<div class="empty-state"><p>Brak sekretów.</p></div>'}</div>`;
          bindCampaignSubnav();
          target.querySelector('[data-new-secret]')?.addEventListener('click', async () => {
            const title = window.prompt('Tytuł sekretu:');
            if (!title) return;
            const content = window.prompt('Treść sekretu:') || '';
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/secrets`, {
              method: 'POST',
              body: JSON.stringify({ title, content }),
            });
            if (result.ok) await loadSecrets();
          });
          target.querySelectorAll('[data-edit-secret]').forEach((button) =>
            button.addEventListener('click', async () => {
              const secret = secrets.find((item) => Number(item.id) === Number(button.dataset.editSecret));
              const title = window.prompt('Tytuł sekretu:', secret.title);
              if (!title) return;
              const content = window.prompt('Treść sekretu:', secret.content) ?? secret.content;
              const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/secrets/${secret.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  title,
                  content,
                  secretType: secret.secret_type,
                  discoveryStatus: secret.discovery_status,
                }),
              });
              if (result.ok) await loadSecrets();
            }),
          );
          target.querySelectorAll('[data-archive-secret]').forEach((button) =>
            button.addEventListener('click', async () => {
              if (!window.confirm('Zarchiwizować sekret?')) return;
              const result = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/secrets/${button.dataset.archiveSecret}`,
                { method: 'DELETE' },
              );
              if (result.ok) await loadSecrets();
            }),
          );
          target.querySelectorAll('[data-reveal-secret]').forEach((button) =>
            button.addEventListener('click', async () => {
              const names = team.members.map((member, index) => `${index + 1}. ${member.name}`).join('\n');
              const choice = window.prompt(`Podaj numery odbiorców oddzielone przecinkami:\n${names}`);
              if (!choice) return;
              const characterIds = choice
                .split(',')
                .map((entry) => team.members[Number(entry.trim()) - 1]?.id)
                .filter(Boolean);
              if (!characterIds.length || !window.confirm('Na pewno ujawnić sekret wybranym postaciom?')) return;
              const result = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/secrets/${button.dataset.revealSecret}/reveal`,
                { method: 'POST', body: JSON.stringify({ characterIds, confirmed: true }) },
              );
              if (result.ok) await loadSecrets();
            }),
          );
        };
        const loadTimeline = async () => {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/timeline`);
          if (!response.ok) throw new Error('dm_timeline_load_failed');
          const events = await response.json();
          target.innerHTML = `${campaignSubnav('history')}<div class="dm-module-toolbar"><h3>Historia kampanii</h3><button data-new-timeline>+ Wydarzenie</button></div><div class="dm-timeline">${events.map((event) => `<article><time>${formatDate(event.occurred_at)}</time><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.event_type)}${event.world_date ? ` • ${escapeHtml(event.world_date)}` : ''}</small><p>${escapeHtml(event.content)}</p></div></article>`).join('') || '<div class="empty-state"><p>Historia jest jeszcze pusta.</p></div>'}</div>`;
          bindCampaignSubnav();
          target.querySelector('[data-new-timeline]')?.addEventListener('click', async () => {
            const title = window.prompt('Tytuł wydarzenia:');
            if (!title) return;
            const content = window.prompt('Opis:') || '';
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/timeline`, {
              method: 'POST',
              body: JSON.stringify({ title, content, visibility: 'dm' }),
            });
            if (result.ok) await loadTimeline();
          });
        };
        const loadMaterials = async () => {
          const [materialResponse, teamResponse] = await Promise.all([
            authenticatedFetch(`/api/campaigns/${campaignId}/dm/materials`),
            authenticatedFetch(`/api/campaigns/${campaignId}/dm`),
          ]);
          if (!materialResponse.ok || !teamResponse.ok) throw new Error('dm_materials_load_failed');
          const materials = await materialResponse.json();
          const team = await teamResponse.json();
          target.innerHTML = `<div class="dm-module-toolbar"><div><p class="eyebrow">Handouty</p><h3>Materiały</h3></div><button data-new-material>+ Materiał</button></div><div class="dm-material-grid">${materials.map((material) => `<article class="dm-material-card"><span>${escapeHtml(material.material_type)}</span><h4>${escapeHtml(material.title)}</h4><p>${escapeHtml(material.content.slice(0, 300))}</p>${material.external_url ? `<a href="${escapeHtml(material.external_url)}" target="_blank" rel="noopener noreferrer">Otwórz link</a>` : ''}<div class="dm-form-actions"><button class="small" data-share-material="${material.id}">Pokaż graczom…</button><button class="small secondary" data-edit-material="${material.id}">Edytuj</button><button class="small danger" data-archive-material="${material.id}">Archiwizuj</button></div></article>`).join('') || '<div class="empty-state"><p>Brak materiałów.</p></div>'}</div>`;
          target.querySelector('[data-new-material]')?.addEventListener('click', async () => {
            const title = window.prompt('Nazwa materiału:');
            if (!title) return;
            const content = window.prompt('Treść materiału:') || '';
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/materials`, {
              method: 'POST',
              body: JSON.stringify({ title, content, materialType: 'text', visibility: 'dm' }),
            });
            if (result.ok) await loadMaterials();
          });
          target.querySelectorAll('[data-edit-material]').forEach((button) =>
            button.addEventListener('click', async () => {
              const material = materials.find((item) => Number(item.id) === Number(button.dataset.editMaterial));
              const title = window.prompt('Nazwa materiału:', material.title);
              if (!title) return;
              const content = window.prompt('Treść materiału:', material.content) ?? material.content;
              const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/materials/${material.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  title,
                  content,
                  materialType: material.material_type,
                  externalUrl: material.external_url,
                  visibility: material.visibility,
                }),
              });
              if (result.ok) await loadMaterials();
            }),
          );
          target.querySelectorAll('[data-archive-material]').forEach((button) =>
            button.addEventListener('click', async () => {
              if (!window.confirm('Zarchiwizować materiał?')) return;
              const result = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/materials/${button.dataset.archiveMaterial}`,
                { method: 'DELETE' },
              );
              if (result.ok) await loadMaterials();
            }),
          );
          target.querySelectorAll('[data-share-material]').forEach((button) =>
            button.addEventListener('click', async () => {
              const names = team.members.map((member, index) => `${index + 1}. ${member.name}`).join('\n');
              const choice = window.prompt(`Podaj numery odbiorców oddzielone przecinkami:\n${names}`);
              if (!choice) return;
              const characterIds = choice
                .split(',')
                .map((entry) => team.members[Number(entry.trim()) - 1]?.id)
                .filter(Boolean);
              if (!characterIds.length || !window.confirm('Udostępnić materiał i wysłać powiadomienie?')) return;
              const result = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/materials/${button.dataset.shareMaterial}/share`,
                { method: 'POST', body: JSON.stringify({ characterIds, confirmed: true }) },
              );
              if (result.ok) window.alert('Materiał udostępniony.');
            }),
          );
        };
        const loadSettings = async () => {
          const response = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/settings`);
          if (!response.ok) throw new Error('dm_settings_load_failed');
          const settings = await response.json();
          const isOwner = settings.campaign.role === 'owner';
          target.innerHTML = `
            <div class="dm-module-toolbar"><div><p class="eyebrow">Panel DM</p><h3>Ustawienia kampanii</h3></div><button type="button" class="secondary" data-export-campaign>Eksportuj JSON</button></div>
            <form class="dm-workspace-form" data-campaign-settings>
              <label><span>Nazwa</span><input name="name" maxlength="100" value="${escapeHtml(settings.campaign.name)}" required${isOwner ? '' : ' disabled'}></label>
              <label><span>Opis</span><textarea name="description" maxlength="2000"${isOwner ? '' : ' disabled'}>${escapeHtml(settings.campaign.description || '')}</textarea></label>
              <label><span>Grafika kampanii</span><input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp"${isOwner ? '' : ' disabled'}></label>
              <div data-campaign-image-preview>${settings.campaign.image ? `<img class="dm-settings-image" src="${escapeHtml(settings.campaign.image)}" alt="Aktualna grafika kampanii">` : '<small>Brak grafiki kampanii.</small>'}</div>
              ${isOwner ? '<div class="dm-form-actions"><button type="reset" class="secondary">Anuluj zmiany</button><button type="submit">Zapisz ustawienia</button></div>' : '<p class="section-note">Ustawienia kampanii może zmienić wyłącznie właściciel.</p>'}
            </form>
            <section><h3>Role i członkowie</h3><div class="dm-record-list">${settings.members.map((member) => `<article class="dm-member-role"><span><strong>${escapeHtml(member.username)}</strong><small>${escapeHtml(member.character_name || 'Bez postaci')}</small></span>${Number(member.user_id) === Number(settings.campaign.owner_id) ? '<strong>Właściciel</strong>' : `<div class="dm-member-role-actions"><select data-member-role="${member.user_id}"${isOwner ? '' : ' disabled'}><option value="player">Gracz</option><option value="co_dm"${member.role === 'co_dm' ? ' selected' : ''}>Współprowadzący</option></select>${isOwner ? `<button type="button" class="danger small" data-remove-campaign-member="${member.user_id}">Usuń</button>` : ''}</div>`}</article>`).join('')}</div></section>
            ${isOwner ? '<button type="button" class="danger" data-archive-campaign>Archiwizuj kampanię</button>' : ''}`;
          const form = target.querySelector('[data-campaign-settings]');
          let campaignImage = settings.campaign.image || '';
          form.addEventListener('reset', () => {
            campaignImage = settings.campaign.image || '';
            window.requestAnimationFrame(() => {
              target.querySelector('[data-campaign-image-preview]').innerHTML = campaignImage
                ? `<img class="dm-settings-image" src="${escapeHtml(campaignImage)}" alt="Aktualna grafika kampanii">`
                : '<small>Brak grafiki kampanii.</small>';
            });
          });
          form.querySelector('input[name="imageFile"]')?.addEventListener('change', async (event) => {
            try {
              campaignImage = await prepareProfileImage(event.target.files?.[0]);
              target.querySelector('[data-campaign-image-preview]').innerHTML =
                `<img class="dm-settings-image" src="${campaignImage}" alt="Nowa grafika kampanii">`;
            } catch {
              event.target.value = '';
              window.alert('Nie udało się przygotować grafiki. Wybierz JPEG, PNG lub WebP do 15 MB.');
            }
          });
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const data = new FormData(form);
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/settings`, {
              method: 'PUT',
              body: JSON.stringify({
                name: data.get('name'),
                description: data.get('description'),
                image: campaignImage,
              }),
            });
            if (result.ok) window.alert('Ustawienia zapisane.');
            else window.alert('Tylko właściciel może zmieniać ustawienia.');
          });
          target.querySelectorAll('[data-member-role]').forEach((select) =>
            select.addEventListener('change', async () => {
              const result = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/members/${select.dataset.memberRole}/role`,
                { method: 'PUT', body: JSON.stringify({ role: select.value }) },
              );
              if (!result.ok) window.alert('Nie udało się zmienić roli.');
            }),
          );
          target.querySelectorAll('[data-remove-campaign-member]').forEach((button) =>
            button.addEventListener('click', async () => {
              if (!window.confirm('Usunąć tego członka z kampanii?')) return;
              const result = await authenticatedFetch(
                `/api/campaigns/${campaignId}/dm/members/${button.dataset.removeCampaignMember}`,
                { method: 'DELETE' },
              );
              if (result.ok) await loadSettings();
            }),
          );
          target.querySelector('[data-archive-campaign]')?.addEventListener('click', async () => {
            if (!window.confirm('Zarchiwizować kampanię? Zniknie z aktywnych drużyn, ale dane pozostaną w bazie.'))
              return;
            const result = await authenticatedFetch(`/api/campaigns/${campaignId}/dm/archive`, {
              method: 'POST',
              body: JSON.stringify({ confirmed: true }),
            });
            if (result.ok) showCharacter(character);
          });
          target.querySelector('[data-export-campaign]')?.addEventListener('click', (event) => {
            event.preventDefault();
            authenticatedFetch(`/api/campaigns/${campaignId}/dm/export`)
              .then((result) => result.json())
              .then((payload) => {
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `campaign-${campaignId}.json`;
                link.click();
                URL.revokeObjectURL(link.href);
              });
          });
        };
        const setSection = async (section) => {
          document
            .querySelectorAll('[data-dm-section]')
            .forEach((button) => button.classList.toggle('active', button.dataset.dmSection === section));
          target.innerHTML = '<p class="loading-copy">Pobieranie danych…</p>';
          try {
            if (section === 'dashboard') await loadDashboard();
            else if (section === 'team') await loadTeam();
            else if (section === 'campaign') await loadCampaignModule('quests');
            else if (section === 'materials') await loadMaterials();
            else await loadSettings();
            target
              .querySelectorAll('[data-dm-section-link]')
              .forEach((button) => button.addEventListener('click', () => setSection(button.dataset.dmSectionLink)));
            target.focus({ preventScroll: true });
          } catch {
            target.innerHTML =
              '<div class="empty-state"><h3>Nie udało się pobrać danych</h3><p>Sprawdź połączenie i spróbuj ponownie.</p><button type="button" class="secondary" data-dm-retry>Spróbuj ponownie</button></div>';
            target.querySelector('[data-dm-retry]')?.addEventListener('click', () => setSection(section));
          }
        };
        document
          .querySelectorAll('[data-dm-section]')
          .forEach((button) => button.addEventListener('click', () => setSection(button.dataset.dmSection)));
        const quickButton = document.querySelector('.dm-floating-action');
        const quickMenu = document.querySelector('#dm-quick-menu');
        quickButton?.addEventListener('click', () => {
          quickMenu?.classList.toggle('hidden');
          quickButton.setAttribute('aria-expanded', String(!quickMenu?.classList.contains('hidden')));
        });
        quickMenu?.querySelectorAll('[data-dm-quick]').forEach((button) =>
          button.addEventListener('click', async () => {
            quickMenu.classList.add('hidden');
            quickButton?.setAttribute('aria-expanded', 'false');
            if (button.dataset.dmQuick === 'note') {
              await setSection('campaign');
              await loadNotes();
            } else if (button.dataset.dmQuick === 'materials') await setSection('materials');
            else await setSection('campaign');
          }),
        );
        await setSection(initialSection);
      }

      async function loadCharacterTeams() {
        const teamContent = document.querySelector('#character-team-content');
        if (!teamContent) return;
        try {
          const response = await authenticatedFetch(`/api/characters/${character.id}/teams`);
          if (!response.ok) throw new Error('teams_load_failed');
          const campaigns = await response.json();
          teamContent.innerHTML = campaigns.length
            ? `<div class="character-team-list">${campaigns
                .map(
                  (campaign) => `
                <section class="character-team-campaign">
                  <div class="character-team-heading">
                    <h4>${escapeHtml(campaign.name)}${campaign.isDm ? ' <span class="dm-badge">DM</span>' : ''}</h4>
                    <div class="character-team-actions">
                      <button type="button" class="danger small" data-leave-campaign="${campaign.id}" data-campaign-name="${escapeHtml(campaign.name)}">Opuść kampanię</button>
                    </div>
                  </div>
                  <div class="character-team-members">
                    ${campaign.members
                      .map(
                        (member) => `
                      <button type="button" class="team-member${member.isCurrent ? ' current' : ''}" data-team-campaign="${campaign.id}" data-team-member="${member.id}">
                        ${avatarMarkup(member.avatar, member.name, 'friend-avatar')}
                        <span>
                          <strong>${escapeHtml(member.name)}${member.isCurrent ? ' (Ty)' : ''}${member.isDm ? ' • DM' : ''}</strong>
                          <small>${escapeHtml(member.race)} • ${escapeHtml(member.classes)} • poziom ${member.level}<br />Gracz: ${escapeHtml(member.user.username)}</small>
                        </span>
                      </button>
                    `,
                      )
                      .join('')}
                  </div>
                  <button type="button" class="secondary character-team-shared-action" data-open-campaign-shared="${campaign.id}" data-campaign-name="${escapeHtml(campaign.name)}">Zadania, materiały i informacje</button>
                  ${campaign.isDm ? `<button type="button" class="character-team-dm-action" data-open-dm-panel="${campaign.id}" data-campaign-name="${escapeHtml(campaign.name)}">Panel DM</button>` : ''}
                </section>
              `,
                )
                .join('')}</div>`
            : '<p class="section-note">Ta postać nie należy do żadnej drużyny.</p>';

          teamContent.querySelectorAll('[data-team-member]').forEach((button) => {
            button.addEventListener('click', () => {
              const campaign = campaigns.find((item) => item.id === Number(button.dataset.teamCampaign));
              const member = campaign?.members.find((item) => item.id === Number(button.dataset.teamMember));
              if (campaign && member) showCampaignCharacter(campaign.id, campaign.name, member);
            });
          });
          teamContent.querySelectorAll('[data-open-dm-panel]').forEach((button) => {
            button.addEventListener('click', () =>
              openDmPanel(Number(button.dataset.openDmPanel), button.dataset.campaignName),
            );
          });
          teamContent.querySelectorAll('[data-open-campaign-shared]').forEach((button) => {
            button.addEventListener('click', async () => {
              const campaignId = Number(button.dataset.openCampaignShared);
              contentPanel.innerHTML = `<div class="team-character-screen"><div class="section-heading"><div><p class="eyebrow">Kampania</p><h2>${escapeHtml(button.dataset.campaignName)}</h2></div><button class="secondary small" data-shared-back>Wróć</button></div><div data-shared-content><p class="loading-copy">Pobieranie materiałów…</p></div></div>`;
              contentPanel
                .querySelector('[data-shared-back]')
                ?.addEventListener('click', () => showCharacter(character));
              const sharedTarget = contentPanel.querySelector('[data-shared-content]');
              try {
                const response = await authenticatedFetch(`/api/campaigns/${campaignId}/shared`);
                if (!response.ok) throw new Error('shared_content_load_failed');
                const shared = await response.json();
                const questStatus = {
                  prepared: 'Przygotowane',
                  available: 'Dostępne',
                  active: 'Aktywne',
                  paused: 'Wstrzymane',
                  completed: 'Ukończone',
                  failed: 'Nieudane',
                  hidden: 'Ukryte',
                };
                sharedTarget.innerHTML = `<section><h3>Zadania drużyny</h3><div class="dm-record-list">${(shared.quests || []).map((quest) => `<article class="dm-record-card campaign-shared-quest"><div class="dm-module-toolbar"><strong>${escapeHtml(quest.name)}</strong><small>${escapeHtml(questStatus[quest.status] || quest.status)}</small></div>${quest.public_content ? `<p>${escapeHtml(quest.public_content)}</p>` : ''}${quest.main_goal ? `<p><strong>Cel:</strong> ${escapeHtml(quest.main_goal)}</p>` : ''}${quest.commissioner ? `<small>Zleceniodawca: ${escapeHtml(quest.commissioner)}</small>` : ''}${quest.steps?.length ? `<ul>${quest.steps.map((step) => `<li${step.is_completed ? ' class="completed"' : ''}>${step.is_completed ? '✓' : '○'} ${escapeHtml(step.title)}</li>`).join('')}</ul>` : ''}${quest.rewards ? `<p><strong>Nagrody:</strong> ${escapeHtml(quest.rewards)}</p>` : ''}</article>`).join('') || '<p class="section-note">DM nie udostępnił jeszcze żadnych zadań.</p>'}</div></section><section><h3>Materiały</h3><div class="dm-material-grid">${shared.materials.map((material) => `<article class="dm-material-card"><span>${escapeHtml(material.material_type)}</span><h4>${escapeHtml(material.title)}</h4><p>${escapeHtml(material.content)}</p>${material.external_url ? `<a href="${escapeHtml(material.external_url)}" target="_blank" rel="noopener noreferrer">Otwórz link</a>` : ''}</article>`).join('') || '<p class="section-note">Brak udostępnionych materiałów.</p>'}</div></section><section><h3>Odkryte informacje</h3><div class="dm-record-list">${shared.secrets.map((secret) => `<article class="dm-record-card"><strong>${escapeHtml(secret.title)}</strong><small>${escapeHtml(secret.secret_type)}</small><p>${escapeHtml(secret.content)}</p></article>`).join('') || '<p class="section-note">Brak odkrytych informacji.</p>'}</div></section>`;
              } catch {
                sharedTarget.innerHTML =
                  '<div class="empty-state"><p>Nie udało się pobrać materiałów kampanii.</p></div>';
              }
            });
          });
          teamContent.querySelectorAll('[data-leave-campaign]').forEach((button) => {
            button.addEventListener('click', async () => {
              if (
                !window.confirm(`Czy postać „${character.name}” ma opuścić kampanię „${button.dataset.campaignName}”?`)
              )
                return;
              button.disabled = true;
              const response = await authenticatedFetch(
                `/api/characters/${character.id}/campaigns/${button.dataset.leaveCampaign}`,
                {
                  method: 'DELETE',
                },
              );
              if (response.ok) await loadCharacterTeams();
              else {
                button.disabled = false;
                window.alert('Nie udało się opuścić kampanii.');
              }
            });
          });
        } catch {
          teamContent.innerHTML = '<div class="empty-state"><p>Nie udało się pobrać drużyny.</p></div>';
        }
      }

      loadCharacterTeams();
      let inventoryItems = parseInventory(character.inventory);
      let editingInventoryIndex = null;
      const inventoryList = document.querySelector('#inventory-list');
      const inventoryStatus = document.querySelector('#inventory-status');
      const inventoryForm = document.querySelector('#inventory-item-form');

      function selectAutomaticInventoryIcon(form) {
        if (!form || form.dataset.iconManuallySelected === 'true') return;
        const automaticIcon = automaticInventoryIcon(form?.querySelector('input[name="name"]')?.value);
        if (!automaticIcon) return;
        const iconInput = form.querySelector(`input[name="icon"][value="${automaticIcon}"]`);
        if (iconInput) iconInput.checked = true;
      }

      function toggleInventoryDuration(checkbox) {
        const control = checkbox?.closest('.inventory-duration-control');
        const input = control?.querySelector('input[name="duration"]');
        if (!input) return;
        control.classList.toggle('has-duration', checkbox.checked);
        input.disabled = !checkbox.checked;
        input.classList.toggle('hidden', !checkbox.checked);
        if (checkbox.checked) {
          window.requestAnimationFrame(() => input.focus());
        } else {
          input.value = '';
        }
      }

      function renderInventoryItems() {
        if (!inventoryList) return;
        inventoryList.innerHTML = inventoryItems.length
          ? inventoryItems
              .map((item, index) =>
                editingInventoryIndex === index
                  ? `
              <form class="inventory-edit-form" data-edit-inventory-form="${index}">
                <input name="name" maxlength="150" value="${escapeHtml(item.name)}" aria-label="Nazwa przedmiotu" required />
                <input name="quantity" type="number" min="1" max="9999" value="${item.quantity}" inputmode="numeric" aria-label="Ilość" required />
                ${inventoryDurationControl(item.duration)}
                ${inventoryIconPicker(item.icon)}
                <div>
                  <button type="submit" class="small">Zapisz</button>
                  <button type="button" class="secondary small" data-cancel-inventory-edit>Anuluj</button>
                </div>
              </form>
            `
                  : `
              <article class="inventory-item" data-edit-inventory-item="${index}" tabindex="0" title="Kliknij, aby edytować">
                <button class="inventory-drag-handle" type="button" data-inventory-drag-handle="${index}" aria-label="Przesuń ${escapeHtml(item.name)}" title="Przeciągnij, aby zmienić kolejność">⠿</button>
                <span class="inventory-icon">${inventoryIconMarkup(item)}</span>
                <span class="inventory-details">
                  <strong>${escapeHtml(item.name)}</strong>
                  ${item.duration ? `<small>⏱ ${escapeHtml(item.duration)}</small>` : ''}
                </span>
                <span class="inventory-quantity" aria-label="Ilość: ${item.quantity}">×&nbsp;${item.quantity}</span>
                <button class="inventory-remove" type="button" data-remove-inventory-item="${index}" aria-label="Usuń ${escapeHtml(item.name)}" title="Usuń">×</button>
              </article>
            `,
              )
              .join('')
          : '<div class="inventory-empty"><span aria-hidden="true">🎒</span><p>Ekwipunek jest pusty.</p></div>';
      }

      async function saveInventory(nextItems) {
        const inventory = serializeInventory(nextItems);
        const response = await authenticatedFetch(`/api/characters/${character.id}/inventory`, {
          method: 'PATCH',
          body: JSON.stringify({ inventory }),
        });
        if (!response.ok) throw new Error('inventory_save_failed');
        const updated = await response.json();
        character.inventory = updated.inventory;
        inventoryItems = parseInventory(updated.inventory);
        renderInventoryItems();
      }

      renderInventoryItems();

      document.querySelector('#open-add-inventory-item')?.addEventListener('click', (event) => {
        inventoryForm?.classList.toggle('hidden');
        event.currentTarget.classList.toggle('open');
        if (!inventoryForm?.classList.contains('hidden')) {
          inventoryForm.querySelector('input[name="name"]')?.focus();
        }
      });
      inventoryForm?.querySelector('[data-cancel-inventory-add]')?.addEventListener('click', () => {
        inventoryForm.reset();
        delete inventoryForm.dataset.iconManuallySelected;
        inventoryForm.classList.add('hidden');
        document.querySelector('#open-add-inventory-item')?.classList.remove('open');
      });

      inventoryList?.addEventListener('click', async (event) => {
        const removeButton = event.target.closest('[data-remove-inventory-item]');
        if (removeButton) {
          const index = Number(removeButton.dataset.removeInventoryItem);
          const nextItems = inventoryItems.filter((_, itemIndex) => itemIndex !== index);
          removeButton.disabled = true;
          inventoryStatus.textContent = '';
          try {
            editingInventoryIndex = null;
            await saveInventory(nextItems);
            inventoryStatus.textContent = 'Przedmiot usunięty.';
          } catch {
            removeButton.disabled = false;
            inventoryStatus.textContent = 'Nie udało się usunąć przedmiotu.';
          }
          return;
        }

        if (event.target.closest('[data-cancel-inventory-edit]')) {
          editingInventoryIndex = null;
          renderInventoryItems();
          return;
        }
        if (event.target.closest('[data-inventory-drag-handle]')) return;
        if (event.target.closest('.inventory-edit-form')) return;

        const item = event.target.closest('[data-edit-inventory-item]');
        if (!item) return;
        editingInventoryIndex = Number(item.dataset.editInventoryItem);
        renderInventoryItems();
        inventoryList.querySelector('[data-edit-inventory-form] input[name="name"]')?.select();
      });

      inventoryList?.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        const item = event.target.closest('[data-edit-inventory-item]');
        if (!item) return;
        event.preventDefault();
        editingInventoryIndex = Number(item.dataset.editInventoryItem);
        renderInventoryItems();
        inventoryList.querySelector('[data-edit-inventory-form] input[name="name"]')?.select();
      });
      inventoryList?.addEventListener('input', (event) => {
        if (event.target.matches('input[name="name"]')) {
          selectAutomaticInventoryIcon(event.target.closest('form'));
        }
      });
      inventoryList?.addEventListener('change', (event) => {
        if (event.target.matches('input[name="icon"]')) {
          const form = event.target.closest('form');
          if (form) form.dataset.iconManuallySelected = 'true';
        }
        if (event.target.matches('input[name="hasDuration"]')) {
          toggleInventoryDuration(event.target);
        }
      });
      inventoryForm?.querySelector('input[name="name"]')?.addEventListener('input', () => {
        selectAutomaticInventoryIcon(inventoryForm);
      });
      inventoryForm?.querySelector('input[name="hasDuration"]')?.addEventListener('change', (event) => {
        toggleInventoryDuration(event.currentTarget);
      });
      inventoryForm?.addEventListener('change', (event) => {
        if (event.target.matches('input[name="icon"]')) {
          inventoryForm.dataset.iconManuallySelected = 'true';
        }
      });

      inventoryList?.addEventListener('pointerdown', (event) => {
        const handle = event.target.closest('[data-inventory-drag-handle]');
        if (!handle || editingInventoryIndex !== null || event.isPrimary === false) return;
        const draggedItem = handle.closest('[data-edit-inventory-item]');
        if (!draggedItem) return;

        event.preventDefault();
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          // Niektóre wersje iOS nie pozwalają przechwycić wskaźnika od razu.
        }
        draggedItem.classList.add('dragging');
        inventoryList.classList.add('reordering');

        const moveDraggedItem = (moveEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return;
          moveEvent.preventDefault();

          const siblings = [...inventoryList.querySelectorAll('[data-edit-inventory-item]')].filter(
            (item) => item !== draggedItem,
          );
          const nextItem = siblings.find((item) => {
            const bounds = item.getBoundingClientRect();
            return moveEvent.clientY < bounds.top + bounds.height / 2;
          });

          if (nextItem) {
            inventoryList.insertBefore(draggedItem, nextItem);
          } else {
            inventoryList.appendChild(draggedItem);
          }

          const scrollBounds = contentPanel.getBoundingClientRect();
          const scrollEdge = Math.min(80, scrollBounds.height * 0.18);
          if (moveEvent.clientY < scrollBounds.top + scrollEdge) {
            contentPanel.scrollBy({ top: -18, behavior: 'auto' });
          } else if (moveEvent.clientY > scrollBounds.bottom - scrollEdge) {
            contentPanel.scrollBy({ top: 18, behavior: 'auto' });
          }
        };

        const finishReorder = async (finishEvent) => {
          window.removeEventListener('pointermove', moveDraggedItem);
          window.removeEventListener('pointerup', finishReorder);
          window.removeEventListener('pointercancel', cancelReorder);
          if (handle.hasPointerCapture?.(finishEvent.pointerId)) {
            handle.releasePointerCapture(finishEvent.pointerId);
          }
          draggedItem.classList.remove('dragging');
          inventoryList.classList.remove('reordering');

          const orderedIndices = [...inventoryList.querySelectorAll('[data-edit-inventory-item]')].map((item) =>
            Number(item.dataset.editInventoryItem),
          );
          const nextItems = orderedIndices.map((index) => inventoryItems[index]);
          inventoryStatus.textContent = 'Zapisywanie kolejności…';
          try {
            await saveInventory(nextItems);
            inventoryStatus.textContent = 'Kolejność ekwipunku została zapisana.';
          } catch {
            renderInventoryItems();
            inventoryStatus.textContent = 'Nie udało się zapisać kolejności.';
          }
        };

        const cancelReorder = (cancelEvent) => {
          window.removeEventListener('pointermove', moveDraggedItem);
          window.removeEventListener('pointerup', finishReorder);
          window.removeEventListener('pointercancel', cancelReorder);
          if (handle.hasPointerCapture?.(cancelEvent.pointerId)) {
            handle.releasePointerCapture(cancelEvent.pointerId);
          }
          renderInventoryItems();
          inventoryList.classList.remove('reordering');
        };

        window.addEventListener('pointermove', moveDraggedItem, { passive: false });
        window.addEventListener('pointerup', finishReorder);
        window.addEventListener('pointercancel', cancelReorder);
      });

      inventoryList?.addEventListener('submit', async (event) => {
        const form = event.target.closest('[data-edit-inventory-form]');
        if (!form) return;
        event.preventDefault();
        const index = Number(form.dataset.editInventoryForm);
        const formData = new FormData(form);
        const name = String(formData.get('name') || '')
          .trim()
          .replace(/\r?\n/g, ' ')
          .slice(0, 150);
        const quantity = Math.max(1, Math.min(9999, Number(formData.get('quantity')) || 1));
        const duration = String(formData.get('duration') || '')
          .trim()
          .replace(/\r?\n/g, ' ')
          .slice(0, 100);
        const icon = INVENTORY_ICON_KEYS.has(formData.get('icon')) ? formData.get('icon') : 'backpack';
        if (!name) return;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        inventoryStatus.textContent = '';
        try {
          const nextItems = inventoryItems.map((item, itemIndex) =>
            itemIndex === index ? { name, quantity, duration, icon } : item,
          );
          await saveInventory(nextItems);
          editingInventoryIndex = null;
          renderInventoryItems();
          inventoryStatus.textContent = 'Przedmiot zaktualizowany.';
        } catch {
          button.disabled = false;
          inventoryStatus.textContent = 'Nie udało się zaktualizować przedmiotu.';
        }
      });

      inventoryForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const formData = new FormData(form);
        const name = String(formData.get('name') || '')
          .trim()
          .replace(/\r?\n/g, ' ')
          .slice(0, 150);
        const quantity = Math.max(1, Math.min(9999, Number(formData.get('quantity')) || 1));
        const duration = String(formData.get('duration') || '')
          .trim()
          .replace(/\r?\n/g, ' ')
          .slice(0, 100);
        const icon = INVENTORY_ICON_KEYS.has(formData.get('icon')) ? formData.get('icon') : 'backpack';
        if (!name) return;
        button.disabled = true;
        inventoryStatus.textContent = '';
        try {
          await saveInventory([...inventoryItems, { name, quantity, duration, icon }]);
          form.reset();
          delete form.dataset.iconManuallySelected;
          form.querySelector('input[name="quantity"]').value = '1';
          form.classList.add('hidden');
          document.querySelector('#open-add-inventory-item')?.classList.remove('open');
          inventoryStatus.textContent = 'Przedmiot dodany.';
        } catch {
          inventoryStatus.textContent = 'Nie udało się dodać przedmiotu.';
        } finally {
          button.disabled = false;
        }
      });
    }

    document.querySelector('#new-character-btn')?.addEventListener('click', () => showEditor());

    try {
      const response = await authenticatedFetch('/api/characters');
      if (!response.ok) throw new Error('characters_load_failed');
      const characters = await response.json();

      if (characters.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Nie masz jeszcze żadnej postaci.</p></div>';
        return;
      }

      list.innerHTML = characters
        .map(
          (character) => `
        <article class="character-card selectable" data-view-character="${character.id}" tabindex="0">
          ${avatarMarkup(character.avatar, character.name, 'character-list-avatar')}
          <div class="character-info">
            <p class="character-level">Poziom ${character.level}</p>
            <div class="character-name-row">
              <h3>${escapeHtml(character.name)}</h3>
            </div>
            <p>${escapeHtml([character.race, character.className].filter(Boolean).join(' • ') || 'Brak szczegółów')}</p>
          </div>
          <div class="character-actions">
            <button class="icon-button edit" data-edit-character="${character.id}" aria-label="Edytuj postać ${escapeHtml(character.name)}" title="Edytuj">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1" />
                <path d="M20.385 6.585a2.1 2.1 0 0 0-2.97-2.97L9 12v3h3z" />
                <path d="m16 5 3 3" />
              </svg>
            </button>
            <button class="icon-button delete" data-delete-character="${character.id}" aria-label="Usuń postać ${escapeHtml(character.name)}" title="Usuń">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M5 7l1 13h12l1-13" />
                <path d="M9 7V4h6v3" />
              </svg>
            </button>
          </div>
        </article>
      `,
        )
        .join('');

      list.querySelectorAll('[data-view-character]').forEach((button) => {
        const openCharacter = (event) => {
          if (event.target.closest('button')) return;
          if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
          if (event.type === 'keydown') event.preventDefault();
          showCharacter(characters.find((item) => item.id === Number(button.dataset.viewCharacter)));
        };
        button.addEventListener('click', openCharacter);
        button.addEventListener('keydown', openCharacter);
      });

      list.querySelectorAll('[data-edit-character]').forEach((button) => {
        button.addEventListener('click', () => {
          const character = characters.find((item) => item.id === Number(button.dataset.editCharacter));
          showEditor(character);
        });
      });

      list.querySelectorAll('[data-delete-character]').forEach((button) => {
        button.addEventListener('click', async () => {
          const character = characters.find((item) => item.id === Number(button.dataset.deleteCharacter));
          if (!window.confirm(`Usunąć postać „${character.name}”?`)) return;
          button.disabled = true;
          try {
            const response = await authenticatedFetch(`/api/characters/${character.id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('character_delete_failed');
            await renderCharacters();
          } catch {
            button.disabled = false;
            window.alert('Nie udało się usunąć postaci.');
          }
        });
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-state"><p>${
        error.message === 'session_expired' ? 'Sesja wygasła. Zaloguj się ponownie.' : 'Nie udało się pobrać postaci.'
      }</p></div>`;
    }
  }

  function enterStandaloneContent(contentPanel) {
    document.body.classList.add('standalone-content');
    document.querySelector('.app-header')?.classList.add('hidden');
    document.querySelector('.footer-nav')?.classList.add('hidden');
    contentPanel.classList.add('fullscreen-content');
  }

  function leaveStandaloneContent() {
    document.body.classList.remove('standalone-content');
    document.querySelector('.app-header')?.classList.remove('hidden');
    document.querySelector('.footer-nav')?.classList.remove('hidden');
    document.querySelector('#content-panel')?.classList.remove('fullscreen-content');
    renderContent('account');
  }

  async function renderChangelog() {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;
    enterStandaloneContent(contentPanel);

    contentPanel.innerHTML = `
      <div class="changelog-screen">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Historia wydań</p>
            <h2>Changelog</h2>
          </div>
          <button id="changelog-back" class="secondary small">Wróć</button>
        </div>
        <div id="changelog-list" class="changelog-list">
          <p class="loading-copy">Pobieranie historii zmian…</p>
        </div>
      </div>
    `;

    document.querySelector('#changelog-back')?.addEventListener('click', leaveStandaloneContent);
    const list = document.querySelector('#changelog-list');

    try {
      const response = await fetch(bustCache(`${API_BASE}/api/app/changelog`), {
        cache: 'no-store',
        signal: requestTimeout(),
      });
      if (!response.ok) throw new Error('changelog_load_failed');
      const data = await response.json();
      const releases = Array.isArray(data.releases) ? data.releases : [];

      list.innerHTML = releases.length
        ? releases
            .map(
              (release, index) => `
          <article class="release-card${index === 0 ? ' latest' : ''}">
            <div class="release-heading">
              <div>
                <span class="release-version">v${escapeHtml(release.version)}</span>
                ${index === 0 ? '<span class="latest-badge">Najnowsza</span>' : ''}
              </div>
              <time datetime="${escapeHtml(release.date)}">${escapeHtml(release.date)}</time>
            </div>
            <h3>${escapeHtml(release.title)}</h3>
            <ul>
              ${(release.changes || []).map((change) => `<li>${escapeHtml(change)}</li>`).join('')}
            </ul>
          </article>
        `,
            )
            .join('')
        : '<div class="empty-state"><p>Brak wpisów w historii zmian.</p></div>';
    } catch {
      list.innerHTML = `
        <div class="empty-state">
          <p>Nie udało się pobrać historii zmian.</p>
          <button id="changelog-retry" class="secondary small">Spróbuj ponownie</button>
        </div>
      `;
      document.querySelector('#changelog-retry')?.addEventListener('click', renderChangelog);
    }
  }

  async function renderPrivacy() {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;
    enterStandaloneContent(contentPanel);

    contentPanel.innerHTML = `
      <div class="privacy-screen">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Twoje dane</p>
            <h2>Prywatność</h2>
          </div>
          <button id="privacy-back" class="secondary small">Wróć</button>
        </div>
        <div id="privacy-content" class="privacy-content">
          <p class="loading-copy">Pobieranie informacji o prywatności…</p>
        </div>
      </div>
    `;

    document.querySelector('#privacy-back')?.addEventListener('click', leaveStandaloneContent);
    const content = document.querySelector('#privacy-content');

    try {
      const response = await fetch(bustCache(`${API_BASE}/api/app/privacy`), {
        cache: 'no-store',
        signal: requestTimeout(),
      });
      if (!response.ok) throw new Error('privacy_load_failed');
      const policy = await response.json();

      content.innerHTML = `
        <div class="privacy-intro">
          <h3>${escapeHtml(policy.title)}</h3>
          <p>${escapeHtml(policy.summary)}</p>
          <span>Wersja ${escapeHtml(policy.version)} • obowiązuje od ${escapeHtml(policy.effectiveDate)}</span>
        </div>
        ${(policy.sections || [])
          .map(
            (section) => `
          <section class="privacy-section">
            <h3>${escapeHtml(section.title)}</h3>
            ${(section.content || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
          </section>
        `,
          )
          .join('')}
      `;
    } catch {
      content.innerHTML = `
        <div class="empty-state">
          <p>Nie udało się pobrać informacji o prywatności.</p>
          <button id="privacy-retry" class="secondary small">Spróbuj ponownie</button>
        </div>
      `;
      document.querySelector('#privacy-retry')?.addEventListener('click', renderPrivacy);
    }
  }

  async function renderHelp() {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;
    enterStandaloneContent(contentPanel);

    contentPanel.innerHTML = `
      <div class="help-screen">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Wsparcie</p>
            <h2>Pomoc</h2>
          </div>
          <button id="help-back" class="secondary small">Wróć</button>
        </div>
        <div id="help-content" class="help-content">
          <p class="loading-copy">Pobieranie centrum pomocy…</p>
        </div>
      </div>
    `;

    document.querySelector('#help-back')?.addEventListener('click', leaveStandaloneContent);
    const content = document.querySelector('#help-content');

    try {
      const response = await fetch(bustCache(`${API_BASE}/api/app/help`), {
        cache: 'no-store',
        signal: requestTimeout(),
      });
      if (!response.ok) throw new Error('help_load_failed');
      const help = await response.json();

      content.innerHTML = `
        <div class="help-intro">
          <h3>${escapeHtml(help.title)}</h3>
          <p>${escapeHtml(help.intro)}</p>
        </div>
        ${(help.categories || [])
          .map(
            (category) => `
          <section class="help-category">
            <h3>${escapeHtml(category.title)}</h3>
            ${(category.items || [])
              .map(
                (item) => `
              <details class="help-item">
                <summary>${escapeHtml(item.question)}</summary>
                <p>${escapeHtml(item.answer)}</p>
              </details>
            `,
              )
              .join('')}
          </section>
        `,
          )
          .join('')}
        <section class="help-diagnostics">
          <h3>Stan połączenia</h3>
          <p>Sprawdź, czy aplikacja może połączyć się z serwerem.</p>
          <button id="help-ping" class="secondary">Sprawdź serwer</button>
          <pre id="help-ping-result" class="help-ping-result hidden"></pre>
          <div class="delete-account-area">
            <button id="open-delete-account" class="danger" type="button">Usuń konto</button>
            <form id="delete-account-form" class="delete-account-form hidden">
              <p>Ta operacja trwale usunie konto i wszystkie powiązane dane. Nie można jej cofnąć.</p>
              <label>
                <span>Potwierdź aktualnym hasłem</span>
                <input name="password" type="password" minlength="8" maxlength="128" autocomplete="current-password" required />
              </label>
              <div>
                <button type="submit" class="danger">Usuń konto na zawsze</button>
                <button type="button" class="secondary" data-cancel-delete-account>Anuluj</button>
              </div>
              <p id="delete-account-error" class="form-error" role="alert"></p>
            </form>
          </div>
        </section>
      `;

      document.querySelector('#help-ping')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const result = document.querySelector('#help-ping-result');
        const endpoint = `${API_BASE}/api/diagnostics/ping`;
        const startedAt = performance.now();
        button.disabled = true;
        result.classList.remove('hidden');
        result.textContent = `Łączenie z ${endpoint}…`;

        try {
          const pingResponse = await fetch(bustCache(endpoint), {
            cache: 'no-store',
            signal: requestTimeout(),
          });
          const ping = await pingResponse.json();
          result.textContent = [
            pingResponse.ok ? 'Serwer działa prawidłowo.' : 'Serwer odpowiedział błędem.',
            `HTTP: ${pingResponse.status}`,
            `Czas: ${Math.round(performance.now() - startedAt)} ms`,
            `Request ID: ${ping.requestId || 'brak'}`,
          ].join('\n');
        } catch (error) {
          result.textContent = [
            'Nie udało się połączyć z serwerem.',
            `Adres: ${endpoint}`,
            `Błąd: ${formatError(error)}`,
          ].join('\n');
        } finally {
          button.disabled = false;
        }
      });

      const deleteAccountForm = document.querySelector('#delete-account-form');
      document.querySelector('#open-delete-account')?.addEventListener('click', (event) => {
        const confirmed = window.confirm(
          'Czy na pewno chcesz rozpocząć usuwanie konta? Wszystkie dane zostaną trwale usunięte.',
        );
        if (!confirmed) return;
        event.currentTarget.classList.add('hidden');
        deleteAccountForm?.classList.remove('hidden');
        deleteAccountForm?.querySelector('input[name="password"]')?.focus();
      });
      deleteAccountForm?.querySelector('[data-cancel-delete-account]')?.addEventListener('click', () => {
        deleteAccountForm.classList.add('hidden');
        deleteAccountForm.reset();
        document.querySelector('#delete-account-error').textContent = '';
        document.querySelector('#open-delete-account')?.classList.remove('hidden');
      });
      deleteAccountForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submitButton = form.querySelector('button[type="submit"]');
        const errorElement = document.querySelector('#delete-account-error');
        const password = new FormData(form).get('password');
        const finalConfirmation = window.confirm(
          'To ostatnie potwierdzenie. Usunąć konto i wszystkie dane bez możliwości odzyskania?',
        );
        if (!finalConfirmation) return;

        submitButton.disabled = true;
        errorElement.textContent = '';
        try {
          const deleteResponse = await authenticatedFetch('/api/auth/account', {
            method: 'DELETE',
            body: JSON.stringify({ password }),
          });
          const data = await deleteResponse.json().catch(() => ({}));
          if (!deleteResponse.ok) {
            throw new Error(data.error || 'account_delete_failed');
          }
          clearSession();
          renderApp();
        } catch (error) {
          errorElement.textContent =
            error.message === 'invalid_current_password'
              ? 'Podane hasło jest nieprawidłowe.'
              : 'Nie udało się usunąć konta. Spróbuj ponownie.';
          submitButton.disabled = false;
        }
      });
    } catch {
      content.innerHTML = `
        <div class="empty-state">
          <p>Nie udało się pobrać centrum pomocy.</p>
          <button id="help-retry" class="secondary small">Spróbuj ponownie</button>
        </div>
      `;
      document.querySelector('#help-retry')?.addEventListener('click', renderHelp);
    }
  }

  function renderChangePassword() {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;

    contentPanel.innerHTML = `
      <div class="password-screen">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Bezpieczeństwo konta</p>
            <h2>Zmień hasło</h2>
          </div>
          <button id="password-back" class="secondary small">Wróć</button>
        </div>
        <form id="password-form" class="password-form">
          <label>
            <span>Obecne hasło</span>
            <input name="currentPassword" type="password" autocomplete="current-password" required />
          </label>
          <label>
            <span>Nowe hasło</span>
            <input name="newPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
          </label>
          <label>
            <span>Powtórz nowe hasło</span>
            <input name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
          </label>
          <p class="password-hint">Hasło musi mieć co najmniej 8 znaków.</p>
          <p id="password-error" class="form-error" role="alert"></p>
          <button type="submit">Zmień hasło</button>
        </form>
      </div>
    `;

    document.querySelector('#password-back')?.addEventListener('click', () => renderContent('account'));
    document.querySelector('#password-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const errorElement = document.querySelector('#password-error');
      const formData = new FormData(form);
      const currentPassword = String(formData.get('currentPassword') || '');
      const newPassword = String(formData.get('newPassword') || '');
      const confirmPassword = String(formData.get('confirmPassword') || '');

      errorElement.textContent = '';
      if (newPassword !== confirmPassword) {
        errorElement.textContent = 'Nowe hasła nie są takie same.';
        return;
      }
      if (currentPassword === newPassword) {
        errorElement.textContent = 'Nowe hasło musi różnić się od obecnego.';
        return;
      }

      button.disabled = true;
      button.textContent = 'Zmienianie hasła…';

      try {
        const response = await authenticatedFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const messages = {
            invalid_current_password: 'Obecne hasło jest nieprawidłowe.',
            invalid_new_password: 'Nowe hasło musi mieć od 8 do 128 znaków.',
            password_unchanged: 'Nowe hasło musi różnić się od obecnego.',
          };
          throw new Error(messages[data.error] || 'Nie udało się zmienić hasła.');
        }

        clearSession();
        window.alert('Hasło zostało zmienione. Zaloguj się ponownie nowym hasłem.');
        renderApp();
      } catch (error) {
        errorElement.textContent = error.message || 'Nie udało się zmienić hasła.';
        button.disabled = false;
        button.textContent = 'Zmień hasło';
      }
    });
  }

  async function renderFriendProfile(friend) {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;

    contentPanel.innerHTML = `
      <div class="friend-profile-screen">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Profil znajomego</p>
            <h2>${escapeHtml(friend.username)}</h2>
          </div>
          <button id="friend-profile-back" class="secondary small">Wróć</button>
        </div>
        <div id="friend-profile-content" class="friend-profile-content">
          <p class="loading-copy">Pobieranie profilu…</p>
        </div>
      </div>
    `;

    document.querySelector('#friend-profile-back')?.addEventListener('click', renderFriends);
    const content = document.querySelector('#friend-profile-content');

    try {
      const response = await authenticatedFetch(`/api/friends/${friend.id}/profile`);
      if (!response.ok) throw new Error('profile_load_failed');
      const profile = await response.json();
      content.innerHTML = `
        <section class="friend-profile-card">
          ${avatarMarkup(profile.avatar, profile.username, 'friend-avatar profile')}
          <h3>${escapeHtml(profile.username)}</h3>
          <p>Gracz od ${new Date(profile.memberSince).toLocaleDateString('pl-PL')}</p>
          <div class="friend-profile-stats">
            <div><strong>${profile.characterCount}</strong><span>Postacie</span></div>
            <div><strong>${new Date(profile.friendsSince).toLocaleDateString('pl-PL')}</strong><span>Znajomi od</span></div>
          </div>
          <button id="profile-message" type="button">Wyślij wiadomość</button>
        </section>
      `;
      document.querySelector('#profile-message')?.addEventListener('click', () =>
        renderConversation({
          ...friend,
          avatar: profile.avatar,
        }),
      );
    } catch {
      content.innerHTML = '<div class="empty-state"><p>Nie udało się pobrać profilu znajomego.</p></div>';
    }
  }

  async function renderConversation(friend) {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;
    activeConversationFriendId = Number(friend.id);

    contentPanel.innerHTML = `
      <div class="conversation-screen">
        <div class="section-heading">
          <div class="conversation-identity">
            ${avatarMarkup(friend.avatar, friend.username, 'friend-avatar')}
            <div>
            <p class="eyebrow">Wiadomości</p>
            <h2>${escapeHtml(friend.username)}</h2>
            </div>
          </div>
          <button id="conversation-back" class="secondary small">Wróć</button>
        </div>
        <div id="messages-list" class="messages-list">
          <p class="loading-copy">Pobieranie wiadomości…</p>
        </div>
        <form id="message-form" class="message-form">
          <textarea name="body" maxlength="2000" rows="2" placeholder="Napisz wiadomość…" required></textarea>
          <button type="submit">Wyślij</button>
          <p id="message-error" class="form-error" role="alert"></p>
        </form>
      </div>
    `;

    document.querySelector('#conversation-back')?.addEventListener('click', () => {
      activeConversationFriendId = null;
      activeConversationRefresh = null;
      renderFriends();
    });
    const messagesList = document.querySelector('#messages-list');

    function messageMarkup(message) {
      return `
        <article class="message-bubble ${message.sentByMe ? 'mine' : 'theirs'}">
          <p>${escapeHtml(message.body)}</p>
          <time datetime="${escapeHtml(message.createdAt)}">${new Date(message.createdAt).toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}</time>
        </article>`;
    }

    async function loadMessages({ before = '', prepend = false } = {}) {
      try {
        const query = new URLSearchParams({ limit: '50' });
        if (before) query.set('before', before);
        const response = await authenticatedFetch(`/api/friends/${friend.id}/messages?${query}`);
        if (!response.ok) throw new Error('messages_load_failed');
        const messages = await response.json();
        const hasMore = response.headers.get('X-Has-More') === 'true';
        const nextCursor = response.headers.get('X-Next-Cursor') || '';
        const markup = messages.map(messageMarkup).join('');
        if (prepend) {
          const oldHeight = messagesList.scrollHeight;
          messagesList.querySelector('#load-older-messages')?.remove();
          messagesList.insertAdjacentHTML('afterbegin', markup);
          messagesList.scrollTop += messagesList.scrollHeight - oldHeight;
        } else {
          messagesList.innerHTML = messages.length
            ? markup
            : '<div class="empty-conversation"><p>To początek Waszej rozmowy.</p></div>';
          messagesList.scrollTop = messagesList.scrollHeight;
        }
        if (hasMore && nextCursor) {
          messagesList.insertAdjacentHTML(
            'afterbegin',
            '<button id="load-older-messages" class="secondary small" type="button">Wczytaj starsze wiadomości</button>',
          );
          document.querySelector('#load-older-messages')?.addEventListener(
            'click',
            (event) => {
              event.currentTarget.disabled = true;
              void loadMessages({ before: nextCursor, prepend: true });
            },
            { once: true },
          );
        }
      } catch {
        if (!prepend) messagesList.innerHTML = '<div class="empty-state"><p>Nie udało się pobrać wiadomości.</p></div>';
      }
    }
    activeConversationRefresh = loadMessages;

    document.querySelector('#message-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const textarea = form.querySelector('textarea');
      const button = form.querySelector('button[type="submit"]');
      const errorElement = document.querySelector('#message-error');
      const body = textarea.value.trim();
      if (!body) return;

      button.disabled = true;
      errorElement.textContent = '';
      try {
        const response = await authenticatedFetch(`/api/friends/${friend.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'message_send_failed');
        textarea.value = '';
        await loadMessages();
      } catch {
        errorElement.textContent = 'Nie udało się wysłać wiadomości.';
      } finally {
        button.disabled = false;
      }
    });

    await loadMessages();
  }

  function renderFriendNickname(friend) {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;
    contentPanel.innerHTML = `
      <div class="social-action-screen">
        <div class="section-heading">
          <div><p class="eyebrow">Znajomy</p><h2>Ustaw pseudonim</h2></div>
          <button id="nickname-back" class="secondary small">Wróć</button>
        </div>
        <form id="nickname-form" class="social-action-form">
          <p>Pseudonim dla gracza <strong>${escapeHtml(friend.username)}</strong> jest widoczny tylko dla Ciebie.</p>
          <input name="nickname" maxlength="50" value="${escapeHtml(friend.nickname || '')}" placeholder="Pseudonim (puste pole usuwa)" />
          <p id="nickname-error" class="form-error"></p>
          <button type="submit">Zapisz pseudonim</button>
        </form>
      </div>
    `;
    document.querySelector('#nickname-back')?.addEventListener('click', renderFriends);
    document.querySelector('#nickname-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      const error = document.querySelector('#nickname-error');
      button.disabled = true;
      try {
        const response = await authenticatedFetch(`/api/friends/${friend.id}/nickname`, {
          method: 'PUT',
          body: JSON.stringify({ nickname: new FormData(form).get('nickname') }),
        });
        if (!response.ok) throw new Error('nickname_failed');
        await renderFriends();
      } catch {
        error.textContent = 'Nie udało się zapisać pseudonimu.';
        button.disabled = false;
      }
    });
  }

  function renderReportFriend(friend) {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;
    contentPanel.innerHTML = `
      <div class="social-action-screen">
        <div class="section-heading">
          <div><p class="eyebrow">Bezpieczeństwo</p><h2>Zgłoś użytkownika</h2></div>
          <button id="report-back" class="secondary small">Wróć</button>
        </div>
        <form id="report-form" class="social-action-form">
          <p>Zgłoszenie dotyczy gracza <strong>${escapeHtml(friend.username)}</strong>.</p>
          <label><span>Powód</span>
            <select name="reason" required>
              <option value="">Wybierz powód</option>
              <option value="spam">Spam</option>
              <option value="harassment">Nękanie</option>
              <option value="inappropriate_content">Nieodpowiednie treści</option>
              <option value="impersonation">Podszywanie się</option>
              <option value="other">Inny powód</option>
            </select>
          </label>
          <label><span>Opis</span>
            <textarea name="details" maxlength="1000" rows="5" placeholder="Opisz sytuację (opcjonalnie)"></textarea>
          </label>
          <p id="report-error" class="form-error"></p>
          <button type="submit" class="danger">Wyślij zgłoszenie</button>
        </form>
      </div>
    `;
    document.querySelector('#report-back')?.addEventListener('click', renderFriends);
    document.querySelector('#report-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const error = document.querySelector('#report-error');
      const data = new FormData(form);
      button.disabled = true;
      try {
        const response = await authenticatedFetch(`/api/users/${friend.id}/report`, {
          method: 'POST',
          body: JSON.stringify({ reason: data.get('reason'), details: data.get('details') }),
        });
        if (!response.ok) throw new Error('report_failed');
        window.alert('Zgłoszenie zostało zapisane.');
        await renderFriends();
      } catch {
        error.textContent = 'Nie udało się wysłać zgłoszenia.';
        button.disabled = false;
      }
    });
  }

  async function renderCampaignInvite(friend) {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;
    contentPanel.innerHTML = `
      <div class="social-action-screen">
        <div class="section-heading">
          <div><p class="eyebrow">Kampanie</p><h2>Zaproś gracza</h2></div>
          <button id="campaign-invite-back" class="secondary small">Wróć</button>
        </div>
        <div id="campaign-invite-content" class="campaign-invite-content">
          <p class="loading-copy">Pobieranie kampanii…</p>
        </div>
      </div>
    `;
    document.querySelector('#campaign-invite-back')?.addEventListener('click', renderFriends);
    const content = document.querySelector('#campaign-invite-content');

    async function loadCampaigns() {
      try {
        const [campaignPage, charactersResponse] = await Promise.all([
          fetchAllPages('/api/campaigns'),
          authenticatedFetch('/api/characters'),
        ]);
        if (!campaignPage.response.ok || !charactersResponse.ok) throw new Error('campaigns_failed');
        const campaigns = campaignPage.items;
        const characters = await charactersResponse.json();
        content.innerHTML = `
          <p>Zaproś <strong>${escapeHtml(friend.username)}</strong> do wybranej kampanii:</p>
          <label class="campaign-character-choice">
            <span>Twoja postać w tej kampanii</span>
            <select id="campaign-character-id" ${characters.length ? '' : 'disabled'} required>
              ${characters
                .map(
                  (character) => `
                <option value="${character.id}">${escapeHtml(character.name)} — ${escapeHtml(character.race)}, poziom ${character.level}</option>
              `,
                )
                .join('')}
            </select>
          </label>
          ${characters.length ? '' : '<p class="form-error">Najpierw utwórz postać.</p>'}
          <div class="campaign-choice-list">
            ${
              campaigns
                .map(
                  (campaign) => `
              <button type="button" class="campaign-choice" data-campaign-invite="${campaign.id}" ${characters.length ? '' : 'disabled'}>
                🎲 ${escapeHtml(campaign.name)}
              </button>
            `,
                )
                .join('') || '<p class="loading-copy">Nie masz jeszcze własnej kampanii.</p>'
            }
          </div>
          <form id="create-campaign-form" class="social-action-form compact">
            <label><span>Nowa kampania</span>
              <input name="name" maxlength="100" placeholder="Nazwa kampanii" required />
            </label>
            <button type="submit">Utwórz kampanię</button>
          </form>
          <p id="campaign-invite-error" class="form-error"></p>
        `;

        content.querySelectorAll('[data-campaign-invite]').forEach((button) => {
          button.addEventListener('click', async () => {
            button.disabled = true;
            const characterId = Number(document.querySelector('#campaign-character-id')?.value);
            const response = await authenticatedFetch(`/api/campaigns/${button.dataset.campaignInvite}/invitations`, {
              method: 'POST',
              body: JSON.stringify({ friendId: friend.id, characterId }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
              window.alert(`Zaproszenie do kampanii „${data.campaignName}” zostało wysłane.`);
              await renderFriends();
            } else {
              document.querySelector('#campaign-invite-error').textContent =
                data.error === 'invitation_already_pending'
                  ? 'Zaproszenie do tej kampanii już oczekuje.'
                  : 'Nie udało się wysłać zaproszenia.';
              button.disabled = false;
            }
          });
        });

        document.querySelector('#create-campaign-form')?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const button = form.querySelector('button');
          button.disabled = true;
          const response = await authenticatedFetch('/api/campaigns', {
            method: 'POST',
            body: JSON.stringify({ name: new FormData(form).get('name') }),
          });
          if (response.ok) await loadCampaigns();
          else {
            document.querySelector('#campaign-invite-error').textContent = 'Nie udało się utworzyć kampanii.';
            button.disabled = false;
          }
        });
      } catch {
        content.innerHTML = '<div class="empty-state"><p>Nie udało się pobrać kampanii.</p></div>';
      }
    }
    await loadCampaigns();
  }

  async function renderFriends() {
    const contentPanel = document.querySelector('#content-panel');
    if (!contentPanel) return;

    contentPanel.innerHTML = `
      <div class="friends-screen">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Twoja drużyna</p>
            <h2>Znajomi</h2>
          </div>
        </div>
        <div id="friends-list" class="friends-list">
          <p class="loading-copy">Pobieranie listy znajomych…</p>
        </div>
      </div>
    `;

    const list = document.querySelector('#friends-list');

    function renderAddFriendRecord() {
      return `
        <section class="friend-card add-friend-card">
          <button id="open-add-friend" class="add-friend-trigger" type="button">
            <span class="friend-avatar add">+</span>
            <span>
              <strong>Dodaj znajomego</strong>
              <small>Wygeneruj lub wpisz kod gracza</small>
            </span>
          </button>
          <div id="friend-invite-panel" class="friend-invite-panel hidden"></div>
        </section>
      `;
    }

    function bindAddFriend() {
      document.querySelector('#open-add-friend')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const panel = document.querySelector('#friend-invite-panel');
        button.disabled = true;
        panel.classList.remove('hidden');
        panel.innerHTML = '<p class="loading-copy">Generowanie kodu…</p>';

        try {
          const response = await authenticatedFetch('/api/friends/invite', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          const invite = await response.json();
          if (!response.ok) throw new Error(invite.error || 'invite_generation_failed');

          panel.innerHTML = `
            <div class="generated-code">
              <p>Przekaż ten kod drugiemu graczowi:</p>
              <strong>${escapeHtml(invite.code)}</strong>
              <small>Kod jest jednorazowy i ważny przez ${invite.expiresInMinutes} minut.</small>
              <button id="copy-friend-code" class="secondary small" type="button">Kopiuj kod</button>
            </div>
            <form id="accept-friend-form" class="accept-friend-form">
              <label for="friend-code">Masz kod innego gracza?</label>
              <div>
                <input id="friend-code" name="code" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="Wpisz 8 znaków" required />
                <button type="submit">Dodaj</button>
              </div>
              <p id="friend-code-error" class="form-error" role="alert"></p>
            </form>
          `;

          document.querySelector('#copy-friend-code')?.addEventListener('click', async (copyEvent) => {
            try {
              await navigator.clipboard.writeText(invite.code);
              copyEvent.currentTarget.textContent = 'Skopiowano';
            } catch {
              copyEvent.currentTarget.textContent = invite.code;
            }
          });

          document.querySelector('#accept-friend-form')?.addEventListener('submit', async (submitEvent) => {
            submitEvent.preventDefault();
            const form = submitEvent.currentTarget;
            const submitButton = form.querySelector('button[type="submit"]');
            const errorElement = document.querySelector('#friend-code-error');
            const code = String(new FormData(form).get('code') || '')
              .trim()
              .toUpperCase();
            errorElement.textContent = '';
            submitButton.disabled = true;

            try {
              const acceptResponse = await authenticatedFetch('/api/friends/accept', {
                method: 'POST',
                body: JSON.stringify({ code }),
              });
              const data = await acceptResponse.json().catch(() => ({}));
              if (!acceptResponse.ok) {
                const messages = {
                  invalid_invite_code: 'Kod musi mieć 8 znaków.',
                  invite_not_found_or_expired: 'Kod jest nieprawidłowy, wykorzystany albo wygasł.',
                  cannot_add_yourself: 'Nie możesz dodać samego siebie.',
                  already_friends: 'Ten gracz jest już na Twojej liście znajomych.',
                };
                throw new Error(messages[data.error] || 'Nie udało się dodać znajomego.');
              }
              await renderFriends();
            } catch (error) {
              errorElement.textContent = error.message;
              submitButton.disabled = false;
            }
          });
        } catch {
          panel.innerHTML = '<p class="form-error">Nie udało się wygenerować kodu. Spróbuj ponownie.</p>';
          button.disabled = false;
        }
      });
    }

    try {
      const [friendsResponse, invitationsResponse] = await Promise.all([
        authenticatedFetch('/api/friends'),
        authenticatedFetch('/api/campaign-invitations'),
      ]);
      if (!friendsResponse.ok || !invitationsResponse.ok) throw new Error('friends_load_failed');
      const friends = await friendsResponse.json();
      const invitations = await invitationsResponse.json();

      list.innerHTML = `
        ${
          invitations.length
            ? `
          <section class="campaign-invitations">
            <h3>Zaproszenia do kampanii</h3>
            ${invitations
              .map(
                (invitation) => `
              <article>
                <div class="campaign-inviter">
                  ${avatarMarkup(invitation.inviter.avatar, invitation.inviter.username, 'friend-avatar')}
                  <div><strong>${escapeHtml(invitation.campaign.name)}</strong><small>Od: ${escapeHtml(invitation.inviter.username)}</small></div>
                </div>
                <div>
                  <button class="small" data-campaign-response="${invitation.id}" data-campaign-name="${escapeHtml(invitation.campaign.name)}" data-action="accept">Przyjmij</button>
                  <button class="secondary small" data-campaign-response="${invitation.id}" data-campaign-name="${escapeHtml(invitation.campaign.name)}" data-action="decline">Odrzuć</button>
                </div>
              </article>
            `,
              )
              .join('')}
          </section>
        `
            : ''
        }
        ${friends
          .map(
            (friend) => `
          <article class="friend-card">
            <button class="friend-main" type="button" data-friend-menu="${friend.id}">
              ${avatarMarkup(friend.avatar, friend.username, 'friend-avatar')}
              <span>
                <strong>${escapeHtml(friend.nickname || friend.username)}</strong>
                <small>${friend.nickname ? `@${escapeHtml(friend.username)} • ` : ''}Znajomy od ${new Date(friend.friendsSince).toLocaleDateString('pl-PL')}</small>
              </span>
              <span class="friend-chevron">⌄</span>
            </button>
            <div class="friend-menu hidden" data-friend-actions="${friend.id}">
              <button class="secondary small" type="button" data-friend-profile="${friend.id}">Zobacz profil</button>
              <button class="small" type="button" data-friend-message="${friend.id}">Wyślij wiadomość</button>
              <button class="secondary small" type="button" data-friend-campaign="${friend.id}">Zaproś do kampanii</button>
              <button class="secondary small" type="button" data-friend-nickname="${friend.id}">Ustaw pseudonim</button>
              <button class="secondary small" type="button" data-friend-report="${friend.id}">Zgłoś</button>
              <button class="danger small" type="button" data-friend-remove="${friend.id}">Usuń ze znajomych</button>
              <button class="danger small" type="button" data-friend-block="${friend.id}">Zablokuj</button>
            </div>
          </article>
        `,
          )
          .join('')}
        ${renderAddFriendRecord()}
      `;
      list.querySelectorAll('[data-friend-menu]').forEach((button) => {
        button.addEventListener('click', () => {
          const actions = list.querySelector(`[data-friend-actions="${button.dataset.friendMenu}"]`);
          actions?.classList.toggle('hidden');
          button.classList.toggle('open');
        });
      });
      list.querySelectorAll('[data-friend-profile]').forEach((button) => {
        button.addEventListener('click', () => {
          const friend = friends.find((item) => item.id === Number(button.dataset.friendProfile));
          renderFriendProfile(friend);
        });
      });
      list.querySelectorAll('[data-friend-message]').forEach((button) => {
        button.addEventListener('click', () => {
          const friend = friends.find((item) => item.id === Number(button.dataset.friendMessage));
          renderConversation(friend);
        });
      });
      list.querySelectorAll('[data-friend-campaign]').forEach((button) => {
        button.addEventListener('click', () =>
          renderCampaignInvite(friends.find((item) => item.id === Number(button.dataset.friendCampaign))),
        );
      });
      list.querySelectorAll('[data-friend-nickname]').forEach((button) => {
        button.addEventListener('click', () =>
          renderFriendNickname(friends.find((item) => item.id === Number(button.dataset.friendNickname))),
        );
      });
      list.querySelectorAll('[data-friend-report]').forEach((button) => {
        button.addEventListener('click', () =>
          renderReportFriend(friends.find((item) => item.id === Number(button.dataset.friendReport))),
        );
      });
      list.querySelectorAll('[data-friend-remove]').forEach((button) => {
        button.addEventListener('click', async () => {
          const friend = friends.find((item) => item.id === Number(button.dataset.friendRemove));
          if (!window.confirm(`Usunąć gracza „${friend.username}” ze znajomych?`)) return;
          button.disabled = true;
          const response = await authenticatedFetch(`/api/friends/${friend.id}`, { method: 'DELETE' });
          if (response.ok) await renderFriends();
          else button.disabled = false;
        });
      });
      list.querySelectorAll('[data-friend-block]').forEach((button) => {
        button.addEventListener('click', async () => {
          const friend = friends.find((item) => item.id === Number(button.dataset.friendBlock));
          if (!window.confirm(`Zablokować gracza „${friend.username}”? Znajomość zostanie usunięta.`)) return;
          button.disabled = true;
          const response = await authenticatedFetch(`/api/users/${friend.id}/block`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          if (response.ok) await renderFriends();
          else button.disabled = false;
        });
      });
      list.querySelectorAll('[data-campaign-response]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const handled = await respondToCampaignInvitation(
              button.dataset.campaignResponse,
              button.dataset.action,
              button.dataset.campaignName,
            );
            if (handled) await renderFriends();
            else button.disabled = false;
          } catch {
            button.disabled = false;
            window.alert('Nie udało się odpowiedzieć na zaproszenie.');
          }
        });
      });
      bindAddFriend();
    } catch {
      list.innerHTML = `
        <div class="empty-state">
          <p>Nie udało się pobrać listy znajomych.</p>
          <button id="friends-retry" class="secondary small">Spróbuj ponownie</button>
        </div>
      `;
      document.querySelector('#friends-retry')?.addEventListener('click', renderFriends);
    }
  }

  function renderContent(tab) {
    const contentPanel = document.querySelector('#content-panel');

    if (!contentPanel) return;
    document.querySelector('.character-footer-tabs')?.remove();
    activeConversationFriendId = null;
    activeConversationRefresh = null;

    if (tab === 'account') {
      contentPanel.innerHTML = `
        <div class="account-screen">
          <div class="account-header">
            <h2>Ustawienia konta</h2>
            <p>Zarządzaj swoim kontem i ustawieniami aplikacji</p>
          </div>
          <section class="account-avatar-card">
            <div id="account-avatar-preview">
              ${avatarMarkup(storedSession?.user?.avatar, storedSession?.user?.username, 'account-avatar')}
            </div>
            <div>
              <strong>Zdjęcie profilowe</strong>
              <small>Jest wyświetlane obok powitania na górze aplikacji.</small>
              <div class="avatar-editor-actions">
                <label class="button secondary small" for="account-avatar-input">Wybierz zdjęcie</label>
                <input id="account-avatar-input" class="visually-hidden" type="file" accept="image/*" />
                <button id="remove-account-avatar" class="secondary small${storedSession?.user?.avatar ? '' : ' hidden'}" type="button">Usuń zdjęcie</button>
              </div>
              <p id="account-avatar-status" class="account-avatar-status" role="status"></p>
            </div>
          </section>
          <div class="account-options">
            ${
              Capacitor.isNativePlatform()
                ? ''
                : `
              <button id="install-pwa" class="account-option">📲 ${isStandalonePwa() ? 'Aplikacja PWA jest zainstalowana' : 'Zainstaluj aplikację PWA'}</button>
            `
            }
            <div class="account-update">
              <button id="check-update-btn" class="account-option">🔄 Sprawdź aktualizacje</button>
              <p id="update-banner-text" class="account-update-status">Aktualna wersja: ${escapeHtml(currentAppVersion)}</p>
              <button id="update-now-btn" class="update-action hidden" type="button">Zaktualizuj teraz</button>
            </div>
            <button id="open-changelog" class="account-option">📜 Changelog</button>
            <button id="open-notification-settings" class="account-option">🔔 Opcje powiadomień</button>
            <button id="open-privacy" class="account-option">🔒 Prywatność</button>
            <button id="open-help" class="account-option">❓ Pomoc</button>
            <button id="open-change-password" class="account-option danger">🔑 Zmień hasło</button>
            <button id="account-logout" class="account-option danger">🚪 Wyloguj</button>
          </div>
        </div>
      `;
      document.querySelector('#install-pwa')?.addEventListener('click', installPwa);
      document.querySelector('#account-logout')?.addEventListener('click', handleLogout);
      document.querySelector('#check-update-btn')?.addEventListener('click', checkForUpdates);
      document.querySelector('#update-now-btn')?.addEventListener('click', applyUpdateNow);
      document.querySelector('#open-changelog')?.addEventListener('click', renderChangelog);
      document.querySelector('#open-notification-settings')?.addEventListener('click', openNotificationSettings);
      document.querySelector('#open-privacy')?.addEventListener('click', renderPrivacy);
      document.querySelector('#open-help')?.addEventListener('click', renderHelp);
      document.querySelector('#open-change-password')?.addEventListener('click', renderChangePassword);
      const accountAvatarInput = document.querySelector('#account-avatar-input');
      const removeAccountAvatar = document.querySelector('#remove-account-avatar');
      const saveAccountAvatar = async (avatar) => {
        const status = document.querySelector('#account-avatar-status');
        if (status) status.textContent = 'Zapisywanie…';
        const response = await authenticatedFetch('/api/auth/avatar', {
          method: 'PUT',
          body: JSON.stringify({ avatar }),
        });
        const user = await response.json();
        if (!response.ok) throw new Error(user.error || 'avatar_save_failed');
        storedSession = getStoredSession();
        storedSession.user = user;
        saveSession(storedSession);
        document.querySelector('#account-avatar-preview').innerHTML = avatarMarkup(
          user.avatar,
          user.username,
          'account-avatar',
        );
        const headerIdentity = document.querySelector('#app-header-identity');
        if (headerIdentity) {
          headerIdentity.innerHTML = `
            ${avatarMarkup(user.avatar, user.username, 'header-avatar')}
            <div><p class="eyebrow">Witaj</p><h2>${escapeHtml(user.username)}</h2></div>
          `;
        }
        removeAccountAvatar?.classList.toggle('hidden', !user.avatar);
        if (status)
          status.textContent = avatar ? 'Zdjęcie profilowe zostało zapisane.' : 'Zdjęcie profilowe zostało usunięte.';
      };
      accountAvatarInput?.addEventListener('change', async () => {
        const file = accountAvatarInput.files?.[0];
        if (!file) return;
        try {
          accountAvatarInput.disabled = true;
          await saveAccountAvatar(await prepareProfileImage(file));
        } catch {
          const status = document.querySelector('#account-avatar-status');
          if (status) status.textContent = 'Nie udało się zapisać zdjęcia. Wybierz plik graficzny do 15 MB.';
        } finally {
          accountAvatarInput.disabled = false;
          accountAvatarInput.value = '';
        }
      });
      removeAccountAvatar?.addEventListener('click', async () => {
        removeAccountAvatar.disabled = true;
        try {
          await saveAccountAvatar('');
        } catch {
          const status = document.querySelector('#account-avatar-status');
          if (status) status.textContent = 'Nie udało się usunąć zdjęcia.';
        } finally {
          removeAccountAvatar.disabled = false;
        }
      });
      return;
    }

    if (tab === 'friends') {
      renderFriends();
      return;
    }

    renderCharacters();
  }

  loginForm?.addEventListener('submit', handleLogin);
  registerForm?.addEventListener('submit', handleRegister);
  showLoginBtn?.addEventListener('click', () => switchForm('login'));
  showRegisterBtn?.addEventListener('click', () => switchForm('register'));

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      navItems.forEach((nav) => nav.classList.remove('active'));
      item.classList.add('active');
      renderContent(item.dataset.tab);
    });
  });

  renderContent('characters');
  if (storedSession) {
    notificationRouteHandler = async (route) => {
      if (route.type === 'message' && route.friendId) {
        await renderConversation({
          id: Number(route.friendId),
          username: route.username || 'Znajomy',
          avatar: route.avatar || '',
        });
        return;
      }

      if (route.type === 'campaign' && route.invitationId) {
        const action = ['accept', 'decline'].includes(route.action)
          ? route.action
          : window.confirm(
                `${route.inviterUsername || 'Znajomy'} zaprasza Cię do kampanii „${route.campaignName || ''}”.\n\n` +
                  'Wybierz OK, aby dołączyć, albo Anuluj, aby odrzucić zaproszenie.',
              )
            ? 'accept'
            : 'decline';

        try {
          const handled = await respondToCampaignInvitation(route.invitationId, action, route.campaignName);
          if (!handled) return;
          window.alert(
            action === 'accept'
              ? `Dołączono do kampanii „${route.campaignName || ''}”.`
              : `Odrzucono zaproszenie do kampanii „${route.campaignName || ''}”.`,
          );
          await renderFriends();
        } catch {
          window.alert('Nie udało się odpowiedzieć na zaproszenie do kampanii.');
        }
      }

      if (route.type === 'campaign_content' && route.campaignId) {
        if (route.notificationId) {
          await authenticatedFetch(`/api/notifications/campaign-content/${route.notificationId}/read`, {
            method: 'POST',
          }).catch(() => {});
        }
        window.alert(
          `Nowa zawartość w kampanii „${route.campaignName || ''}”. Otwórz kartę postaci i sekcję materiałów kampanii.`,
        );
        await renderCharacters();
      }
    };
    startNotificationPolling();
    if (pendingNotificationRoute) {
      const route = pendingNotificationRoute;
      pendingNotificationRoute = null;
      window.setTimeout(() => notificationRouteHandler?.(route), 0);
    }
  }
  if (loginBtn) loginBtn.dataset.defaultText = 'Wejdź do aplikacji';
  if (registerBtn) registerBtn.dataset.defaultText = 'Utwórz konto';
}

async function checkForUpdates() {
  setUpdateBanner('Sprawdzam aktualizacje…', { visible: true, showButton: false });

  try {
    const response = await fetch(bustCache(`${API_BASE}/api/app/version`), {
      cache: 'no-store',
      signal: requestTimeout(),
    });
    const data = await response.json();
    const platform = Capacitor.getPlatform();
    const release = platform === 'ios' ? data.ios : data.android || { version: data.version, url: null };
    const remoteVersion = release?.version;
    const reminder = localStorage.getItem(REMINDER_KEY);

    if (remoteVersion && compareVersions(remoteVersion, currentAppVersion) > 0) {
      availableUpdate = release;
      setUpdateBanner(`Dostępna jest nowa wersja: ${remoteVersion}`, { visible: true, showButton: true });
      if (reminder !== remoteVersion) {
        localStorage.setItem(REMINDER_KEY, remoteVersion);
      }

      if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
        navigator.serviceWorker
          .getRegistration()
          .then((registration) => {
            registration?.update();
          })
          .catch(console.error);
      }
    } else {
      availableUpdate = null;
      setUpdateBanner(
        remoteVersion ? `Masz najnowszą wersję aplikacji (${currentAppVersion})` : 'Masz najnowszą wersję aplikacji',
        { visible: true, showButton: false },
      );
    }
  } catch (error) {
    setUpdateBanner(`Nie można sprawdzić aktualizacji: ${formatError(error)}`, { visible: true, showButton: false });
  }
}

if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${PWA_BASE}sw.js`, { scope: PWA_BASE })
      .then((registration) => {
        registration.update();

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.setTimeout(() => window.location.reload(), 1000);
            }
          });
        });
      })
      .catch(console.error);
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const installButton = document.querySelector('#install-pwa');
  if (installButton) installButton.textContent = '📲 Zainstaluj aplikację PWA';
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const installButton = document.querySelector('#install-pwa');
  if (installButton) {
    installButton.textContent = '📲 Aplikacja PWA jest zainstalowana';
    installButton.disabled = true;
  }
});

async function bootstrap() {
  await initializeSessionStore();
  if (Capacitor.isNativePlatform()) {
    try {
      const appInfo = await CapacitorApp.getInfo();
      currentAppVersion = appInfo.version || WEB_APP_VERSION;
    } catch {
      currentAppVersion = WEB_APP_VERSION;
    }
  }
  await refreshSession();
  await loadUserUiPreferences();
  renderApp();
}

bootstrap();
