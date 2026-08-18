# Panel DM — realizacja Etapu 0 i Etapu 1

Aktualizacja: 2026-08-18

## Wynik audytu (Etap 0)

- Backend korzysta z Express i PostgreSQL; logika kampanii znajduje się w `server/src/campaigns.js`, a routing w `server/src/server.js`.
- Frontend PWA/Capacitor jest aplikacją bez frameworka, której główny widok znajduje się w `mobile/src/main.js`, a style w `mobile/src/style.css`.
- Dostęp do Panelu DM jest sprawdzany na backendzie przez właściciela kampanii. Gracz i osoba spoza kampanii nie otrzymują dostępu do endpointów DM.
- Dotychczasowy Panel DM pobierał listę członków, po czym równolegle pobierał i renderował pełną kartę każdej postaci w karuzeli.
- Prywatne notatki DM są przechowywane w `campaign_dm_notes` oraz `campaign_character_dm_notes`.
- Dodawanie przedmiotu przez DM korzysta z istniejącego formatu ekwipunku postaci i osobnego chronionego endpointu.
- Test integracyjny kampanii znajduje się w `server/scripts/smoke-friends.js`; testy przeglądarkowe korzystają z Playwright.
- Nie znaleziono instrukcji `AGENTS.md` obowiązujących katalog główny. Plik w `expo-preview/` dotyczy wyłącznie tego podkatalogu.

## Zrealizowany Etap 1

- dodano responsywną nawigację: Pulpit, Sesje, Drużyna, Kampania, Materiały i Ustawienia;
- Panel DM otwiera się domyślnie na Pulpicie;
- dodano lekki endpoint `GET /api/campaigns/:id/dm/dashboard`;
- Pulpit wyświetla nagłówek kampanii, skróconą drużynę, stan notatek i kafelki obszarów kampanii;
- zastąpiono karuzelę pełnych kart listą/siatką członków;
- pełna karta jest pobierana dopiero po wybraniu konkretnej postaci;
- szczegóły postaci podzielono na Podsumowanie, Kartę postaci, Ekwipunek, Notatki DM, Wątki i sekrety oraz Historię;
- zachowano prywatną notatkę ogólną, notatkę o postaci, pełną kartę, notatnik gracza i dodawanie przedmiotów przez DM;
- autosave notatki ogólnej pokazuje stan zapisywania, sukces albo błąd;
- dodano menu szybkich działań „+”;
- dodano stany ładowania, błędu, ponowienia i pustych modułów;
- na telefonie nawigacja jest poziomo przewijana, a na szerokim ekranie działa jako lewy pasek;
- rozszerzono test integracyjny o autoryzację i kontrakt lekkiego Pulpitu.

## Świadomie pozostawione na dalsze etapy

- system wielu notatek DM i migracja starej notatki — Etap 2;
- sesje, sceny i wydarzenia — Etap 3;
- NPC, zadania i wątki — Etap 4;
- lokacje, frakcje i sekrety — Etap 5;
- handouty i pliki — Etap 6;
- historia kampanii, współprowadzący, eksport i archiwizacja — Etap 7.

Sekcje te mają przygotowaną nawigację oraz uczciwy pusty stan. Nie dodano dla nich prowizorycznych tabel, endpointów ani danych udających działające moduły.

## Migracje

Etap 1 nie wymaga migracji bazy. Wykorzystuje istniejące kampanie, członkostwo, postacie i notatki DM. Pierwsza migracja danych będzie potrzebna dopiero w Etapie 2 i musi zachować obecną ogólną notatkę.

## Walidacja

- `npm run lint`;
- `npm run test:unit`;
- `npm run check`;
- `API_BASE=http://127.0.0.1:3010 npm run test:friends --workspace server` przeciwko osobnej lokalnej instancji API.

## Ryzyka i zalecenia przed Etapem 2

- Awatary są przechowywane w danych postaci, więc nawet skrócony Pulpit może pobierać większe Data URL. Zmiany magazynu zdjęć są poza zakresem tego etapu.
- Obecny model uprawnień rozpoznaje wyłącznie właściciela kampanii jako DM. Role współprowadzącego wymagają osobnego projektu autoryzacji i testów.
- Aktualna ogólna notatka pozostaje pojedynczym rekordem. Etap 2 powinien wykonać idempotentną migrację do systemu wielu notatek, bez usuwania starego pola/tabeli w tej samej migracji.
- Widoki nowych modułów nie powinny zostać podłączone do danych gracza, dopóki backend nie zapewni osobnych DTO oraz kontroli widoczności.
