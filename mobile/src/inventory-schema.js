export const INVENTORY_ICONS = [
  ['armor', 'Pancerz'],
  ['backpack', 'Plecak'],
  ['dagger', 'Sztylet'],
  ['diamond', 'Diament'],
  ['gem', 'Klejnot'],
  ['gold', 'Złoto'],
  ['key', 'Klucz'],
  ['letter', 'List'],
  ['necklace', 'Naszyjnik'],
  ['pickaxe', 'Kilof'],
  ['potion_blue', 'Niebieska mikstura'],
  ['potion_red', 'Czerwona mikstura'],
  ['pouch', 'Sakiewka'],
  ['ring', 'Pierścień'],
  ['rope', 'Lina'],
  ['shield', 'Tarcza'],
  ['spellbook', 'Księga zaklęć'],
  ['torch', 'Pochodnia'],
];

export const INVENTORY_ICON_KEYS = new Set(INVENTORY_ICONS.map(([key]) => key));

export function automaticInventoryIcon(name) {
  const normalized = String(name || '').toLocaleLowerCase('pl-PL');
  const matches = (words) => words.some((word) => normalized.includes(word));
  if (matches(['złot', 'gold', 'monet'])) return 'gold';
  if (matches(['pancerz', 'zbroj', 'hełm', 'helm', 'helmet', 'napierśnik', 'napiersnik', 'kolczug', 'armor', 'armour']))
    return 'armor';
  if (matches(['mana', 'many', 'niebiesk']) && matches(['mikstur', 'potk', 'potion'])) return 'potion_blue';
  if (matches(['mikstur', 'potk', 'potion', 'eliksir'])) return 'potion_red';
  const mappings = [
    ['dagger', ['sztylet', 'dagger']],
    ['diamond', ['diament', 'diamond']],
    ['gem', ['klejnot', 'gem']],
    ['key', ['klucz', 'key']],
    ['letter', ['list', 'letter']],
    ['necklace', ['naszyjnik', 'necklace', 'amulet']],
    ['pickaxe', ['kilof', 'pickaxe']],
    ['pouch', ['sakiew', 'pouch']],
    ['ring', ['pierścień', 'pierscien', 'ring']],
    ['rope', ['lina', 'linę', 'rope']],
    ['shield', ['tarcza', 'tarczę', 'shield']],
    ['spellbook', ['księg', 'ksieg', 'spellbook', 'grymuar', 'grimoire']],
    ['torch', ['pochodni', 'torch']],
    ['backpack', ['plecak', 'backpack']],
  ];
  return mappings.find(([, words]) => matches(words))?.[0] || '';
}
