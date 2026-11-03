import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInventory } from '../../mobile/src/inventory-schema.js';
import { loadCommonJs } from '../helpers/load-commonjs.js';

test('DM can grant more than 9999 gold without truncating the stored quantity', async () => {
  for (const quantity of [10_000, 1_000_000, Number.MAX_SAFE_INTEGER]) {
    let saved;
    const { addDmCharacterInventoryItem } = loadCommonJs('../../server/src/campaigns.js', {
      './characters': { serializeCharacter() {} },
      './notifications': { publishUserNotification() {} },
      './db': {
        pool: {
          async query(sql, values) {
            if (sql.includes('UPDATE characters')) saved = values[0];
            if (sql.includes('FROM campaigns')) return { rows: [{ id: 1 }] };
            return { rows: [{ inventory: '' }] };
          },
        },
      },
    });
    const req = {
      params: { campaignId: '1', characterId: '2' },
      user: { id: 3 },
      body: { name: 'Gold coins', quantity, icon: 'gold' },
    };
    const res = {
      status(code) {
        assert.equal(code, 201);
        return this;
      },
      json(body) {
        assert.equal(parseInventory(body.inventory)[0].quantity, quantity);
      },
    };
    await addDmCharacterInventoryItem(req, res);
    assert.equal(parseInventory(saved)[0].quantity, quantity);
  }
});
