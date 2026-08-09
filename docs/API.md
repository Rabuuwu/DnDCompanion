# API D&D Companion

## Konwencje

- Bazowy adres deweloperski: `http://localhost:3000`.
- Format: JSON; maksymalny body: 1 MB.
- Chronione endpointy wymagają `Authorization: Bearer <JWT>`.
- Identyfikatory są dodatnimi liczbami całkowitymi.
- Błędy mają zwykle format `{ "error": "kod_bledu" }`.
- `204 No Content` oznacza poprawną operację bez odpowiedzi.
- Endpointy logowania i wrażliwych operacji mają limit 20 prób na 15 minut dla klienta.

## Diagnostyka i treści publiczne

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/health` | stan procesu i uptime |
| GET | `/ready` | gotowość wraz z testem bazy |
| GET | `/api/diagnostics/ping` | diagnostyka połączenia i request ID |
| GET | `/api/app/version` | wersje i adresy pakietów |
| GET | `/api/app/changelog` | lista zmian |
| GET | `/api/app/privacy` | polityka prywatności |
| GET | `/api/app/help` | treści Centrum pomocy |

## Konto i sesja

| Metoda | Ścieżka | Body / działanie |
|---|---|---|
| POST | `/api/auth/register` | `{ username, password }` |
| POST | `/api/auth/login` | `{ username, password }` |
| POST | `/api/auth/refresh` | `{ refreshToken }`; rotuje token |
| POST | `/api/auth/logout` | `{ refreshToken }`; unieważnia token |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` |
| PUT | `/api/auth/avatar` | `{ avatar }`, Data URL JPEG/PNG/WebP lub pusty ciąg |
| DELETE | `/api/auth/account` | `{ password }`; trwałe usunięcie konta |

Rejestracja, logowanie i odświeżenie zwracają `{ token, refreshToken, expiresIn, user }`. Nazwa użytkownika ma 3–50 znaków (`A-Z`, `a-z`, cyfry, `_`, `.`, `-`), a hasło 8–128 znaków.

## Preferencje UI

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/ui-preferences` | pobranie ustawień użytkownika |
| PUT | `/api/ui-preferences` | zapis obiektu `{ settings }` |

## Postacie

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/characters` | biblioteka właściciela |
| POST | `/api/characters` | utworzenie pełnym payloadem formularza |
| GET | `/api/characters/:id` | pełna postać właściciela |
| PUT | `/api/characters/:id` | pełna aktualizacja |
| PATCH | `/api/characters/:id/inventory` | `{ inventory }` |
| PATCH | `/api/characters/:id/notebook` | `{ notebook }` |
| DELETE | `/api/characters/:id` | trwałe usunięcie |

Serwer ogranicza rozmiary list i tekstów oraz ponownie wylicza wartości zależne. Payload postaci obejmuje profil, statystyki, własne podstatystyki, gildie, cechy, ekwipunek i notatnik; źródłem dokładnego kontraktu jest `parseCharacterPayload` w `server/src/characters.js`. Brakuje obecnie formalnego schematu OpenAPI — jest to pozycja w planie poprawek.

## Znajomi, wiadomości i bezpieczeństwo społeczne

| Metoda | Ścieżka | Body / opis |
|---|---|---|
| GET | `/api/friends` | lista relacji i licznik nieprzeczytanych |
| POST | `/api/friends/invite` | utworzenie czasowego kodu |
| POST | `/api/friends/accept` | `{ code }` |
| GET | `/api/friends/:id/profile` | profil znajomego |
| GET | `/api/friends/:id/messages?limit=50&before=<id>` | strona wiadomości; nagłówki `X-Has-More` i `X-Next-Cursor`; oznacza odebrane jako przeczytane |
| POST | `/api/friends/:id/messages` | `{ body }`, 1–2000 znaków |
| PUT | `/api/friends/:id/nickname` | `{ nickname }` |
| DELETE | `/api/friends/:id` | usuwa relację |
| POST | `/api/users/:id/block` | blokuje użytkownika i usuwa relację |
| POST | `/api/users/:id/report` | `{ reason, details }` |

## Powiadomienia

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/notifications` | nieprzeczytane wiadomości i oczekujące zaproszenia |
| GET | `/api/notifications/stream` | SSE; token jest przekazywany zgodnie z mechanizmem klienta |

Typy zdarzeń SSE obejmują `connected`, `message` i `campaign`. Broker jest lokalny dla procesu API.

## Kampanie

| Metoda | Ścieżka | Body / opis |
|---|---|---|
| GET | `/api/campaigns?limit=50&offset=0` | kampanie właściciela; nagłówki `X-Has-More` i `X-Next-Offset` |
| POST | `/api/campaigns` | `{ name }` |
| POST | `/api/campaigns/:id/invitations` | `{ friendId, characterId }`; postać DM |
| GET | `/api/campaign-invitations` | oczekujące zaproszenia użytkownika |
| POST | `/api/campaign-invitations/:id/respond` | `{ action: "accept"|"decline", characterId? }`; postać wymagana przy akceptacji |
| GET | `/api/characters/:characterId/teams` | drużyny i podstawowy widok ich postaci |
| GET | `/api/campaigns/:campaignId/characters/:characterId` | widok postaci członka kampanii |
| DELETE | `/api/characters/:characterId/campaigns/:campaignId` | opuszczenie kampanii daną postacią |

## Panel DM

Wszystkie endpointy wymagają, aby zalogowany użytkownik był właścicielem kampanii.

| Metoda | Ścieżka | Body / opis |
|---|---|---|
| GET | `/api/campaigns/:id/dm` | kampania, członkowie i prywatna notatka DM |
| PUT | `/api/campaigns/:id/dm/note` | `{ content }`, maks. 50 000 znaków |
| GET | `/api/campaigns/:campaignId/dm/characters/:characterId` | pełna karta i notatka o postaci |
| PUT | `/api/campaigns/:campaignId/dm/characters/:characterId/note` | `{ content }` |
| POST | `/api/campaigns/:campaignId/dm/characters/:characterId/inventory` | `{ item }`; dodaje przedmiot i zwraca nowy ekwipunek |

## Kody statusów

- `200/201/204` — sukces;
- `400` — błędny payload lub identyfikator;
- `401` — brak/wygaśnięcie sesji albo błędne dane logowania;
- `403` — blokada lub niedozwolony dostęp;
- `404` — brak zasobu w zakresie użytkownika;
- `409` — konflikt, np. nazwa lub oczekujące zaproszenie;
- `429` — limit prób;
- `500/503` — błąd serwera lub brak gotowości.
