# DnDCompanion — przegląd inżynierski

Data: 2026-10-22. Zakres: lokalny kod, bez produkcyjnej bazy, wdrożeń i penetracji. Stan początkowy Git: czysty. Branch zmian: `career/dnd-engineering-audit`.

## Baseline i środowisko

- `../_tools/devhouse test DnDCompanion` z katalogu nadrzędnego: exit 2, brak zależności.
- `node --test tests/unit/*.test.js` z Node 24.22.0 uruchomionym absolutną ścieżką: 4 istniejące testy inventory PASS; plik formula-schema nie uruchamia się, bo importuje `characters.js` → `db.js` → brak `pg`.
- Domyślny PATH w shellu projektu nie zawiera Node/npm. Runtime: `/Users/macminisk/.nvm/versions/node/v24.22.0/bin`.
- Brak połączenia z bazą i uruchamiania migracji. Brak podstaw do podania benchmarków, Core Web Vitals czy procentowego pokrycia całej aplikacji.

## Ustalenia i implementacja

| Priorytet | Dowód | Wniosek / działanie |
|---|---|---|
| P1 | `server/scripts/smoke-auth.js`, `smoke-friends.js`, `test-migrations.js` ładowały repo `.env` i wykonywały operacje zapisujące bez sprawdzenia środowiska | Dodano `test-safety.js` przed importami: jawne NODE_ENV=test i PostgreSQL DATABASE_URL z osobnym segmentem test w nazwie. To zapobiega przypadkowemu użyciu domyślnej konfiguracji. Administrator nadal musi wskazać izolowane API/bazę; sama nazwa nie gwarantuje izolacji. |
| P2 | `server/src/server.js` globalny handler zwracał zawsze 500 i logował surowy stack | `http-errors.js`: malformed JSON → 400, limit body → 413, niedozwolony origin → 403. Pozostałe wyjątki → opaque 500; log z requestId zamiast potencjalnych danych SQL/body. |
| P2 | `mobile/src/main.js`: 5838 linii; `server/src/dm-workspace.js`: 1149 linii | Duże moduły zwiększają koszt zmian i potrzebę testów regresji. Wydzielać pionowe funkcje, zaczynając od DM/edycji postaci; bez masowego przepisywania teraz. |
| P2 | `tests/unit/formula-schema.test.js` importuje moduł związany z bazą | Jednostkowe testy schematu wymagają pakietu pg. Kolejny krok: wydzielenie czystej walidacji i testów kontraktów. |
| P3 | README deklarowało localStorage, `mobile/src/session-store.js` używa sessionStorage i natywnego SecureStorage | Skorygowano dokumentację do kodu. SessionStorage nie eliminuje ryzyka XSS. |

Nie potwierdzono exploitable SQL injection ani BOLA. To nie oznacza pełnego dowodu ich braku. `dm-workspace.js` używa parametrów dla wartości i zakresów campaign_id; autoryzacja zależy od membership i ról. Należy dodać macierz testów owner/DM/member/outsider dla każdego zasobu, szczególnie eksportu i sekretów.

## Architektura i ADR

Decyzja: zachować modularny monolit Express/PostgreSQL i istniejący node:test; bez nowych zależności i usług. Handler HTTP jest osobnym, czystym modułem, by sprawdzać kontrakt błędów bez startu serwera i bazy. Nie przenosimy całej logiki do nowego frameworka. Konsekwencja: testy jednostkowe handlera nie zastępują testu prawdziwego parsera/Express.

Dowody istniejących rozwiązań: `auth.js` — HS256 z issuer/audience, bcrypt, hashe refresh tokenów i rotacja w transakcji z FOR UPDATE; `server.js` — helmet, allowlist CORS, rate limitery, /health, /ready, shutdown; `db.js` — pool i verify TLS; `audit.js` — metadane z pominięciem pól haseł/tokenów.

Ograniczenia: projekt jest w JavaScript, nie TypeScript — `check` sprawdza składnię, nie jest typecheckiem. Token dostępu pozostaje ważny do TTL po zmianie hasła; nie zmieniano semantyki sesji. Bieżący trust proxy=1 wymaga dokładnie kontrolowanej topologii reverse proxy.

## Testy i weryfikacja

Dodano 10 testów node:test: 7 kontraktu błędów HTTP, 3 guardu środowiska (w tym wiele wariantów wejścia). Polecenie `node --test tests/unit/http-errors.test.js tests/unit/test-safety.test.js tests/unit/inventory-schema.test.js`: **14/14 PASS**, w tym 4 istniejące testy. `npm run check --workspace server`: PASS. `git diff --check`: PASS.

Brak lokalnego potwierdzenia pełnego build/lint/format, API integracyjnego, migracji i Playwright do czasu instalacji zależności oraz przygotowania izolowanego PostgreSQL. Nie podajemy fikcyjnego coverage. Warto dodać E2E błędnego JSON, limitu payload, autoryzacji między kontami i wygasania sesji.

## DevOps i performance

`.github/workflows/ci.yml` już zawiera check, lint, format, unit, audit, migracje w PostgreSQL 18, testy auth/friends i Playwright. `codeql.yml` zapewnia analizę statyczną; `database-backup.yml` zawiera pg_dump, test restore oraz szyfrowanie age. Obecność workflow nie dowodzi jego zaliczenia ani poprawnej konfiguracji sekretów. Nie uruchamiano zdalnych workflow ani backupów.

Nie przeprowadzono optymalizacji ani pomiarów działającej aplikacji; brak before/after. Następny krok: reprezentatywna lokalna baza i p50/p95 API, EXPLAIN ANALYZE dla list kampanii/wiadomości oraz build bundle i Lighthouse na lokalnym buildzie.

## Case study i rozmowa

Problem: jeden zestaw danych postaci/kampanii w PWA i kliencie mobilnym. Architektura wspólnego klienta Capacitor + Express/PostgreSQL ogranicza liczbę implementacji. Wyzwaniem jest poufność materiałów DM i spójność współdzielonych operacji. Kod ma transakcje i kontrolę ról, ale pełny dowód zachowania wymaga wykonywalnej macierzy uprawnień. Dzisiejsza poprawka dotyczy bezpiecznego uruchamiania testów i poprawnych odpowiedzi błędów; nie stanowi dowodu komercyjnego doświadczenia autora.

Do samodzielnego opanowania: wyjaśnij rotację refresh tokenów z blokadą wiersza, narysuj model uprawnień DM/member, napisz test outsiders vs secrets, wydziel czystą walidację z characters.js, zmierz zapytanie EXPLAIN na bazie testowej. Kryterium: działający test przed/po zmianie, umiejętność uzasadnienia trade-offów bez pomocy generatora.

Końcowa próba `npm ci --ignore-scripts --cache /private/tmp/dnd-career-npm-cache`: FAIL ENOTFOUND registry.npmjs.org (DNS). Pełne `npm run test:unit`: 14 PASS + jeden plik formula-schema zablokowany przez brak pg.
