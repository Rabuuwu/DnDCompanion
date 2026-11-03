# Wydanie 1.6.4

Data przygotowania: 2026-11-03. Android `versionCode`: 43. Identyfikator pakietu pozostaje `pl.rabuuwu.dndcompanion`.

## Zmiany dla użytkownika

- Przedmioty i złoto można zapisywać w ilościach przekraczających 9999, także przez DM. Zapis, odczyt i edycja zachowują ilość do 9 007 199 254 740 991.
- Paleta kartki zawiera przycisk „Czarny”, który przywraca kolor `#000000` po użyciu koła kolorów. Nowe kreski zachowują wybrany kolor po zapisaniu.
- Wylogowanie unieważnia również access token danej sesji. Zmiana hasła odcina wszystkie sesje konta, także powiadomienia.
- Poprawiono paginację między PWA i API oraz ochronę danych wstawianych do atrybutów HTML.
- API ma ograniczenia żądań, aktywnych połączeń i zapisu danych. Nowe hasła mogą mieć najwyżej 72 bajty UTF-8.

## Testy

W izolowanym katalogu wydania lokalnie przeszły: build klienta i składnia API, 46 testów jednostkowych, ESLint, Prettier, walidacja wersji oraz skan sekretów.

CI dla PR i `main` wykonuje dodatkowo aktualny `npm audit`, migracje na PostgreSQL, smoke auth/friends oraz regresje sesji, współbieżnego refresh i kwot, limitu SSE i odcięcia SSE po wylogowaniu. Start API w CI przechodzi przez ten sam runner migracji co produkcja. Playwright sprawdza dodawanie i edycję milionowych ilości złota, powrót do czarnego pióra i zapis czarnej kreski, a także kodowanie atrybutów i odrzucenie osadzenia aplikacji.

Wynikiem dla danego commitu są statusy GitHub Actions. Lokalne testy HTTP/PostgreSQL/przeglądarki i kontrola CVE są blokowane przez ograniczenia środowiska; nie zastąpiono ich deklaracją zaliczenia. Pipeline Androida dodatkowo buduje podpisany APK i wykonuje `lintRelease`. Nie wykonano ręcznej instalacji na fizycznym urządzeniu ani wydania IPA.

## Migracja i wdrożenie

Migracja `016_security_sessions_and_quotas.sql` jest wymagana dla nowego modelu sesji. Aktualizacja wymaga ponownego logowania, ale nie usuwa postaci, ekwipunków ani notatek.

`npm start` z `NODE_ENV=production` lub na Render (`RENDER=true`) stosuje brakujące migracje przed uruchomieniem HTTP. Błąd przerywa start. Dedykowane połączenie i blokada advisory serializują migracje wielu instancji. W lokalnym development migracje pozostają jawne; `MIGRATE_ON_START=true` umożliwia test tego startu na izolowanej bazie.

Przed aktualizacją należy potwierdzić backup i zaplanować skoordynowane przejście wszystkich instancji API. Konta, hosting i stan kopii zewnętrznych nie są weryfikowane samym commitem ani buildem APK. Wymagania proxy, kwoty i ograniczenia: [opis poprawek bezpieczeństwa](POPRAWKI_BEZPIECZENSTWA_2026-11-03.md).

## Publikacja

Źródłem wersji jest `release.json`, a changelog aplikacji znajduje się w `server/data/changelog.json`. Cache PWA ma wersję `v32`.

PR można scalić po zaliczeniu CI. Po scaleniu ponowne CI na `main` uruchamia publikację PWA oraz pipeline Androida. Pipeline Androida weryfikuje dokładny SHA i aktualny HEAD `main`, buduje i podpisuje APK istniejącym kluczem GitHub Actions, wykonuje lint i publikuje tag oraz wydanie `v1.6.4` z APK i sumą SHA-256. Wydanie nie jest tworzone, jeśli wymagane kontrole lub podpis zawiodą. Zmiana samej dokumentacji bez zwiększenia wersji nie powoduje ponownego wydania istniejącego APK.

Docelowa strona wydania: [v1.6.4](https://github.com/Rabuuwu/DnDCompanion/releases/tag/v1.6.4). Dostępność plików i powodzenie PWA trzeba potwierdzić w zakończonych workflowach.
