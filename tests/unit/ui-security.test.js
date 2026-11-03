import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml, safeExternalUrl, avatarMarkup } from '../../mobile/src/ui-utils.js';

test('user content cannot break out of quoted HTML attributes', () => {
  assert.equal(escapeHtml(`Test" style="position:fixed`), 'Test&quot; style=&quot;position:fixed');
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml('&quot;'), '&amp;quot;');
  assert.equal(escapeHtml(0), '0');
});

test('external links accept only absolute HTTP(S) URLs and encode unsafe quotes', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', '//example.test', '/local', 'https://']) {
    assert.equal(safeExternalUrl(input), '');
  }
  const url = safeExternalUrl('https://example.test/" style="position:fixed');
  assert.equal(url.includes('"'), false);
  assert.ok(url.startsWith('https://example.test/'));
});

test('avatar rendering rejects an attribute injection after a data URL prefix', () => {
  const html = avatarMarkup('data:image/png;base64,AAAA" onerror="alert(1)', 'User');
  assert.equal(html.includes('<img'), false);
  assert.ok(avatarMarkup('data:image/png;base64,AAAA', 'User', 'x" style="test').includes('&quot;'));
});
