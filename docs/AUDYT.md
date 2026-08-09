# Audyt repozytorium — 2026-08-09

## Zakres i metoda

Przejrzano strukturę repozytorium, konfigurację npm, frontend/PWA/Capacitor, API, migracje i model danych, jednostki systemd/DNS, dokumentację, stan Git oraz raport `npm audit`. Wykonano kontrolę składni i build po zmianach. Audyt nie jest formalnym testem penetracyjnym ani przeglądem prawnym.

## Zmiany wykonane

- naprawiono błąd `ReferenceError` po utworzeniu kampanii: powiadomienie używało nieistniejącego `friendId`;
- przeniesiono publikację zdarzenia do właściwego przepływu zapraszania do kampanii;
- zaktualizowano Vite, Capacitor i zależności; pełny `npm audit` nie zgłasza podatności;
- skonfigurowano finalny identyfikator Androida, podpisany build release, kontrolę spójności wersji oraz workflow wydań;
- dodano CI z PostgreSQL, migracją od pustej bazy, buildem, ESLint, Prettier, skanowaniem sekretów i testami API/UI;
- dodano CSP, wymuszono HTTPS/zakaz cleartext w Androidzie i ograniczono backup danych aplikacji przez system;
- zastąpiono lokalny broker powiadomień przez PostgreSQL `LISTEN/NOTIFY` zgodny z wieloma instancjami API;
- dodano automatyczną retencję logów, tokenów i nieaktualnych zaproszeń;
- dodano szyfrowany backup PostgreSQL z testowym odtworzeniem w workflow GitHub Actions;
- dodano politykę bezpieczeństwa, politykę prywatności i szablon informacji o wydaniu;
- zaktualizowano README oraz dokumentację architektury, API, bazy, funkcji i wydań;
- urealniono treść prywatności i pomocy w zakresie kampanii, DM i logów;
- rozszerzono `.gitignore` o lokalne/generowane artefakty;
- dodano informacje o zasobach zewnętrznych.

## Ustalenia według priorytetu

### P0 — przed publicznym udostępnieniem

1. **Magazyn sesji klienta.** CSP ogranicza ryzyko XSS, ale JWT i refresh token nadal są w `localStorage`. PWA powinna docelowo używać ciastek `HttpOnly`, `Secure`, `SameSite`; aplikacje natywne — systemowego bezpiecznego magazynu.
2. **Operacyjny backup produkcji.** Workflow jest gotowy, lecz właściciel musi skonfigurować sekrety `RENDER_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, zmienną `BACKUPS_ENABLED=true` i bezpiecznie przechować prywatny klucz age.
3. **Licencje.** Trzeba wybrać licencję kodu oraz potwierdzić autora i warunki wszystkich ikon, zwłaszcza zasobu Flaticon, przed publikacją wydania.

### P1 — wysoki priorytet jakości i bezpieczeństwa

1. Rozszerzać testy UI Playwright wraz z kolejnymi krytycznymi przepływami; obecnie obejmują auth, utworzenie postaci i ekwipunek.
2. Rozdzielić `mobile/src/main.js` (~4,3 tys. linii) i `style.css` (~3 tys. linii) na moduły: API, auth, router, formularz postaci, kampanie/DM, chat, notatnik i komponenty UI.
3. Dodać zewnętrzny monitoring dostępności, błędów i czasu odpowiedzi oraz alerty o nieudanych backupach.
4. Uporządkować uprawnienia kampanii: dodać jawne operacje usunięcia kampanii, przekazania DM i zmiany postaci.
5. Zastąpić Vite Preview i `python -m http.server` przez Caddy/nginx w stabilnym wdrożeniu LAN.

### P2 — utrzymanie i rozwój

1. Przenieść awatary z Data URL w PostgreSQL do magazynu plików/object storage; teraz zwiększają rekordy, odpowiedzi i pamięć klienta.
2. Dodać paginację wiadomości, kampanii i logów; rozmowa zwraca tylko ostatnie 100 wpisów.
3. Opisać kontrakt OpenAPI/JSON Schema i generować walidację/klienta, zamiast polegać wyłącznie na kodzie parsera.
4. Ujednolicić migracje: istniejące dwa prefiksy `006` pozostawić bez zmian, kolejne numerować jednoznacznie i dodać test migracji od pustej bazy.
5. Przenieść stare jednostki `dnd-web.service`, `dnd-pwa.service` i `dnd-download.service` do `deploy/legacy` po potwierdzeniu, że host ich nie używa.
6. Rozszerzyć CI o pełną analizę statyczną i skan zależności obrazu/artefaktu Android.
7. Dodać telemetrykę błędów pozbawioną danych wrażliwych oraz metryki zdrowia, opóźnień i rozmiaru DB.
8. Opcjonalnie dodać lokalny hook pre-commit; ESLint, Prettier i EditorConfig są już egzekwowane w CI.

## Ryzyka prywatności i prawne

- log audytowy zapisuje IP, user-agent, aktora i metadane; polityka retencji oraz dostęp administracyjny muszą być jawne;
- DM ma pełny dostęp do kart postaci członków kampanii — polityka aplikacji musi to jasno komunikować;
- brakuje eksportu danych użytkownika;
- brakuje wybranej licencji kodu;
- ikona hełmu pochodzi z Flaticon i wymaga weryfikacji dokładnego autora/warunków oraz właściwej atrybucji; również wszystkie ikony dostarczone do `img/` trzeba zinwentaryzować licencyjnie.

## Wynik kontroli zależności

`npm audit` oraz `npm audit --omit=dev` zgłaszają **0 znanych podatności**. CI powtarza pełną kontrolę przy każdym pushu i pull requeście.

## Pomysły produktowe

- eksport/import postaci oraz notatnika do JSON/PDF;
- historia zmian postaci z możliwością przywrócenia wersji;
- rzuty kośćmi i makra wykorzystujące istniejące wzory statystyk;
- inicjatywa i kolejka tur współdzielona na żywo przez drużynę;
- tryb offline z kolejką synchronizacji i rozwiązywaniem konfliktów;
- role współ-DM, przekazanie kampanii i granularne uprawnienia;
- wyszukiwanie/filtrowanie ekwipunku, postaci i wiadomości;
- panel administracyjny zgłoszeń, retencji i diagnostyki;
- dostępność: czytniki ekranu, dynamiczny rozmiar tekstu, kontrast i obsługa klawiatury;
- lokalizacja treści i przygotowanie wersji angielskiej.

## Kryteria „gotowe do publicznej wersji”

Brak podatności krytycznych/wysokich w zależnościach runtime/build pipeline, podpisane wydania, automatyczne testy kluczowych ścieżek, backup i odtwarzanie, publiczny TLS, polityka prywatności/retencji, wybrana licencja oraz zweryfikowane licencje zasobów.
