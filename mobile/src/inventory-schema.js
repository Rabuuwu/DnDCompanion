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
export const INVENTORY_MAX_LENGTH = 100_000;

export function inventoryQuantity(value, fallback = 1) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(9999, Math.trunc(number))) : fallback;
}

export function parseInventoryCategories(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^\[inventory-category=([^;\]]+);name=([^\]]*)\]$/i))
    .filter(Boolean)
    .map((match) => {
      try {
        return { id: decodeURIComponent(match[1]).slice(0, 80), name: decodeURIComponent(match[2]).slice(0, 100) };
      } catch {
        return null;
      }
    })
    .filter((category) => category?.id && category.name);
}

export function parseInventory(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[inventory-category=/i.test(line))
    .map((line) => {
      const iconMatch = line.match(/\s+\[icon=([a-z_]+)\]\s*$/i);
      const icon = INVENTORY_ICON_KEYS.has(iconMatch?.[1]) ? iconMatch[1] : '';
      const withoutIcon = iconMatch ? line.slice(0, iconMatch.index).trim() : line;
      const quickMatch = withoutIcon.match(/\s+\[quick=([0-2])\]\s*$/i);
      const quickSlot = quickMatch ? Number(quickMatch[1]) : null;
      const withoutQuick = quickMatch ? withoutIcon.slice(0, quickMatch.index).trim() : withoutIcon;
      const categoryMatch = withoutQuick.match(/\s+\[category=([^\]]+)\]\s*$/i);
      const categoryId = (() => {
        try {
          return categoryMatch ? decodeURIComponent(categoryMatch[1]).slice(0, 80) : '';
        } catch {
          return '';
        }
      })();
      const withoutCategory = categoryMatch ? withoutQuick.slice(0, categoryMatch.index).trim() : withoutQuick;
      const descriptionMatch = withoutCategory.match(/\s+\[description=([^\]]*)\]\s*$/i);
      const description = (() => {
        try {
          return descriptionMatch ? decodeURIComponent(descriptionMatch[1]).slice(0, 1000) : '';
        } catch {
          return '';
        }
      })();
      const cleanLine = descriptionMatch ? withoutCategory.slice(0, descriptionMatch.index).trim() : withoutCategory;
      const durationMatch = cleanLine.match(/^(.*?)\s+⏱\s*(.+)$/u);
      const itemLine = durationMatch ? durationMatch[1].trim() : cleanLine;
      const duration = durationMatch ? durationMatch[2].trim().slice(0, 100) : '';
      const quantityMatch = itemLine.match(/^(.*?)\s+×\s*(\d+)$/u);
      return {
        name: (quantityMatch?.[1] || itemLine).trim(),
        quantity: quantityMatch ? inventoryQuantity(quantityMatch[2]) : 1,
        duration,
        icon,
        description,
        quickSlot,
        categoryId,
      };
    })
    .filter((item) => item.name);
}

export function serializeInventory(items, categories = []) {
  const categoryLines = categories.map(
    (category) => `[inventory-category=${encodeURIComponent(category.id)};name=${encodeURIComponent(category.name)}]`,
  );
  const itemLines = items
    .map((item) => {
      const name = String(item.name || '').trim();
      const quantity = inventoryQuantity(item.quantity);
      const duration = String(item.duration || '')
        .trim()
        .replace(/\r?\n/g, ' ')
        .slice(0, 100);
      const icon = INVENTORY_ICON_KEYS.has(item.icon) ? item.icon : '';
      const description = String(item.description || '')
        .trim()
        .slice(0, 1000);
      const quickSlot = [0, 1, 2].includes(item.quickSlot) ? item.quickSlot : null;
      const categoryId = String(item.categoryId || '')
        .trim()
        .slice(0, 80);
      return `${name} × ${quantity}${duration ? ` ⏱ ${duration}` : ''}${description ? ` [description=${encodeURIComponent(description)}]` : ''}${categoryId ? ` [category=${encodeURIComponent(categoryId)}]` : ''}${quickSlot !== null ? ` [quick=${quickSlot}]` : ''}${icon ? ` [icon=${icon}]` : ''}`;
    })
    .filter((line) => !line.startsWith(' × '));
  return [...categoryLines, ...itemLines].join('\n');
}

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
