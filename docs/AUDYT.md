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

1. **Licencje ikon.** Kod ma zasadę „wszelkie prawa zastrzeżone”, ale zasoby graficzne bez dowodu pochodzenia nie mogą zostać automatycznie uznane za dopuszczone do publicznej dystrybucji.
2. **Test wydania na urządzeniu.** Podpisany APK musi przejść czystą instalację i aktualizację poprzedniej wersji bez usuwania danych.

### P1 — wysoki priorytet jakości i bezpieczeństwa

1. Utrzymywać testy Playwright i testy API razem ze zmianami krytycznych przepływów. Obecny zestaw obejmuje auth, postacie, ekwipunek, notatnik, znajomych, czat, kampanie i Panel DM.
2. Utrzymywać modułowe granice frontendu: konfiguracja, sesja, API, schemat postaci, ekwipunek, helpery UI i style czatu są wydzielone z głównego widoku.
3. Utrzymywać alert UptimeRobot dla produkcyjnego `/ready` i kontrolować nieudane backupy GitHub Actions.

### P2 — utrzymanie i rozwój

1. Utrzymywać publiczny kontrakt OpenAPI `/openapi.json` razem z testami endpointów.
2. Lokalny hook pre-commit oraz CI egzekwują ESLint, Prettier, testy jednostkowe i skan sekretów.

## Ryzyka prywatności i prawne

- log audytowy zapisuje IP, user-agent, aktora i metadane; polityka retencji oraz dostęp administracyjny muszą być jawne;
- DM ma pełny dostęp do kart postaci członków kampanii — polityka aplikacji musi to jasno komunikować;
- eksport danych użytkownika został świadomie wyłączony z zakresu produktu;
- kod ma licencję „wszelkie prawa zastrzeżone”;
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

## Architektura produkcyjna

PWA i strona są publikowane przez GitHub Pages, API działa na Render, a PostgreSQL jest usługą Render. Lokalne DNS, certyfikat i jednostki LAN są archiwalnym wariantem pomocniczym i nie stanowią produkcyjnej ścieżki aplikacji.

## Kryteria „gotowe do publicznej wersji”

Brak podatności krytycznych/wysokich w zależnościach runtime/build pipeline, podpisane wydania, automatyczne testy kluczowych ścieżek, backup i odtwarzanie, publiczny TLS, polityka prywatności/retencji, wybrana licencja oraz zweryfikowane licencje zasobów.
