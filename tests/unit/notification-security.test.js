import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { loadCommonJs } from '../helpers/load-commonjs.js';

function harness() {
  const intervals = new Set();
  const timeouts = new Set();
  let active = true;
  let notificationHandler;
  const notifications = loadCommonJs(
    '../../server/src/notifications.js',
    {
      './db': {
        pool: {
          async connect() {
            return {
              on(name, callback) {
                if (name === 'notification') notificationHandler = callback;
              },
              async query() {},
              release() {},
            };
          },
        },
      },
      './sessions': {
        async isSessionActive() {
          return active;
        },
      },
    },
    {
      console: { log() {}, error() {} },
      setInterval(callback) {
        intervals.add(callback);
        return callback;
      },
      clearInterval(callback) {
        intervals.delete(callback);
      },
      setTimeout(callback, delay) {
        const timer = { callback, delay };
        timeouts.add(timer);
        return timer;
      },
      clearTimeout(timer) {
        timeouts.delete(timer);
      },
    },
  );
  function open(userId = 123, expiresAt = Date.now() + 60_000, slow = false) {
    const req = Object.assign(new EventEmitter(), { user: { id: userId }, auth: { sessionId: 'fixture', expiresAt } });
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      destroyed: false,
      slow,
      writes: [],
      status(code) {
        this.statusCode = code;
        return this;
      },
      set() {},
      json() {},
      flushHeaders() {},
      write(value) {
        this.writes.push(value);
        return !this.slow;
      },
      destroy() {
        this.destroyed = true;
        this.emit('close');
      },
    });
    notifications.streamNotifications(req, res);
    return { req, res };
  }
  async function heartbeat() {
    for (const callback of [...intervals]) callback();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    open,
    heartbeat,
    intervals,
    timeouts,
    notifications,
    async revokeEvent(sessionId) {
      await new Promise((resolve) => setImmediate(resolve));
      notificationHandler({
        channel: 'dnd_user_notifications',
        payload: JSON.stringify({ userId: 123, event: { type: 'session_revoked', sessionId } }),
      });
    },
    revoke() {
      active = false;
    },
  };
}

test('SSE limits per-user connections and releases slots and timers on close', () => {
  const h = harness();
  const connections = [h.open(), h.open(), h.open()];
  assert.equal(h.open().res.statusCode, 429);
  assert.equal(h.intervals.size, 3);
  connections[0].req.emit('close');
  assert.equal(h.intervals.size, 2);
  const replacement = h.open();
  assert.equal(replacement.res.statusCode, 200);
  for (const connection of [...connections, replacement]) connection.req.emit('close');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
});

test('SSE enforces an instance-wide active connection limit', async () => {
  const h = harness();
  for (let index = 1; index <= 300; index += 1) assert.equal(h.open(index).res.statusCode, 200);
  assert.equal(h.open(301).res.statusCode, 429);
  await h.notifications.stopNotificationListener();
  assert.equal(h.intervals.size, 0);
});

test('SSE destroys a blocked writer at handshake and after a heartbeat', async () => {
  const h = harness();
  assert.equal(h.open(1, Date.now() + 60_000, true).res.destroyed, true);
  const { res } = h.open();
  res.slow = true;
  await h.heartbeat();
  assert.equal(res.destroyed, true);
  assert.equal(h.timeouts.size, 0);
});

test('SSE closes revoked sessions without sending further heartbeats', async () => {
  const h = harness();
  const { res } = h.open();
  h.revoke();
  await h.heartbeat();
  assert.equal(res.destroyed, true);
  assert.equal(res.writes.length, 1);
});

test('database revocation events close matching streams immediately across instances', async () => {
  const h = harness();
  const { res } = h.open();
  await h.revokeEvent('another-session');
  assert.equal(res.destroyed, false);
  await h.revokeEvent('fixture');
  assert.equal(res.destroyed, true);
  const allSessions = h.open();
  await h.revokeEvent();
  assert.equal(allSessions.res.destroyed, true);
});

test('SSE rejects expired credentials and bounds connection lifetime by token expiry', () => {
  const h = harness();
  assert.equal(h.open(1, Date.now() - 1).res.statusCode, 401);
  const { res } = h.open();
  const timer = [...h.timeouts][0];
  assert.ok(timer.delay <= 60_000);
  timer.callback();
  assert.equal(res.destroyed, true);
  assert.equal(h.intervals.size, 0);
});
