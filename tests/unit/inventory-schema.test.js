import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticInventoryIcon, INVENTORY_ICON_KEYS } from '../../mobile/src/inventory-schema.js';

test('automatyczny wybór rozpoznaje polskie i angielskie nazwy przedmiotów', () => {
  assert.equal(automaticInventoryIcon('Mikstura leczenia'), 'potion_red');
  assert.equal(automaticInventoryIcon('Niebieska potka many'), 'potion_blue');
  assert.equal(automaticInventoryIcon('Gold coins'), 'gold');
  assert.equal(automaticInventoryIcon('Hełm płytowy'), 'armor');
  assert.equal(automaticInventoryIcon('Księga zaklęć'), 'spellbook');
  assert.equal(automaticInventoryIcon('Nieznany artefakt'), '');
});

test('każdy automatycznie wybierany klucz istnieje na liście ikon', () => {
  for (const name of [
    'sztylet',
    'diament',
    'klejnot',
    'klucz',
    'list',
    'naszyjnik',
    'kilof',
    'sakiewka',
    'pierścień',
    'lina',
    'tarcza',
    'pochodnia',
    'plecak',
  ]) {
    assert.ok(INVENTORY_ICON_KEYS.has(automaticInventoryIcon(name)), name);
  }
});
