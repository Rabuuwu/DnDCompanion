import assert from 'node:assert/strict';
import test from 'node:test';
import { errorResponse } from '../../server/src/http-errors.js';

test('quota violations return an actionable error without exposing SQL details', () => {
  assert.deepEqual(errorResponse({ code: '23514', constraint: 'account_resource_quota', detail: 'private data' }), {
    status: 409,
    error: 'resource_quota_exceeded',
  });
  assert.equal(errorResponse({ code: '23514', constraint: 'different_constraint' }).status, 500);
});

test('compressed request rejection returns 415 without exposing parser internals', () => {
  assert.deepEqual(errorResponse({ type: 'encoding.unsupported', message: 'private parser data' }), {
    status: 415,
    error: 'unsupported_content_encoding',
  });
});
