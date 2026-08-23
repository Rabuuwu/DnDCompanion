import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { _test } = require('../../server/src/characters.js');

const attributes = {
  strength: { adventure: 100, combat: 50 },
  constitution: { adventure: -8, combat: -8 },
  wisdom: { adventure: 3, combat: 1 },
};

test('wzory poza HP mogą używać wartości walecznych, a ujemne pozostają bez mnożnika', () => {
  assert.equal(_test.formulaValue([{ type: 'percent', value: 100, attribute: 'strength' }], attributes, true), 50);
  assert.equal(_test.formulaValue([{ type: 'percent', value: 25, attribute: 'constitution' }], attributes, true), -8);
  assert.equal(_test.formulaValue([{ type: 'percent', value: 25, attribute: 'wisdom' }], attributes, true), 1);
});

test('kostka zachowuje typ i nie jest automatycznie przeliczana', () => {
  const terms = _test.rangedFormulaTerms([{ type: 'dice', count: 2, sides: 20 }]);
  assert.deepEqual(terms, [{ type: 'dice', count: 2, sides: 20 }]);
  assert.equal(_test.formulaValue(terms, attributes, true), 0);
});
