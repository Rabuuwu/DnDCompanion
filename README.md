# D&D Companion

Mobilny companion do prowadzenia postaci i kampanii RPG. Jeden frontend działa jako aplikacja Android/iOS (Capacitor) oraz instalowalna PWA, a dane synchronizuje z API Node.js i PostgreSQL.

> Status: aktywny rozwój, wersja aplikacji `1.5.5`. PWA i API mają wdrożenie internetowe, a podpisany APK jest publikowany przez GitHub Releases.

## Najważniejsze funkcje

- tworzenie, edycja i biblioteka postaci z awatarem, mottem, wagą, statystykami i umiejętnościami;
- automatyczne wyliczanie statystyk bojowych, pomocniczych i podstatystyk, z możliwością własnych wartości oraz wzorów;
- ekwipunek z ikonami, ilością, czasem trwania, edycją i kolejnością zapisywaną dla postaci;
- obozówki, pasywki i umiejętności z cooldownem, czasem trwania, formatowaniem opisów i wzorami ataków zasięgowych;
- notatnik tekstowy oraz nieskończona kartka do rysowania z zoomem, przesuwaniem i gumką; automatyczny zapis;
- znajomi, zaproszenia, pseudonimy, wiadomości, blokowanie i zgłoszenia;
- kampanie z wyborem postaci, drużyną, zaproszeniami i opuszczaniem kampanii;
- Panel DM: pełny podgląd członków, prywatne notatki ogólne i per postać oraz dodawanie przedmiotów;
- powiadomienia o wiadomościach i zaproszeniach oraz automatyczne odświeżanie aktywnego czatu;
- konta, awatary, zmiana hasła, usuwanie konta, preferencje interfejsu i historia zmian aplikacji.

Pełny katalog możliwości znajduje się w [docs/FUNKCJE.md](docs/FUNKCJE.md).

## Architektura

```text
Android / iOS / PWA
        │ HTTPS / JSON / SSE
        ▼
Express API :3000 ─── PostgreSQL
        ▲
        │ /api przekazywane przez Vite preview
PWA :443 + strona pobierania :80 + lokalny DNS :53
```

- `mobile/` — wspólny frontend Vite i projekty natywne Capacitor;
- `server/` — API Express, autoryzacja, walidacja i migracje PostgreSQL;
- `expo-preview/` — pomocniczy podgląd deweloperski Expo, nie jest produkcyjnym klientem;
- `deploy/` — jednostki systemd, konfiguracja DNS i materiały wdrożeniowe;
- `docs/` — dokumentacja architektury, API, bazy, wydań i audytu.

Szczegóły: [architektura](docs/ARCHITEKTURA.md), [API](docs/API.md), [baza danych](docs/BAZA_DANYCH.md).

## Uruchomienie deweloperskie

Wymagania: Node.js 22+, npm i PostgreSQL.

```bash
npm install
cp .env.example .env
# ustaw DATABASE_URL i losowy JWT_SECRET o długości co najmniej 64 znaków
npm run db:migrate
npm run dev:server
```

W drugim terminalu:

```bash
npm run dev:mobile
```

Domyślnie frontend działa pod `http://localhost:5173`, a API pod `http://localhost:3000`. Do testu gotowości służą `GET /health` i `GET /ready`.

## Budowanie

```bash
npm run check             # kontrola składni serwera + build web
npm run build             # frontend web
npm run build:pwa --workspace mobile
npm run build:apk --workspace mobile # wymaga zmiennych podpisujących
```

Skrypt APK generuje podpisany `mobile/release/DnDCompanion-<wersja>.apk` oraz SHA-256. Sekrety podpisujące są wymagane w środowisku lokalnym lub GitHub Actions. Procedura wydań: [docs/ROZWOJ_I_WYDANIA.md](docs/ROZWOJ_I_WYDANIA.md).

## Instalacja Android

1. Otwórz sekcję **Releases** repozytorium i wybierz najnowszą wersję.
2. Pobierz `DnDCompanion-<wersja>.apk` oraz opcjonalnie sprawdź dołączoną sumę SHA-256.
3. Zezwól użytej przeglądarce lub menedżerowi plików na instalację z tego źródła.
4. Otwórz APK i potwierdź instalację. Kolejne wersje instaluj bez usuwania aplikacji, aby zachować lokalne ustawienia.

Pobieraj APK wyłącznie z [oficjalnych GitHub Releases](https://github.com/Rabuuwu/DnDCompanion/releases).

## Konfiguracja

Najważniejsze zmienne z `.env`:

| Zmienna | Znaczenie |
|---|---|
| `DATABASE_URL` | adres PostgreSQL |
| `DATABASE_SSL` | włączenie SSL połączenia z bazą |
| `JWT_SECRET` | sekret podpisu JWT, minimum 64 znaki |
| `JWT_ACCESS_TTL` | czas życia tokenu dostępowego |
| `REFRESH_TOKEN_DAYS` | czas życia tokenu odświeżającego |
| `CORS_ORIGINS` | dozwolone originy rozdzielone przecinkami |

Wersja Androida, `versionCode`, identyfikator pakietu i repozytorium wydania znajdują się wyłącznie w `release.json`. API i proces budowania generują z niego numer oraz adres APK automatycznie.

Nie commituj `.env`, certyfikatów, kluczy ani paczek instalacyjnych. Są wykluczone w `.gitignore`.

## Testy i jakość

```bash
npm run check
npm run lint
npm run format:check
npm run test:unit
npm run test:auth --workspace server
npm run test:friends --workspace server
API_BASE=http://127.0.0.1:3000 npm run test:security --workspace server
npm audit
npm run hooks:install # jednorazowo włącza lokalny pre-commit
```

Testy `test:unit` nie uruchamiają API. Skrypty `test:auth`, `test:friends` i `test:migrations` są integracyjne: wymagają jawnych `NODE_ENV=test` i `DATABASE_URL` z nazwą bazy zawierającą osobny segment `test` (np. `dnd_test`). Guard działa przed odczytem `.env`. Skonfiguruj również `API_BASE` na izolowane API testowe; nazwa bazy nie dowodzi izolacji serwera. Nie uruchamiaj ich przeciw produkcji. Przykład: `NODE_ENV=test DATABASE_URL=postgresql://localhost/dnd_test npm run test:auth --workspace server`.

## Bezpieczeństwo i ograniczenia

- domena `dndcompanion.pl` jest obecnie rozwiązywana przez lokalny DNS na `192.168.1.5`;
- lokalny certyfikat CA musi być zaufany na urządzeniu, aby PWA działała poprawnie po HTTPS;
- tokeny klienta web są przechowywane w `sessionStorage`, a na urządzeniach natywnych przez SecureStorage (`mobile/src/session-store.js`); XSS nadal zagraża sesji web;
- narzędzia budowania Vite/Capacitor mają znane podatności opisane w [raporcie audytu](docs/AUDYT.md);
- logi audytowe, tokeny i wiadomości wymagają polityki retencji oraz automatycznego sprzątania.

Zgłoszenie podatności powinno odbywać się prywatnie do właściciela wdrożenia, bez publikowania sekretów i danych użytkowników.

Szczegóły: [polityka bezpieczeństwa](SECURITY.md) i [polityka prywatności](PRIVACY.md).

Monitoring dostępności przez UptimeRobot opisuje [docs/MONITORING.md](docs/MONITORING.md).

## Licencja i zasoby

Kod jest udostępniony na zasadzie „wszelkie prawa zastrzeżone”; szczegóły zawiera [LICENSE](LICENSE). Zasoby zewnętrzne podlegają osobnym warunkom opisanym w [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Przegląd inżynierski

Dowody, wyniki lokalnych testów i ograniczenia weryfikacji: [audyt career engineering](docs/career-engineering-audit.md).

### Izolowana weryfikacja bezpieczeństwa i odtwarzania

`python3 scripts/run-isolated-career-verification.py` wymaga zainstalowanych zależności, Node w PATH i lokalnych binariów PostgreSQL 17 (`CAREER_PG_BIN`, domyślnie `/usr/local/opt/postgresql@17/bin`). Tworzy jednorazowy klaster i dwie bazy testowe, kopiuje API bez `.env`, uruchamia migracje, smoke auth/friends i testy dostępu/współbieżności, następnie wykonuje `pg_dump`/`pg_restore` i porównuje fixture użytkownika oraz rejestr migracji. Na końcu zatrzymuje procesy i usuwa wyłącznie własny katalog tymczasowy. Test sprawdza lokalną odtwarzalność danych; nie dowodzi kompletności produkcyjnej polityki backupów ani RPO/RTO.

`node scripts/verify-career-regressions.mjs` sprawdza pięć celowych regresji w kopiach tymczasowych bez modyfikacji źródeł.
