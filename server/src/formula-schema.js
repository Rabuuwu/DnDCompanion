const ATTRIBUTE_KEYS = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const DICE_SIDES = new Set([4, 6, 8, 10, 20, 100]);

function integer(value, fallback = 0, min = -999, max = 999) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function rangedFormulaTerms(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((term) => {
    const type = ['percent', 'fraction', 'flat', 'dice'].includes(term?.type) ? term.type : 'flat';
    if (type === 'flat') {
      return { type, value: integer(term?.value, 0, -99999, 99999) };
    }
    if (type === 'dice') {
      const sides = integer(term?.sides, 6, 2, 1000);
      return {
        type,
        count: integer(term?.count, 1, 1, 20),
        sides: DICE_SIDES.has(sides) ? sides : 6,
      };
    }
    const attribute = ATTRIBUTE_KEYS.includes(term?.attribute) ? term.attribute : 'strength';
    if (type === 'percent') {
      return { type, value: integer(term?.value, 100, -1000, 1000), attribute };
    }
    return {
      type,
      numerator: integer(term?.numerator, 1, -100, 100),
      denominator: integer(term?.denominator, 2, 1, 100),
      attribute,
    };
  });
}

function formulaValue(terms, attributes, useCombatValues = false) {
  return terms.reduce((sum, term) => {
    if (term.type === 'dice') return sum;
    if (term.type === 'flat') return sum + term.value;
    const attribute = attributes[term.attribute];
    const base = (useCombatValues ? attribute?.combat : attribute?.adventure) || 0;
    if (base < 0) return sum + base;
    const scaled = term.type === 'percent' ? (base * term.value) / 100 : (base * term.numerator) / term.denominator;
    return sum + (scaled > 0 ? Math.max(1, scaled) : scaled);
  }, 0);
}

module.exports = { formulaValue, rangedFormulaTerms };
