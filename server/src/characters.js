const { pool } = require('./db');

const ATTRIBUTE_KEYS = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const COMBAT_KEYS = ['hp', 'corruption', 'hit', 'defense', 'magicDefense', 'dodge', 'damage', 'initiative'];
const SKILL_BASES = {
  strengthPower: 'strength',
  carryingCapacity: 'strength',
  dexterityControl: 'dexterity',
  agility: 'dexterity',
  stealth: 'dexterity',
  endurance: 'constitution',
  heatResistance: 'constitution',
  coldResistance: 'constitution',
  poisonResistance: 'constitution',
  investigation: 'intelligence',
  intuition: 'intelligence',
  perception: 'intelligence',
  animalKnowledge: 'wisdom',
  plantKnowledge: 'wisdom',
  arcanaKnowledge: 'wisdom',
  arcanaUse: 'wisdom',
  arcanaSense: 'wisdom',
  medicine: 'wisdom',
  alchemy: 'wisdom',
  religion: 'wisdom',
  linguistics: 'wisdom',
  polyglot: 'wisdom',
  physicalLearning: 'wisdom',
  mentalLearning: 'wisdom',
  rhetoric: 'charisma',
  lying: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
};
const CUSTOM_SKILL_GROUPS = new Set(ATTRIBUTE_KEYS);

function text(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function profileImage(value) {
  const image = String(value || '').trim();
  if (!image || image.length > 700_000) return '';
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(image)
    ? image
    : '';
}

function integer(value, fallback = 0, min = -999, max = 999) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function combatAttribute(key, adventureValue) {
  if (key === 'charisma' || adventureValue <= 0) return adventureValue;
  return Math.floor(adventureValue / 2);
}

function scaledAuxiliaryAttribute(adventureValue, divisor) {
  if (adventureValue <= 0) return adventureValue;
  return Math.max(1, Math.floor(adventureValue / divisor));
}

function calculatedSkillValue(baseValue, percent) {
  if (percent === 0) return 0;
  if (baseValue <= 0) return baseValue;
  return Math.max(1, Math.trunc(baseValue * percent / 100));
}

function calculatedAuxiliary(attributes) {
  return {
    reflex: {
      value: String(scaledAuxiliaryAttribute(attributes.dexterity.adventure, 1)),
      formula: '100% zręczności',
    },
    intuition: {
      value: String(scaledAuxiliaryAttribute(attributes.intelligence.adventure, 2)),
      formula: '50% inteligencji',
    },
    arcana: {
      value: String(scaledAuxiliaryAttribute(attributes.wisdom.adventure, 4)),
      formula: '25% mądrości',
    },
    perception: {
      value: String(scaledAuxiliaryAttribute(attributes.intelligence.adventure, 2)),
      formula: '50% inteligencji',
    },
  };
}

function characterAuxiliary(value, attributes) {
  const calculated = calculatedAuxiliary(attributes);
  return Object.fromEntries(Object.entries(calculated).map(([key, fallback]) => {
    const submittedValue = value?.[key]?.value;
    const hasSubmittedFormula = Object.prototype.hasOwnProperty.call(value?.[key] || {}, 'formula');
    return [key, {
      value: submittedValue === undefined || submittedValue === null || submittedValue === ''
        ? fallback.value
        : String(integer(submittedValue, Number(fallback.value), -999, 999)),
      formula: hasSubmittedFormula ? text(value[key].formula, 250) : fallback.formula,
    }];
  }));
}

function rangedFormulaTerms(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((term) => {
    const type = ['percent', 'fraction', 'flat'].includes(term?.type) ? term.type : 'flat';
    if (type === 'flat') {
      return { type, value: integer(term?.value, 0, -99999, 99999) };
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

function featureList(value, { withToothCost = false, withDuration = false, withRanged = false } = {}) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((item) => {
    const feature = {
      name: text(item?.name, 100),
      description: text(item?.description, 1000),
      cooldown: text(item?.cooldown, 100),
    };
    if (withDuration) feature.duration = text(item?.duration, 100);
    if (withToothCost) feature.toothCost = integer(item?.toothCost, 0, 0, 999);
    if (withRanged) {
      feature.ranged = Boolean(item?.ranged);
      feature.range = feature.ranged ? text(item?.range, 100) : '';
      feature.formulaTerms = feature.ranged ? rangedFormulaTerms(item?.formulaTerms) : [];
    }
    return feature;
  }).filter((item) => item.name);
}

function guildList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 50)
    .map((item) => ({
      name: text(item?.name, 100),
      rank: text(item?.rank, 50),
      profession: text(item?.profession, 100),
    }))
    .filter((item) => item.name);
}

function notebookData(value) {
  const source = value && typeof value === 'object' ? value : {};
  let pointCount = 0;
  const strokes = Array.isArray(source.strokes)
    ? source.strokes.slice(0, 1000).map((stroke) => {
        const points = Array.isArray(stroke?.points)
          ? stroke.points.slice(0, Math.max(0, 20_000 - pointCount)).map((point) => ({
              x: Math.max(-1_000_000, Math.min(1_000_000, Number(point?.x) || 0)),
              y: Math.max(-1_000_000, Math.min(1_000_000, Number(point?.y) || 0)),
            }))
          : [];
        pointCount += points.length;
        return {
          color: /^#[0-9a-f]{6}$/i.test(stroke?.color) ? stroke.color : '#1f2937',
          width: Math.max(1, Math.min(30, Number(stroke?.width) || 3)),
          points,
        };
      }).filter((stroke) => stroke.points.length)
    : [];

  return {
    mode: source.mode === 'draw' ? 'draw' : 'text',
    text: String(source.text || '').slice(0, 50_000),
    strokes,
  };
}

function customSkillList(value, attributes) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 100)
    .map((item) => {
      const group = text(item?.group, 30);
      const percent = integer(item?.percent ?? item?.value, 0, 0, 1000);
      if (!CUSTOM_SKILL_GROUPS.has(group)) return null;
      return {
        group,
        name: text(item?.name, 100),
        percent,
        result: calculatedSkillValue(attributes[group].adventure, percent),
      };
    })
    .filter((item) => item?.name);
}

function parseCharacterPayload(body = {}) {
  const name = text(body.name, 100);
  const race = text(body.race, 100);
  const classes = text(body.classes || body.className, 150);
  const level = integer(body.level, 1, 1, 100);

  if (!name) return { error: 'invalid_character_name' };
  if (!race || !classes) return { error: 'race_and_class_required' };

  const attributes = {};
  for (const key of ATTRIBUTE_KEYS) {
    const adventure = integer(body.attributes?.[key], 0, -100, 1000);
    attributes[key] = {
      adventure,
      combat: combatAttribute(key, adventure),
    };
  }

  const combat = {};
  for (const key of COMBAT_KEYS) {
    combat[key] = {
      value: text(body.combat?.[key]?.value, 100),
      formula: text(body.combat?.[key]?.formula, 250),
    };
  }

  const auxiliary = characterAuxiliary(body.auxiliary, attributes);

  const skills = {};
  for (const [key, baseKey] of Object.entries(SKILL_BASES)) {
    const percent = integer(body.skills?.[key]?.percent, 0, 0, 1000);
    const baseValue = attributes[baseKey].adventure;
    skills[key] = {
      percent,
      result: calculatedSkillValue(baseValue, percent),
      note: text(body.skills?.[key]?.note, 150),
    };
  }
  const customSkills = customSkillList(body.customSkills, attributes);

  const special = {};
  for (const key of ['animalCare', 'animalTraining', 'spirituality']) {
    special[key] = {
      current: integer(body.special?.[key]?.current, 0, 0, 999),
      max: integer(body.special?.[key]?.max, 0, 0, 999),
    };
  }

  const guilds = guildList(body.guilds);
  const campActions = featureList(body.features?.campActions, { withDuration: true });
  if (campActions.some((item) => !item.duration)) {
    return { error: 'camp_action_duration_required' };
  }

  return {
    name,
    data: {
      profile: {
        avatar: profileImage(body.avatar),
        motto: text(body.motto, 200),
        race,
        classes,
        age: integer(body.age, 0, 0, 1000),
        height: text(body.height, 30),
        weight: text(body.weight, 30),
        level,
        points: integer(body.points, 0, -9999, 99999),
        minimumPoints: integer(body.minimumPoints, -10, -9999, 99999),
        guildRank: text(body.guildRank || guilds[0]?.rank, 50),
        guilds,
      },
      attributes,
      combat,
      auxiliary,
      skills,
      customSkills,
      special,
      features: {
        passives: featureList(body.features?.passives),
        campActions,
        abilities: featureList(body.features?.abilities, { withToothCost: true, withRanged: true }),
      },
      inventory: text(body.inventory, 10000),
      notebook: notebookData(body.notebook),
    },
  };
}

function serializeCharacter(row) {
  const data = row.data || {};
  const profile = data.profile || {
    race: data.race || '',
    classes: data.className || '',
    level: Number(data.level || 1),
    age: 0,
    height: '',
    points: 0,
    minimumPoints: -10,
    guildRank: '',
    guilds: [],
  };
  const storedGuilds = guildList(profile.guilds);
  const guilds = storedGuilds.length
    ? storedGuilds
    : profile.guildRank
      ? [{ name: 'Dotychczasowa gildia', rank: text(profile.guildRank, 50), profession: '' }]
      : [];
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => {
    const storedAttribute = data.attributes?.[key] || {};
    const adventure = integer(storedAttribute.adventure, 0, -100, 1000);
    return [key, {
      ...storedAttribute,
      adventure,
      combat: combatAttribute(key, adventure),
    }];
  }));
  const skills = Object.fromEntries(Object.entries(SKILL_BASES).map(([key, baseKey]) => {
    const storedSkill = data.skills?.[key] || {};
    const percent = integer(storedSkill.percent, 0, 0, 1000);
    return [key, {
      ...storedSkill,
      percent,
      result: calculatedSkillValue(attributes[baseKey].adventure, percent),
    }];
  }));
  const customSkills = customSkillList(data.customSkills, attributes);

  return {
    id: Number(row.id),
    name: row.name,
    avatar: profileImage(profile.avatar),
    motto: text(profile.motto, 200),
    race: profile.race || '',
    classes: profile.classes || '',
    className: profile.classes || '',
    age: Number(profile.age || 0),
    height: profile.height || '',
    weight: profile.weight || '',
    level: Number(profile.level || 1),
    points: Number(profile.points || 0),
    minimumPoints: Number(profile.minimumPoints ?? -10),
    guildRank: profile.guildRank || '',
    guilds,
    attributes,
    combat: data.combat || {},
    auxiliary: characterAuxiliary(data.auxiliary, attributes),
    skills,
    customSkills,
    special: data.special || {},
    features: {
      passives: featureList(data.features?.passives),
      campActions: featureList(data.features?.campActions, { withDuration: true }),
      abilities: featureList(data.features?.abilities, { withToothCost: true, withRanged: true }),
    },
    inventory: data.inventory || '',
    notebook: notebookData(data.notebook),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCharacterId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function listCharacters(req, res) {
  const result = await pool.query(
    `SELECT id, name, data, created_at, updated_at
     FROM characters
     WHERE owner_id = $1
     ORDER BY updated_at DESC, id DESC`,
    [req.user.id]
  );
  return res.json(result.rows.map(serializeCharacter));
}

async function getCharacter(req, res) {
  const id = parseCharacterId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_character_id' });
  const result = await pool.query(
    `SELECT id, name, data, created_at, updated_at
     FROM characters
     WHERE id = $1 AND owner_id = $2`,
    [id, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'character_not_found' });
  return res.json(serializeCharacter(result.rows[0]));
}

async function createCharacter(req, res) {
  const character = parseCharacterPayload(req.body);
  if (character.error) return res.status(400).json({ error: character.error });
  const result = await pool.query(
    `INSERT INTO characters (owner_id, name, data)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, name, data, created_at, updated_at`,
    [req.user.id, character.name, JSON.stringify(character.data)]
  );
  return res.status(201).json(serializeCharacter(result.rows[0]));
}

async function updateCharacter(req, res) {
  const id = parseCharacterId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_character_id' });
  const character = parseCharacterPayload(req.body);
  if (character.error) return res.status(400).json({ error: character.error });
  const result = await pool.query(
    `UPDATE characters
     SET name = $1, data = $2::jsonb, updated_at = NOW()
     WHERE id = $3 AND owner_id = $4
     RETURNING id, name, data, created_at, updated_at`,
    [character.name, JSON.stringify(character.data), id, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'character_not_found' });
  return res.json(serializeCharacter(result.rows[0]));
}

async function deleteCharacter(req, res) {
  const id = parseCharacterId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_character_id' });
  const result = await pool.query(
    `DELETE FROM characters WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [id, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'character_not_found' });
  return res.status(204).end();
}

async function updateCharacterInventory(req, res) {
  const id = parseCharacterId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_character_id' });
  const inventory = text(req.body?.inventory, 10000);
  const result = await pool.query(
    `UPDATE characters
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{inventory}', to_jsonb($1::text), true),
         updated_at = NOW()
     WHERE id = $2 AND owner_id = $3
     RETURNING id, name, data, created_at, updated_at`,
    [inventory, id, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'character_not_found' });
  return res.json(serializeCharacter(result.rows[0]));
}

async function updateCharacterNotebook(req, res) {
  const id = parseCharacterId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid_character_id' });
  const notebook = notebookData(req.body?.notebook);
  const result = await pool.query(
    `UPDATE characters
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{notebook}', $1::jsonb, true),
         updated_at = NOW()
     WHERE id = $2 AND owner_id = $3
     RETURNING id, name, data, created_at, updated_at`,
    [JSON.stringify(notebook), id, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'character_not_found' });
  return res.json({ notebook: serializeCharacter(result.rows[0]).notebook });
}

module.exports = {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  updateCharacter,
  updateCharacterInventory,
  updateCharacterNotebook,
  serializeCharacter,
};
