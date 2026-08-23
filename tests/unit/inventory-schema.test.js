import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticInventoryIcon,
  INVENTORY_ICON_KEYS,
  parseInventory,
  parseInventoryCategories,
  serializeInventory,
} from '../../mobile/src/inventory-schema.js';

test('automatyczny wybór rozpoznaje polskie i angielskie nazwy przedmiotów', () => {
  assert.equal(automaticInventoryIcon('Mikstura leczenia'), 'potion_red');
  assert.equal(automaticInventoryIcon('Niebieska potka many'), 'potion_blue');
  assert.equal(automaticInventoryIcon('Gold coins'), 'gold');
  assert.equal(automaticInventoryIcon('Hełm płytowy'), 'armor');
  assert.equal(automaticInventoryIcon('Księga zaklęć'), 'spellbook');
  assert.equal(automaticInventoryIcon('Nieznany artefakt'), '');
});

test('serializacja zachowuje zero, opis, kategorię, szybki slot, czas i ręczną ikonę', () => {
  const value = serializeInventory(
    [
      {
        name: 'Pusta fiolka',
        quantity: 0,
        duration: '2 rundy',
        description: 'Opis [bez utraty]',
        categoryId: 'mikstury',
        quickSlot: 1,
        icon: 'potion_blue',
      },
    ],
    [{ id: 'mikstury', name: 'Mikstury i eliksiry' }],
  );
  assert.deepEqual(parseInventoryCategories(value), [{ id: 'mikstury', name: 'Mikstury i eliksiry' }]);
  assert.deepEqual(parseInventory(value), [
    {
      name: 'Pusta fiolka',
      quantity: 0,
      duration: '2 rundy',
      description: 'Opis [bez utraty]',
      categoryId: 'mikstury',
      quickSlot: 1,
      icon: 'potion_blue',
    },
  ]);
});

test('stary format jednej linii na przedmiot pozostaje zgodny', () => {
  assert.deepEqual(parseInventory('Miecz\nLina × 3'), [
    { name: 'Miecz', quantity: 1, duration: '', icon: '', description: '', quickSlot: null, categoryId: '' },
    { name: 'Lina', quantity: 3, duration: '', icon: '', description: '', quickSlot: null, categoryId: '' },
  ]);
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
