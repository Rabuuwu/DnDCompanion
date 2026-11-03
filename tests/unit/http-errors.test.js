import assert from 'node:assert/strict';
import test from 'node:test';
import { errorResponse, handleHttpError } from '../../server/src/http-errors.js';

for (const [error, expected] of [
  [
    { type: 'entity.parse.failed', body: 'private request' },
    { status: 400, error: 'invalid_json' },
  ],
  [{ type: 'entity.too.large' }, { status: 413, error: 'payload_too_large' }],
  [new Error('origin_not_allowed'), { status: 403, error: 'origin_not_allowed' }],
  [
    { status: 400, message: 'private database values' },
    { status: 500, error: 'server_error' },
  ],
]) {
  test(`HTTP error maps to ${expected.error} without exposing details`, () => {
    assert.deepEqual(errorResponse(error), expected);
  });
}

test('error handler delegates after headers were sent', () => {
  const error = new Error('stream failed');
  let forwarded;
  handleHttpError(error, {}, { headersSent: true }, (value) => {
    forwarded = value;
  });
  assert.equal(forwarded, error);
});

test('invalid JSON produces an actionable JSON response', () => {
  let status;
  let payload;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      payload = value;
    },
  };
  handleHttpError({ type: 'entity.parse.failed' }, {}, res, () => assert.fail('unexpected next'));
  assert.equal(status, 400);
  assert.deepEqual(payload, { error: 'invalid_json' });
});

test('unexpected errors log correlation without private exception details', (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const res = {
    status(value) {
      assert.equal(value, 500);
      return this;
    },
    json(value) {
      assert.deepEqual(value, { error: 'server_error' });
    },
  };
  handleHttpError(new Error('private SQL value'), { auditRequestId: 'request-123' }, res, () => {});
  assert.deepEqual(log.mock.calls[0].arguments, [{ event: 'request_failed', requestId: 'request-123' }]);
});
