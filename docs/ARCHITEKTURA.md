# Architektura D&D Companion

## Zakres systemu

D&D Companion jest aplikacją typu client–server. Ten sam frontend jest pakowany przez Capacitor na Androida i iOS oraz budowany jako PWA. Serwer Express udostępnia JSON API i strumień SSE, a trwały stan przechowuje PostgreSQL.

## Komponenty

### Klient (`mobile/`)

- Vite buduje statyczne HTML, CSS i JavaScript.
- `src/main.js` zawiera obecnie większość stanu, routingu i widoków SPA.
- `src/style.css` zawiera wspólne style responsywne.
- Capacitor zapewnia powłokę natywną i lokalne powiadomienia.
- `public/manifest.webmanifest` i `public/sw.js` obsługują instalację PWA oraz cache statycznych zasobów. Cache ma obecnie wersję `v23`; żądania `/api`, `/health` i `/ready` nie są cache'owane.
- Android i iOS korzystają ze wspólnych zasobów wygenerowanych poleceniem `cap sync`.

Klient zapisuje sesję i część stanu roboczego w `localStorage`. Dane postaci, wiadomości, kampanii, preferencji UI i notatek DM są synchronizowane przez API.

### API (`server/`)

Serwer Express składa się z modułów:

- `auth.js` — rejestracja, logowanie, rotacja sesji, awatar, hasło i usuwanie konta;
- `characters.js` — walidacja i serializacja całego modelu postaci, szybkie aktualizacje ekwipunku i notatnika;
- `friends.js` / `social.js` — relacje, wiadomości, pseudonimy, blokady i zgłoszenia;
- `campaigns.js` — drużyny, zaproszenia, dostęp do postaci i Panel DM;
- `notifications.js` — kanał SSE, lista bieżących powiadomień i dystrybucja zdarzeń przez PostgreSQL `LISTEN/NOTIFY`;
- `preferences.js` — trwałe ustawienia interfejsu użytkownika;
- `audit.js` — dziennik zdarzeń i żądań w bazie;
- `maintenance.js` — codzienna retencja logów, tokenów i nieaktualnych zaproszeń;
- `db.js` — pula połączeń PostgreSQL.

Walidacja domenowa odbywa się po stronie API; klient nie jest źródłem zaufania. Limit JSON wynosi 1 MB. Endpointy logowania i wybranych operacji społecznościowych są objęte limitem żądań.

### PostgreSQL (`server/migrations/`)

Migracje są wykonywane rosnąco według nazwy, a pełna nazwa pliku trafia do `schema_migrations`. Dwa istniejące pliki zaczynają się od `006_`; nie należy ich zmieniać po wdrożeniu, ponieważ oba są identyfikowane pełną nazwą. Nowe migracje powinny używać kolejnego wolnego numeru.

Model postaci jest przechowywany głównie jako JSONB, natomiast konta, sesje, relacje, kampanie, wiadomości, preferencje i notatki DM mają osobne tabele. Szczegóły opisuje [BAZA_DANYCH.md](BAZA_DANYCH.md).

## Przepływy

### Sesja

1. Logowanie lub rejestracja zwraca krótkotrwały JWT oraz losowy refresh token.
2. W bazie przechowywany jest tylko SHA-256 refresh tokenu.
3. Odświeżenie unieważnia poprzedni refresh token i wydaje nowy.
4. Zmiana hasła i usunięcie konta unieważniają sesje.

### Powiadomienia i czat

Po zalogowaniu klient otwiera SSE `/api/notifications/stream`. API publikuje zdarzenie przez PostgreSQL `NOTIFY`, a każda instancja serwera nasłuchuje kanału i przekazuje je do własnych klientów SSE. Dzięki temu wiadomości działają także przy wielu procesach API. Klient odświeża aktywną rozmowę natychmiast; jeśli rozmowa z nadawcą jest otwarta, pomija lokalne powiadomienie. Okresowe pobieranie `/api/notifications` pozostaje mechanizmem awaryjnym.

### Postać i ekwipunek

Pełny zapis przechodzi przez `PUT /api/characters/:id`. Ekwipunek i notatnik mają lżejsze endpointy PATCH dla autozapisu. Kolejność przedmiotów wynika z kolejności tablicy w danych postaci. Stary ekwipunek tekstowy jest podczas odczytu przekształcany według zasady „jedna linia = jeden przedmiot”. Automatyczny dobór ikony działa jako podpowiedź; ręczny wybór użytkownika ma pierwszeństwo.

### Kampania i DM

Właściciel kampanii ma rolę `owner` i dostęp do Panelu DM. Zaproszenie wskazuje postać właściciela, a osoba zaproszona wybiera swoją postać podczas akceptacji. Członkowie widzą postacie drużyny, natomiast DM otrzymuje pełny widok, prywatne notatki kampanii/per postać oraz możliwość dodawania przedmiotów.

## Wdrożenie LAN

Aktualna topologia hosta `192.168.1.5`:

| Port | Usługa | Jednostka zalecana |
|---|---|---|
| 53/UDP,TCP | dnsmasq dla `dndcompanion.pl` | `dnd-dns.service` |
| 80/TCP | strona pobierania | `dnd-download-web.service` |
| 443/TCP | PWA pod `/app/` i proxy `/api` | `dnd-pwa-web.service` |
| 3000/TCP | API | `dnd-api.service` |

Pliki `dnd-download.service`, `dnd-pwa.service` i `dnd-web.service` są starszymi wariantami usług użytkownika i nie powinny działać równolegle z wariantami `*-web`. Docelowo warto je przenieść do katalogu `deploy/legacy/` albo usunąć po sprawdzeniu hosta.

DNS i adresy są obecnie przywiązane do interfejsu `enp5s0`, hosta `192.168.1.5` i routera `192.168.1.1`. Zmiana sieci wymaga aktualizacji konfiguracji.

## Granice i dług techniczny

- `mobile/src/main.js` i `style.css` są monolitami; wymagają podziału na moduły i komponenty.
- Vite Preview i Python `http.server` są wygodne w LAN, ale nie są docelowym reverse proxy dla Internetu.
- Awatary są przechowywane jako Data URL w PostgreSQL i powiększają odpowiedzi.
- Dziennik audytowy ma retencję czasową, ale przy dużej skali może wymagać partycjonowania.
- CI obejmuje kompilację, migrację od pustej bazy i smoke testy auth/znajomych; nadal brakuje testów kampanii, Panelu DM i UI.
- Repozytorium zawiera szyfrowany workflow backupu z próbą odtworzenia; wymaga skonfigurowania sekretów GitHub i okresowego ręcznego testu odzyskiwania.
