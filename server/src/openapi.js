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
  ['get', '/api/campaigns', 'Lista kampanii'],
  ['post', '/api/campaigns', 'Utworzenie kampanii'],
  ['post', '/api/campaigns/{id}/invitations', 'Zaproszenie do kampanii'],
  ['get', '/api/campaign-invitations', 'Zaproszenia do kampanii'],
  ['post', '/api/campaign-invitations/{id}/respond', 'Odpowiedź na zaproszenie'],
  ['get', '/api/campaigns/{id}/dm', 'Panel DM'],
  ['put', '/api/campaigns/{id}/dm/note', 'Notatka DM'],
  ['get', '/api/campaigns/{campaignId}/dm/characters/{characterId}', 'Pełna karta dla DM'],
  ['put', '/api/campaigns/{campaignId}/dm/characters/{characterId}/note', 'Notatka DM o postaci'],
  ['post', '/api/campaigns/{campaignId}/dm/characters/{characterId}/inventory', 'Przedmiot od DM'],
  ['get', '/api/characters/{characterId}/teams', 'Drużyny postaci'],
  ['get', '/api/campaigns/{campaignId}/characters/{characterId}', 'Karta członka kampanii'],
  ['delete', '/api/characters/{characterId}/campaigns/{campaignId}', 'Opuszczenie kampanii'],
];

function parameters(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'integer', minimum: 1 },
  }));
}

const paths = {};
for (const [method, path, summary, secured = true] of operations) {
  paths[path] ||= {};
  paths[path][method] = {
    summary,
    tags: [path.split('/')[2] || 'system'],
    ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
    parameters: parameters(path),
    ...(method === 'get' || method === 'delete'
      ? {}
      : {
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        }),
    responses: {
      200: { description: 'Sukces' },
      204: { description: 'Sukces bez treści' },
      400: { description: 'Nieprawidłowe dane' },
      401: { description: 'Brak autoryzacji' },
      404: { description: 'Nie znaleziono' },
      500: { description: 'Błąd serwera' },
    },
  };
}

const openapiDocument = {
  openapi: '3.1.0',
  info: { title: 'D&D Companion API', version: require('../../release.json').version },
  servers: [{ url: 'https://dndcompanion-api.onrender.com' }],
  paths,
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
};

module.exports = { openapiDocument };
