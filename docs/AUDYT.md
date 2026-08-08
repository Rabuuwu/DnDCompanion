# Audyt repozytorium — 2026-08-09

## Zakres i metoda

Przejrzano strukturę repozytorium, konfigurację npm, frontend/PWA/Capacitor, API, migracje i model danych, jednostki systemd/DNS, dokumentację, stan Git oraz raport `npm audit`. Wykonano kontrolę składni i build po zmianach. Audyt nie jest formalnym testem penetracyjnym ani przeglądem prawnym.

## Zmiany wykonane podczas audytu

- naprawiono błąd `ReferenceError` po utworzeniu kampanii: powiadomienie używało nieistniejącego `friendId`;
- przeniesiono publikację zdarzenia do właściwego przepływu zapraszania do kampanii;
- zastosowano bezpieczne aktualizacje zależności bez wymuszania zmian głównych wersji; liczba zgłoszeń npm spadła z 8 do 4;
- zaktualizowano README oraz dokumentację architektury, API, bazy, funkcji i wydań;
- urealniono treść prywatności i pomocy w zakresie kampanii, DM i logów;
- rozszerzono `.gitignore` o lokalne/generowane artefakty;
- dodano informacje o zasobach zewnętrznych.

## Ustalenia według priorytetu

### P0 — przed publicznym udostępnieniem

1. **Podatność krytyczna w łańcuchu `@capacitor/cli` / `tar`.** Naprawa wymaga migracji Capacitor do wspieranej wersji głównej (według npm obecnie 8.x), synchronizacji platform i pełnych testów buildów. Ryzyko dotyczy przede wszystkim narzędzi budowania i pracy z archiwami, lecz nie powinno pozostać w publicznym pipeline.
2. **Brak historii Git.** Katalog ma gałąź `main`, ale wszystkie pliki są nieśledzone i nie ma pierwszego commita. Przed GitHubem trzeba przejrzeć `git status`, upewnić się, że nie ma sekretów, wykonać pierwszy commit i włączyć ochronę gałęzi.
3. **Brak produkcyjnego modelu dystrybucji.** Android używa `pl.example.dndmobile`, debug APK i zezwolenia na cleartext; iOS nie ma gotowego podpisanego IPA. Należy ustalić finalne identyfikatory pakietów zanim aplikacja trafi do sklepów.
4. **Sesja klienta w `localStorage`.** XSS może przejąć JWT i refresh token. W PWA warto przejść na bezpieczne, `HttpOnly`, `Secure`, `SameSite` cookies lub zaprojektować magazyn tokenów odporny na XSS; równolegle wprowadzić CSP.
5. **Wdrożenie jest wyłącznie LAN.** Lokalny DNS i prywatny CA nie zapewniają publicznie zaufanej domeny. Publiczna usługa wymaga reverse proxy, publicznego DNS, ACME, firewall i ograniczenia dostępu do PostgreSQL/API.

### P1 — wysoki priorytet jakości i bezpieczeństwa

1. Zaktualizować Vite (pozostała podatność `esbuild`) i Capacitor w kontrolowanych osobnych zmianach, bez `npm audit fix --force` na ślepo.
2. Dodać testy automatyczne dla kampanii, zaproszeń, wyboru postaci, Panelu DM, powiadomień i usunięcia konta. Aktualne smoke testy obejmują tylko auth i znajomych.
3. Rozdzielić `mobile/src/main.js` (~4,3 tys. linii) i `style.css` (~3 tys. linii) na moduły: API, auth, router, formularz postaci, kampanie/DM, chat, notatnik i komponenty UI.
4. Dodać retencję i zadania czyszczące dla `audit_logs`, refresh tokenów, kodów zaproszeń i starych danych. Logowanie każdego GET może szybko powiększać bazę.
5. Wdrożyć backup PostgreSQL, szyfrowanie kopii, monitoring oraz regularny test odtwarzania.
6. Zastąpić broker powiadomień w pamięci rozwiązaniem współdzielonym (Redis lub PostgreSQL LISTEN/NOTIFY), zanim API będzie skalowane do wielu procesów.
7. Uporządkować uprawnienia kampanii: właściciel może dziś doprowadzić do niejasnego stanu członkostwa; potrzebne są jawne operacje usunięcia kampanii, przekazania DM i zmiany postaci.
8. Zastąpić Vite Preview i `python -m http.server` przez Caddy/nginx nawet w stabilnym wdrożeniu LAN.

### P2 — utrzymanie i rozwój

1. Przenieść awatary z Data URL w PostgreSQL do magazynu plików/object storage; teraz zwiększają rekordy, odpowiedzi i pamięć klienta.
2. Dodać paginację wiadomości, kampanii i logów; rozmowa zwraca tylko ostatnie 100 wpisów.
3. Opisać kontrakt OpenAPI/JSON Schema i generować walidację/klienta, zamiast polegać wyłącznie na kodzie parsera.
4. Ujednolicić migracje: istniejące dwa prefiksy `006` pozostawić bez zmian, kolejne numerować jednoznacznie i dodać test migracji od pustej bazy.
5. Przenieść stare jednostki `dnd-web.service`, `dnd-pwa.service` i `dnd-download.service` do `deploy/legacy` po potwierdzeniu, że host ich nie używa.
6. Dodać CI dla `npm ci`, check, build, testów, audytu zależności i skanowania sekretów.
7. Dodać telemetrykę błędów pozbawioną danych wrażliwych oraz metryki zdrowia, opóźnień i rozmiaru kolejki/DB.
8. Ujednolicić format kodu (ESLint + Prettier/EditorConfig) i dodać hook pre-commit.

## Ryzyka prywatności i prawne

- log audytowy zapisuje IP, user-agent, aktora i metadane; polityka retencji oraz dostęp administracyjny muszą być jawne;
- DM ma pełny dostęp do kart postaci członków kampanii — polityka aplikacji musi to jasno komunikować;
- brakuje eksportu danych użytkownika;
- brakuje wybranej licencji kodu;
- ikona hełmu pochodzi z Flaticon i wymaga weryfikacji dokładnego autora/warunków oraz właściwej atrybucji; również wszystkie ikony dostarczone do `img/` trzeba zinwentaryzować licencyjnie.

## Wynik kontroli zależności

Po bezpiecznej aktualizacji `npm audit --omit=dev` zgłasza **0 podatności w zależnościach uruchomieniowych**. Pełny audyt zgłasza **4 podatności narzędzi deweloperskich/budowania**: 1 krytyczną, 2 wysokie i 1 umiarkowaną, skupione w zależnościach `@capacitor/cli`/`tar` oraz `vite`/`esbuild`. Ich sugerowane naprawy zmieniają główne wersje, dlatego wymagają zaplanowanej migracji zamiast automatycznego `--force`.

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
