export const CHARACTER_ATTRIBUTES = [
  ['strength', 'Siła'],
  ['dexterity', 'Zręczność'],
  ['constitution', 'Kondycja'],
  ['intelligence', 'Inteligencja'],
  ['wisdom', 'Mądrość'],
  ['charisma', 'Charyzma'],
];
export const CHARACTER_COMBAT = [
  ['hp', 'HP'],
  ['corruption', 'Korupcja'],
  ['hit', 'Trafienie'],
  ['defense', 'Obrona'],
  ['magicDefense', 'Obrona magiczna'],
  ['dodge', 'Unik'],
  ['damage', 'DMG'],
  ['initiative', 'Inicjatywa'],
];
export const CHARACTER_AUXILIARY = [
  ['reflex', 'Refleks'],
  ['intuition', 'Intuicja'],
  ['arcana', 'Arkana'],
  ['perception', 'Percepcja'],
];
export const CHARACTER_SKILL_GROUPS = [
  [
    'Siła',
    [
      ['strengthPower', 'Siła', 150],
      ['carryingCapacity', 'Udźwig', 150],
    ],
    'strength',
  ],
  [
    'Zręczność',
    [
      ['dexterityControl', 'Zręczność', 100],
      ['agility', 'Zwinność', 100],
      ['stealth', 'Skradanie', 50],
    ],
    'dexterity',
  ],
  [
    'Kondycja',
    [
      ['endurance', 'Wytrzymałość', 125],
      ['heatResistance', 'Odporność na ciepło', 150],
      ['coldResistance', 'Odporność na zimno', 75],
      ['poisonResistance', 'Odporność na trucizny', 100],
    ],
    'constitution',
  ],
  [
    'Inteligencja',
    [
      ['investigation', 'Śledztwo', 50],
      ['intuition', 'Intuicja', 100],
      ['perception', 'Percepcja', 100],
    ],
    'intelligence',
  ],
  [
    'Mądrość',
    [
      ['animalKnowledge', 'Wiedza o zwierzętach', 50],
      ['plantKnowledge', 'Wiedza o roślinach', 50],
      ['arcanaKnowledge', 'Wiedza o arkanach', 25],
      ['arcanaUse', 'Używanie arkan', 25],
      ['arcanaSense', 'Wyczucie arkan', 25],
      ['medicine', 'Medycyna', 100],
      ['alchemy', 'Alchemia', 0],
      ['religion', 'Religia', 100],
      ['linguistics', 'Językoznawstwo', 0],
      ['polyglot', 'Poliglota', 100],
      ['physicalLearning', 'Nauka cielesna', 200],
      ['mentalLearning', 'Nauka umysłowa', 75],
    ],
    'wisdom',
  ],
  [
    'Charyzma',
    [
      ['rhetoric', 'Retoryka', 125],
      ['lying', 'Kłamstwo', 75],
      ['intimidation', 'Zastraszenie', 50],
      ['performance', 'Przedstawienia', 50],
    ],
    'charisma',
  ],
];
export const CHARACTER_SPECIAL = [
  ['animalCare', 'Opieka nad zwierzętami'],
  ['animalTraining', 'Tresura zwierząt'],
  ['spirituality', 'Duchowość'],
];
export const CHARACTER_FEATURES = [
  ['passives', 'Pasywki', 'Dodaj pasywkę'],
  ['campActions', 'Obozówki', 'Dodaj obozówkę'],
  ['abilities', 'Umiejętności', 'Dodaj umiejętność'],
  ['talents', 'Talenty', 'Dodaj talent'],
  ['additionalSkills', 'Dodatkowe umiejętności', 'Dodaj dodatkową umiejętność'],
];
