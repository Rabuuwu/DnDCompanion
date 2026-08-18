const operations = [
  ['get', '/health', 'Stan procesu', false],
  ['get', '/ready', 'Gotowość API i bazy', false],
  ['get', '/api/diagnostics/ping', 'Diagnostyka połączenia', false],
  ['get', '/api/app/version', 'Wersja aplikacji', false],
  ['get', '/api/app/changelog', 'Historia zmian', false],
  ['get', '/api/app/privacy', 'Polityka prywatności', false],
  ['get', '/api/app/help', 'Pomoc', false],
  ['post', '/api/auth/login', 'Logowanie', false],
  ['post', '/api/auth/register', 'Rejestracja', false],
  ['post', '/api/auth/refresh', 'Odświeżenie sesji', false],
  ['post', '/api/auth/logout', 'Wylogowanie', false],
  ['post', '/api/auth/change-password', 'Zmiana hasła'],
  ['put', '/api/auth/avatar', 'Zmiana awatara'],
  ['delete', '/api/auth/account', 'Usunięcie konta'],
  ['get', '/api/ui-preferences', 'Preferencje UI'],
  ['put', '/api/ui-preferences', 'Zapis preferencji UI'],
  ['get', '/api/characters', 'Lista postaci'],
  ['post', '/api/characters', 'Utworzenie postaci'],
  ['get', '/api/characters/{id}', 'Pobranie postaci'],
  ['put', '/api/characters/{id}', 'Aktualizacja postaci'],
  ['patch', '/api/characters/{id}/features/order', 'Zapis kolejności umiejętności'],
  ['patch', '/api/characters/{id}/inventory', 'Zapis ekwipunku'],
  ['patch', '/api/characters/{id}/notebook', 'Zapis notatnika'],
  ['delete', '/api/characters/{id}', 'Usunięcie postaci'],
  ['get', '/api/friends', 'Lista znajomych'],
  ['post', '/api/friends/invite', 'Kod zaproszenia znajomego'],
  ['post', '/api/friends/accept', 'Akceptacja zaproszenia znajomego'],
  ['get', '/api/friends/{id}/profile', 'Profil znajomego'],
  ['get', '/api/friends/{id}/messages', 'Strona wiadomości'],
  ['post', '/api/friends/{id}/messages', 'Wysłanie wiadomości'],
  ['delete', '/api/friends/{id}', 'Usunięcie znajomego'],
  ['put', '/api/friends/{id}/nickname', 'Pseudonim znajomego'],
  ['post', '/api/users/{id}/block', 'Zablokowanie użytkownika'],
  ['post', '/api/users/{id}/report', 'Zgłoszenie użytkownika'],
  ['get', '/api/notifications', 'Nieprzeczytane powiadomienia'],
  ['get', '/api/notifications/stream', 'Strumień SSE'],
  ['post', '/api/notifications/campaign-content/{id}/read', 'Odczytano powiadomienie kampanii'],
  ['get', '/api/campaigns', 'Lista kampanii'],
  ['post', '/api/campaigns', 'Utworzenie kampanii'],
  ['post', '/api/campaigns/{id}/invitations', 'Zaproszenie do kampanii'],
  ['get', '/api/campaign-invitations', 'Zaproszenia do kampanii'],
  ['post', '/api/campaign-invitations/{id}/respond', 'Odpowiedź na zaproszenie'],
  ['get', '/api/campaigns/{id}/dm', 'Panel DM'],
  ['get', '/api/campaigns/{id}/dm/dashboard', 'Lekkie podsumowanie Pulpitu DM'],
  ['put', '/api/campaigns/{id}/dm/note', 'Notatka DM'],
  ['get', '/api/campaigns/{campaignId}/dm/characters/{characterId}', 'Pełna karta dla DM'],
  ['put', '/api/campaigns/{campaignId}/dm/characters/{characterId}/note', 'Notatka DM o postaci'],
  ['post', '/api/campaigns/{campaignId}/dm/characters/{characterId}/inventory', 'Przedmiot od DM'],
  ['get', '/api/campaigns/{campaignId}/dm/notes', 'Notatki DM'],
  ['post', '/api/campaigns/{campaignId}/dm/notes', 'Nowa notatka DM'],
  ['put', '/api/campaigns/{campaignId}/dm/notes/{noteId}', 'Aktualizacja notatki DM'],
  ['delete', '/api/campaigns/{campaignId}/dm/notes/{noteId}', 'Archiwizacja notatki DM'],
  ['get', '/api/campaigns/{campaignId}/dm/sessions', 'Lista sesji'],
  ['post', '/api/campaigns/{campaignId}/dm/sessions', 'Nowa sesja'],
  ['get', '/api/campaigns/{campaignId}/dm/sessions/{sessionId}', 'Szczegóły sesji'],
  ['put', '/api/campaigns/{campaignId}/dm/sessions/{sessionId}', 'Aktualizacja sesji'],
  ['post', '/api/campaigns/{campaignId}/dm/sessions/{sessionId}/scenes', 'Nowa scena'],
  ['put', '/api/campaigns/{campaignId}/dm/sessions/{sessionId}/scenes/{sceneId}', 'Aktualizacja sceny'],
  ['post', '/api/campaigns/{campaignId}/dm/sessions/{sessionId}/events', 'Wydarzenie sesji'],
  ['get', '/api/campaigns/{campaignId}/dm/content/{module}', 'Lista elementów kampanii'],
  ['post', '/api/campaigns/{campaignId}/dm/content/{module}', 'Nowy element kampanii'],
  ['put', '/api/campaigns/{campaignId}/dm/content/{module}/{entityId}', 'Aktualizacja elementu kampanii'],
  ['delete', '/api/campaigns/{campaignId}/dm/content/{module}/{entityId}', 'Archiwizacja elementu kampanii'],
  ['get', '/api/campaigns/{campaignId}/dm/quests/{questId}/steps', 'Etapy zadania'],
  ['post', '/api/campaigns/{campaignId}/dm/quests/{questId}/steps', 'Nowy etap zadania'],
  ['put', '/api/campaigns/{campaignId}/dm/quests/{questId}/steps/{stepId}', 'Aktualizacja etapu zadania'],
  ['delete', '/api/campaigns/{campaignId}/dm/quests/{questId}/steps/{stepId}', 'Usunięcie etapu zadania'],
  ['get', '/api/campaigns/{campaignId}/dm/secrets', 'Sekrety kampanii'],
  ['post', '/api/campaigns/{campaignId}/dm/secrets', 'Nowy sekret'],
  ['put', '/api/campaigns/{campaignId}/dm/secrets/{secretId}', 'Aktualizacja sekretu'],
  ['delete', '/api/campaigns/{campaignId}/dm/secrets/{secretId}', 'Archiwizacja sekretu'],
  ['post', '/api/campaigns/{campaignId}/dm/secrets/{secretId}/reveal', 'Ujawnienie sekretu'],
  ['get', '/api/campaigns/{campaignId}/dm/materials', 'Materiały kampanii'],
  ['post', '/api/campaigns/{campaignId}/dm/materials', 'Nowy materiał'],
  ['put', '/api/campaigns/{campaignId}/dm/materials/{materialId}', 'Aktualizacja materiału'],
  ['delete', '/api/campaigns/{campaignId}/dm/materials/{materialId}', 'Archiwizacja materiału'],
  ['post', '/api/campaigns/{campaignId}/dm/materials/{materialId}/share', 'Udostępnienie materiału'],
  ['get', '/api/campaigns/{campaignId}/dm/timeline', 'Historia kampanii'],
  ['post', '/api/campaigns/{campaignId}/dm/timeline', 'Ręczne wydarzenie historii'],
  ['get', '/api/campaigns/{campaignId}/dm/relations', 'Powiązania elementu kampanii'],
  ['post', '/api/campaigns/{campaignId}/dm/relations', 'Nowe powiązanie elementów'],
  ['delete', '/api/campaigns/{campaignId}/dm/relations/{relationId}', 'Usunięcie powiązania'],
  ['get', '/api/campaigns/{campaignId}/dm/settings', 'Ustawienia kampanii'],
  ['put', '/api/campaigns/{campaignId}/dm/settings', 'Aktualizacja kampanii'],
  ['put', '/api/campaigns/{campaignId}/dm/members/{userId}/role', 'Rola członka kampanii'],
  ['delete', '/api/campaigns/{campaignId}/dm/members/{userId}', 'Usunięcie członka kampanii'],
  ['post', '/api/campaigns/{campaignId}/dm/archive', 'Archiwizacja kampanii'],
  ['get', '/api/campaigns/{campaignId}/dm/export', 'Eksport kampanii'],
  ['get', '/api/campaigns/{campaignId}/shared', 'Materiały i wiedza postaci'],
  ['put', '/api/campaigns/{campaignId}/shared/quests/{questId}/notes', 'Wspólne notatki drużyny do zadania'],
  ['get', '/api/characters/{characterId}/teams', 'Drużyny postaci'],
  ['get', '/api/campaigns/{campaignId}/characters/{characterId}', 'Karta członka kampanii'],
  ['delete', '/api/characters/{characterId}/campaigns/{campaignId}', 'Opuszczenie kampanii'],
];

function parameters(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema:
      match[1] === 'module'
        ? { type: 'string', enum: ['npcs', 'locations', 'factions', 'quests', 'threads'] }
        : { type: 'integer', minimum: 1 },
  }));
}

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });

const schemas = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: { error: { type: 'string' }, details: { type: 'object', additionalProperties: true } },
  },
  Credentials: {
    type: 'object',
    required: ['username', 'password'],
    properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } },
  },
  User: {
    type: 'object',
    required: ['id', 'username'],
    properties: {
      id: { type: 'integer' },
      username: { type: 'string' },
      avatar: { type: ['string', 'null'] },
    },
    additionalProperties: true,
  },
  Session: {
    type: 'object',
    required: ['token', 'refreshToken'],
    properties: {
      token: { type: 'string' },
      refreshToken: { type: 'string' },
      user: ref('User'),
    },
    additionalProperties: true,
  },
  Character: {
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      inventory: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] },
      attributes: { type: 'object', additionalProperties: true },
      auxiliary: { type: 'object', additionalProperties: true },
      features: { type: 'object', additionalProperties: true },
    },
    additionalProperties: true,
  },
  CharacterInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      inventory: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] },
      attributes: { type: 'object', additionalProperties: true },
      features: { type: 'object', additionalProperties: true },
    },
    additionalProperties: true,
  },
  Message: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer' },
      body: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    additionalProperties: true,
  },
  Campaign: {
    type: 'object',
    required: ['id', 'name'],
    properties: { id: { type: 'integer' }, name: { type: 'string' }, ownerId: { type: 'integer' } },
    additionalProperties: true,
  },
};

function requestSchema(method, path) {
  if (path === '/api/auth/login' || path === '/api/auth/register') return ref('Credentials');
  if (path === '/api/auth/refresh' || path === '/api/auth/logout') {
    return {
      type: 'object',
      required: ['refreshToken'],
      properties: { refreshToken: { type: 'string' } },
    };
  }
  if (path === '/api/auth/account') {
    return { type: 'object', required: ['password'], properties: { password: { type: 'string', minLength: 1 } } };
  }
  if (path === '/api/characters' || path === '/api/characters/{id}') return ref('CharacterInput');
  if (path === '/api/characters/{id}/inventory') {
    return {
      type: 'object',
      required: ['inventory'],
      properties: { inventory: schemas.CharacterInput.properties.inventory },
    };
  }
  if (path === '/api/characters/{id}/notebook') {
    return { type: 'object', additionalProperties: true };
  }
  if (path === '/api/friends/{id}/messages') {
    return { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1 } } };
  }
  if (path === '/api/campaigns') {
    return { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } };
  }
  return { type: 'object', additionalProperties: true };
}

function successSchema(method, path) {
  if (['/api/auth/login', '/api/auth/register', '/api/auth/refresh'].includes(path)) return ref('Session');
  if (path === '/api/characters')
    return method === 'get' ? { type: 'array', items: ref('Character') } : ref('Character');
  if (path === '/api/characters/{id}') return ref('Character');
  if (path === '/api/friends/{id}/messages') {
    return method === 'get' ? { type: 'array', items: ref('Message') } : ref('Message');
  }
  if (path === '/api/campaigns') return method === 'get' ? { type: 'array', items: ref('Campaign') } : ref('Campaign');
  return { type: 'object', additionalProperties: true };
}

const paths = {};
for (const [method, path, summary, secured = true] of operations) {
  const hasRequestBody = !['get'].includes(method) && (method !== 'delete' || path === '/api/auth/account');
  paths[path] ||= {};
  paths[path][method] = {
    summary,
    tags: [path.split('/')[2] || 'system'],
    ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
    parameters: parameters(path),
    ...(!hasRequestBody
      ? {}
      : {
          requestBody: { required: true, content: json(requestSchema(method, path)) },
        }),
    responses: {
      200: { description: 'Sukces', content: json(successSchema(method, path)) },
      ...(method === 'post' ? { 201: { description: 'Utworzono', content: json(successSchema(method, path)) } } : {}),
      204: { description: 'Sukces bez treści' },
      400: { description: 'Nieprawidłowe dane', content: json(ref('Error')) },
      401: { description: 'Brak autoryzacji', content: json(ref('Error')) },
      404: { description: 'Nie znaleziono', content: json(ref('Error')) },
      500: { description: 'Błąd serwera', content: json(ref('Error')) },
    },
  };
}

const openapiDocument = {
  openapi: '3.1.0',
  info: { title: 'D&D Companion API', version: require('../../release.json').version },
  servers: [{ url: 'https://dndcompanion-api.onrender.com' }],
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas,
  },
};

module.exports = { openapiDocument };
