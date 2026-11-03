# Poprawki audytu bezpieczeństwa — 2026-11-03

Branch: `fix/security-audit-2026-11-03`. Zakres: S1–S5 i Q1 z `AUDYT_BEZPIECZENSTWA_2026-11-03.md`. Zmiany są lokalne; nie wykonywano wdrożenia ani migracji istniejącej bazy. Zastane niezacommitowane zmiany pozostawiono w katalogu roboczym.

## Zmiany

| Ustalenie | Poprawka |
| --- | --- |
| S1: SSE | Maksymalnie 3 aktywne połączenia użytkownika i 300 na proces, do 10 minut i najwyżej do wygaśnięcia JWT. Wolny odbiorca jest odłączany przy `write() === false`; nie powstaje nieograniczona kolejka. Timery i sloty są zwalniane po rozłączeniu. Stan sesji jest sprawdzany przed wysłaniem powiadomienia i heartbeat. |
| S2: atrybuty HTML | Wspólny helper koduje `&`, `<`, `>`, cudzysłów i apostrof. Avatar wymaga pełnego poprawnego data URL. URL materiału jest parsowany i dopuszcza tylko HTTP(S), również po stronie klienta. |
| S3: unieważnianie JWT | JWT zawiera `sid` sesji z PostgreSQL. Każde uwierzytelnione żądanie sprawdza jej stan; wylogowanie unieważnia jedną sesję, zmiana hasła wszystkie, a usunięcie konta usuwa je kaskadowo. Refresh zachowuje `sid`, rotując sam token. Zdarzenie PostgreSQL odcina SSE także na pozostałych instancjach; gdy zdarzenie nie dotrze, ponowne sprawdzenie nie pozwala wysłać kolejnych zdarzeń, a heartbeat zamyka połączenie. |
| S4: zasoby | Globalny limit żądań przed parsowaniem i zapisem audytu, wspólny limit mutacji na konto obejmujący wszystkie chronione trasy, limity anonimowego audytu i liczby równoległych zapisów, kwoty danych w bazie. Dodano timeout połączenia i zapytań PostgreSQL. |
| S5: bcrypt | Rejestracja i nowe hasła dopuszczają najwyżej 72 bajty UTF-8. Dotychczasowe hasła do 128 jednostek długości JS nadal pozwalają się zalogować i ustawić nowe, poprawne hasło. Nie zmieniono istniejących hashy. |
| Q1: paginacja | CORS udostępnia `X-Has-More`, `X-Next-Offset`, `X-Next-Cursor` i `X-Request-Id`. |

Dodatkowo: klient kończy inicjalizację w ramce, zanim utworzy kontrolki konta. Usunięto nieskuteczne `frame-ancestors` z meta CSP, przygotowano nagłówki dla hostingu obsługującego własną konfigurację (`deploy/nginx/security-headers.conf`). GitHub Pages nadal nie dostarcza tych nagłówków; blokada inicjalizacji w ramce jest ochroną aplikacyjną, a nie odpowiednikiem nagłówka przeglądarki.

Publikacja Pages uruchamia się po poprawnym workflow CI dla `main`, pobiera sprawdzony SHA i dodatkowo wymaga, aby najnowszy wynik CI dla tego commitu był poprawny, a commit nadal był HEAD gałęzi `main`. Ręczna publikacja podlega tym samym warunkom. Nie publikowano strony w tej sesji.

## Limity

- Globalnie: 1200 żądań na 15 minut na IP, z obsługą podsieci IPv6 przez `express-rate-limit`.
- Konto: 900 odczytów i 120 mutacji na 15 minut, niezależnie od IP. Dotychczasowe węższe limitery tras nadal działają. Logowanie/rejestracja/refresh/wylogowanie mają wspólny limit 20 żądań na 15 minut na IP.
- Dane konta: 100 postaci, 50 kampanii, 50 000 wysłanych wiadomości, 100 aktywnych sesji. Poszczególne typy treści DM z `created_by`: po 2000 rekordów na autora. Istniejące dane powyżej kwoty pozostają; blokowane są nowe inserty, bez automatycznego kasowania danych.
- Wycofanie/archiwizacja treści DM nie usuwa rekordu i nie zwalnia kwoty. Wymaga to uwzględnienia w przyszłym interfejsie administracyjnym/zarządzaniu danymi.
- Kwoty wymusza baza z blokadą konta, również przy równoległych żądaniach i wielu instancjach. Limity żądań, budżet logów i limity SSE są lokalne dla procesu. W instalacji wieloinstancyjnej wspólny limit ruchu/połączeń należy ustawić również na reverse proxy/WAF; nie dodawano nowej zależności Redis.
- Audyt: najwyżej 4 równoległe zapisy, 1200 zapisów/minutę ogółem i 100 anonimowych/minutę. Nadmiar jest pomijany, z podsumowaniem w logu przy następnym oknie. Dane wejściowe nie tworzą nieograniczonej kolejki; nie jest to gwarancja bezstratnego audytu podczas ataku.
- Limitery wyłącza wyłącznie jednoczesne `NODE_ENV=test` i `DISABLE_TEST_RATE_LIMITS=true` na potrzeby izolowanych testów. Produkcja nie honoruje tego przełącznika. Testy jednostkowe samych limiterów sprawdzają rzeczywiste odrzucenie żądań.

## Wdrożenie i zgodność

1. Zweryfikować poprawny backup, możliwość odtworzenia i pełne CI na środowisku testowym. Nie uruchamiać testów integracyjnych na produkcji.
2. Zatrzymać wszystkie stare instancje API podczas skoordynowanej aktualizacji. Migracja `016_security_sessions_and_quotas.sql` musi zakończyć się przed uruchomieniem nowego API. Nie mieszać starych i nowych instancji podczas migracji modelu sesji.
3. Uruchomić komendę migracji w kontrolowanym środowisku wdrożenia, następnie nowe API. W wydaniu 1.6.4 `npm start` na produkcji/Render także stosuje brakujące migracje przed nasłuchem; błąd przerywa start. Migracja dodaje tabelę, indeksy i triggery; przy dużych tabelach czas blokad/indexowania należy wcześniej zmierzyć na kopii danych.
4. Użytkownicy muszą zalogować się ponownie: stare JWT nie mają `sid`, a stare refresh tokeny zostają unieważnione. Po nowym logowaniu maksymalny czas życia sesji wynosi `REFRESH_TOKEN_DAYS` (domyślnie 30 dni, zakres 1–90); refresh nie przedłuża tego absolutnego terminu.
5. Ustawić `TRUST_PROXY_HOPS=0` dla bezpośrednio dostępnego API lub `1` wyłącznie dla ścieżki przez jeden zaufany proxy. Domyślne `1` zachowuje konfigurację Render. Szablon lokalny `.env.example` używa bezpiecznego wariantu bez proxy. Należy wykluczyć alternatywną krótszą ścieżkę dostępu do backendu.
6. Dla nagłówków antyramkowych użyć hostingu/proxy obsługującego konfigurację odpowiedzi frontendu. Nie wystarczy Helmet na osobnym API.
7. Zweryfikować alarmy, ustawienie `BACKUPS_ENABLED`, klucz odszyfrowujący i bieżące kopie. Kod workflow nie potwierdza stanu usług ani sekretów konta; nie zmieniano konfiguracji zewnętrznej.

Powrót do starego kodu wymaga osobnego planu bezpieczeństwa: stary middleware nie sprawdza cofnięcia sesji. Nie należy po prostu uruchamiać go z tym samym sekretem i zakładać, że nowe unieważnienia nadal będą respektowane.

## Testy i ograniczenia

Zestaw jednostkowy zawiera testy unieważniania JWT, długości haseł Unicode, dopisywania atrybutów, URL i avatarów, prawdziwego middleware CORS, rzeczywistych limiterów, SSE (liczba połączeń, backpressure, zdarzenia cofnięcia sesji, sprzątanie i TTL) oraz ograniczeń zapisu audytu. `node scripts/security-audit-probes.mjs` uruchamia teraz regresje bez sieci i bazy; dawne próby potwierdzające podatności zostały zastąpione testami oczekiwanego zachowania.

Nowy `npm run test:security-fixes --workspace server` wymaga izolowanego API i testowej bazy z migracjami. Sprawdza w realnym HTTP/SQL: izolację sesji, rotację i logout, zmianę hasła, odcięcie wszystkich sesji, limit bcrypt, zgodność logowania starego hasła, CORS, równoległe wykorzystanie ostatniego miejsca w kwocie i usunięcie konta. Jest podłączony do CI. `tests/ui/security.spec.js` sprawdza prawdziwy DOM i blokadę osadzonej aplikacji.

`python3 scripts/verify-security-schema.py` tworzy wyłącznie własny tymczasowy klaster i sprawdza migracje/kwoty/kaskady w trybie PostgreSQL single-user, bez portów. Nie zastępuje współbieżnych testów API.

W samodzielnej kopii zawartości commitu, bez zastanych zmian użytkownika: build, 39 testów jednostkowych, lint i formatowanie przeszły. Pełny zastany katalog roboczy zaliczył build, 42 testy, lint i formatowanie; skan sekretów również przeszedł. Różnica liczby testów wynika z niezależnych, wcześniejszych zmian testów autora.

Lokalnie testy wymagające PostgreSQL i HTTP są zablokowane przez sandbox: brak prawa do tworzenia pamięci współdzielonej (`shmget`) i nasłuchu na portach. Start Chrome był blokowany w sesji audytu. Rejestr npm jest niedostępny przez DNS, więc brak aktualnego wyniku `npm audit`. Żadnej z tych kontroli nie uznano za zaliczoną.

Dokumentacja mechanizmu bramki publikacji: [GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs). Tryb weryfikacji schematu: [PostgreSQL single-user mode](https://www.postgresql.org/docs/17/app-postgres.html).
