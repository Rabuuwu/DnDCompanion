# Audyt bezpieczeństwa i jakości DnDCompanion — 2026-11-03

> Stan historyczny przed naprawami. Poprawki i ograniczenia ich weryfikacji opisano w [raporcie wdrożeniowym](POPRAWKI_BEZPIECZENSTWA_2026-11-03.md). Skrypt prób został zastąpiony testami regresji.

## Wynik

**Wymagane poprawki przed uznaniem aplikacji za odporną na nadużycia.** Stwierdzono pięć problemów bezpieczeństwa w kodzie: jeden o wysokim i cztery o średnim ryzyku. Dodatkowo wykryto błąd paginacji w konfiguracji CORS. Nie potwierdzono wykonania JavaScript przez atakującego, SQL injection, obejścia uprawnień do cudzej postaci ani zdalnego wykonania kodu. Nie jest to dowód braku innych podatności.

| ID | Ryzyko | Problem | Rodzaj dowodu |
| --- | --- | --- | --- |
| S1 | Wysokie | Nieograniczone strumienie SSE, brak obsługi wolnego odbiorcy | Kod i izolowana próba funkcji |
| S2 | Średnie | Wstrzykiwanie atrybutów HTML przez niepoprawne kodowanie | Kod i parser HTML; bez testu w przeglądarce |
| S3 | Średnie | JWT nadal działa po wylogowaniu i zmianie hasła | Kod; próba funkcji dla wylogowania |
| S4 | Średnie | Brak limitów części operacji i nieograniczony zapis logów | Analiza tras i przepływu zapisu |
| S5 | Średnie | Akceptowanie haseł dłuższych niż limit bcrypt | Kod i próba rzeczywistej biblioteki |
| Q1 | Średni wpływ funkcjonalny | Paginacja nie działa poprawnie między originami | Analiza kontraktu klienta i konfiguracji CORS |

Oceny są jakościowe, bez pozornego wyniku CVSS. Wysokie ryzyko S1 wynika z możliwości wpływu jednego zwykłego konta na dostępność całego API; rzeczywisty próg przeciążenia zależy od infrastruktury i nie był mierzony.

## Zakres i stan źródeł

Punkt odniesienia: HEAD `53e4b35` oraz zastany katalog roboczy, łącznie z niezacommitowanymi poprawkami autora. Nie cofano ani nie zmieniano tych poprawek. Audyt obejmuje główne ścieżki Express, JWT, refresh, postacie, znajomych i wiadomości, kampanie i DM, SSE, audytowanie, utrzymanie danych, klienta Vite/PWA, storage sesji, Android, konfigurację wdrożeń i CI. Repozytorium miało 241 śledzonych plików; nie wykonano przeglądu każdej linii wszystkich plików ani pełnego audytu natywnych zależności.

Model zagrożeń: anonimowy klient HTTP, właściciel zwykłego konta, złośliwy znajomy/DM i napastnik posiadający wcześniej skradziony token. CORS nie jest kontrolą dostępu dla klientów pozaprzeglądarkowych. Nie wysyłano prób ataku do produkcji. Nie odczytywano `.env` ani danych użytkowników. Nie wykonano migracji ani zapisu w istniejącej bazie.

Dodane pliki audytu: niniejszy raport i `scripts/security-audit-probes.mjs`. Kod aplikacji pozostawiono bez poprawek, aby oddzielić ustalenia od późniejszego wdrażania napraw.

## S1 — Nieograniczone połączenia SSE i buforowanie

**Miejsca:** `server/src/server.js:262`; `server/src/notifications.js:9`, `:82`.

Trasa `/api/notifications/stream` ma tylko `requireAuth`. Każde połączenie trafia do `Set` w `notificationStreams` i dostaje osobny timer heartbeat. Brakuje limitu aktywnych połączeń na użytkownika/instancję, czasu życia połączenia i reakcji na `res.write()` zwracające `false`. Zwykły limiter liczby żądań nie wystarczyłby jako limit liczby aktywnych strumieni.

**Scenariusz:** posiadacz jednego konta otwiera wiele połączeń przez własnego klienta HTTP i utrzymuje je, także czytając bardzo wolno. Każde zajmuje zasoby procesu i gniazdo, a powiadomienia i heartbeat mogą zwiększać kolejkę zapisu. Może to pogorszyć dostępność dla pozostałych użytkowników. Nie przeprowadzano testu obciążeniowego ani nie określano liczby połączeń potrzebnej do wyczerpania pamięci.

**Dowód:** izolowany skrypt wywołuje rzeczywistą funkcję 25 razy dla tego samego użytkownika. Wszystkie wywołania tworzą timer, mimo że symulowane `write()` zwraca `false`. To próba logiki funkcji, nie pomiar zużycia zasobów serwera HTTP. W kodzie jest sprzątanie po `close`, co ogranicza wycieki po poprawnym rozłączeniu, ale nie chroni przed utrzymywaniem połączeń.

**Dodatkowy wpływ:** JWT jest sprawdzany tylko przy otwieraniu połączenia. Już otwarty strumień nie zamyka się po wygaśnięciu tokenu ani po zmianie hasła i może nadal odbierać identyfikatory zdarzeń. Dotyczy to metadanych publikowanych zdarzeń, a nie automatycznie pełnych wiadomości.

**Naprawa:** limity aktywnych połączeń per użytkownik i globalnie, maksymalny czas życia powiązany z `exp`, zamykanie po unieważnieniu sesji, obsługa backpressure z ograniczeniem bufora. Przy wielu instancjach uwzględnić limit na poziomie infrastruktury lub współdzielony stan. Dodać test limitu, powolnego odbiorcy, wygaśnięcia i zwalniania zasobów.

## S2 — Dane użytkownika mogą dopisywać atrybuty HTML

**Miejsca:** `mobile/src/ui-utils.js:1`; `mobile/src/main.js:3621`, `:3638`, `:5421`; także linki materiałów `:3409`, `:3803`.

`escapeHtml()` tworzy tekst w `div` i zwraca jego `innerHTML`. Chroni to tekst przed interpretacją `<`, `>` i `&`, lecz nie koduje cudzysłowów. Ten sam helper jest używany wewnątrz atrybutów ujętych w `"`, m.in. `data-campaign-name`, `value`, `aria-label` i `href`. Nazwa kampanii i URL materiału są kontrolowane przez użytkownika; walidacja URL sprawdza jedynie początek `http://` lub `https://`.

**Przykład:** nazwa kampanii długości mniejszej niż 100 znaków:

```text
Test" style="position:fixed;inset:0;z-index:999999
```

Po interpolacji powstaje dodatkowy atrybut `style` na przycisku. Parser HTML potwierdził podział na `data-campaign-name=Test` oraz `style=position:fixed;inset:0;z-index:999999`. Przykładowa ścieżka między kontami to utworzenie kampanii o takiej nazwie i zaproszenie znajomego; klient odbiorcy umieszcza nazwę w atrybutach przycisków zaproszenia.

**Wpływ:** manipulacja wyglądem i obszarem klikalnym przycisków, zakłócenie interfejsu i możliwość dopisania atrybutów wykorzystywanych przez aplikację. Istniejąca CSP blokuje typowe inline event handlery, ale dopuszcza inline style. **Nie potwierdzono wykonania JS ani kradzieży tokenu; nie należy raportować tego jako udowodnionego pełnego stored XSS.** Ocena dokładnego zachowania interfejsu wymaga testu w przeglądarce.

**Zasięg:** `main.js` zawiera 200 użyć `escapeHtml`; nie wszystkie są niebezpieczne, ponieważ użycia w treści tekstowej są poprawne. Błąd helpera jest systemowy. `git blame` wskazuje wprowadzenie helpera w `2bd7842a`.

**Naprawa:** preferować `textContent`, `.value` i `setAttribute` dla danych; jeśli pozostają szablony HTML, kodować także `"` i `'` oraz sprawdzić wszystkie konteksty. URL parsować przez `new URL()` i dopuścić wyłącznie odpowiednie protokoły. Testy powinny obejmować cudzysłowy, apostrofy, encje oraz wspólną treść między kontami.

Źródło zasad kodowania kontekstowego: [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

## S3 — Brak natychmiastowego unieważnienia access tokenu

**Miejsca:** `server/src/auth.js:174`, `:187`, `:259`.

Wylogowanie unieważnia wyłącznie wskazany refresh token. Zmiana hasła unieważnia refresh tokeny użytkownika, ale `requireAuth` sprawdza jedynie podpis, issuer, audience i ważność JWT. Nie odczytuje stanu sesji ani wersji poświadczeń. Usunięcie konta również nie powoduje odrzucenia jego JWT przez sam middleware; dalszy efekt zależy od kontroli w konkretnym handlerze i ograniczeń bazy.

**Scenariusz:** napastnik posiada skradziony access token. Ofiara wylogowuje się albo zmienia hasło, lecz napastnik nadal może używać tokenu do wygaśnięcia: domyślnie do 15 minut, zależnie od `JWT_ACCESS_TTL`. Nie daje to dostępu bez uprzedniego pozyskania tokenu. Jest to znany kompromis bezstanowych JWT, ale musi być świadomą polityką produktu; obecny kod nie oferuje natychmiastowego odcięcia napastnika.

**Dowód:** próba rzeczywistego `logout` z atrapą bazy, a następnie `requireAuth` z testowym JWT potwierdza zaakceptowanie tokenu i brak zapytania do stanu konta/sesji. Dla zmiany hasła wniosek wynika z kodu. Historycznie `requireAuth` pochodzi z bazowego commitu `751605d`.

**Naprawa:** identyfikator sesji i kontrola jej unieważnienia, ewentualnie wersja poświadczeń lub `tokens_valid_after` porównywana z tokenem. Rozróżnić wylogowanie jednej sesji i odcięcie wszystkich sesji po zmianie hasła. Dodać testy ponownego użycia JWT po tych operacjach i po usunięciu konta, także dla SSE.

## S4 — Nierówna ochrona przed nadużyciem zapisów i logów

**Miejsca:** `server/src/server.js:138`, `:234`, `:236`, `:243`, `:256`, `:266`; `server/src/audit.js:130`, `:155`; `server/src/maintenance.js:18`.

Nie ma globalnego limitera. Wiele operacji, np. tworzenie postaci i kampanii, wysyłanie wiadomości i zapis awatara, nie korzysta z `mutationLimiter`. Brakuje też kwot liczby obiektów na konto. Ograniczenie JSON do 1 MB kontroluje rozmiar pojedynczego żądania, a nie łączny wolumen danych.

Middleware audytu działa przed limiterami tras i zapisuje również błędy oraz nieznane trasy. Anonimowe żądania do nieistniejących ścieżek lub `/api/auth/logout` mogą powodować kolejne zapisy do PostgreSQL. Również żądania odrzucone przez limiter tras trafiają do audytu. Każdy zapis jest uruchamiany asynchronicznie bez ograniczonej kolejki; retencja 90 dni nie ogranicza bieżącego napływu.

**Scenariusz:** anonimowy klient generuje dużą liczbę żądań rejestrowanych w audycie; posiadacz konta dodatkowo tworzy obiekty lub wysyła wiadomości bez limitów aplikacyjnych. Skutek może obejmować wzrost bazy, kolejki zapytań i kosztów. Brak pomiaru obciążenia i wiedzy o limitach na brzegu infrastruktury; nie dowiedziono skutecznego DoS produkcji.

**Naprawa:** limit globalny przed kosztownymi operacjami, osobne limity per IP/per konto dla odczytów i mutacji, kwoty danych, ograniczona kolejka audytu i agregowanie powtarzalnych anonimowych błędów. Zachować możliwość rejestrowania istotnych zdarzeń bezpieczeństwa. Testować z konfiguracją, w której limitery są aktywne — obecne `NODE_ENV=test` wyłącza `authLimiter`.

## S5 — Ciche obcinanie haseł przez bcrypt

**Miejsca:** `server/src/auth.js:37`, `:191`, `:204`.

Walidacja dopuszcza do 128 jednostek długości stringa JS, ale bcrypt uwzględnia najwyżej 72 bajty UTF-8. Dwa różne hasła z tym samym 72-bajtowym prefiksem mogą uwierzytelnić tę samą osobę. Przy znakach wielobajtowych problem pojawia się przed osiągnięciem 72 znaków.

**Dowód:** rzeczywista zainstalowana biblioteka zaakceptowała `"a".repeat(72) + "SECOND"` dla hasha `"a".repeat(72) + "FIRST"`. W próbie użyto kosztu 4 dla szybkości; aplikacja używa prawidłowo wyższego kosztu 12, który nie zmienia limitu długości.

**Wpływ:** końcówka hasła nie zwiększa ochrony; zmiana wyłącznie końcówki długiego hasła nie odcina starego hasła. Nie oznacza to możliwości logowania dowolnym krótkim hasłem ani poznania prefiksu.

**Naprawa:** odrzucać nowe hasła przekraczające 72 bajty (`bcrypt.truncates()`/`Buffer.byteLength`) albo przejść na odpowiednio skonfigurowany Argon2id z wersjonowaniem hashy. Uwzględnić istniejące konta podczas migracji i testy Unicode. Nie wprowadzać po cichu innego hashowania istniejących haseł.

Źródło: [dokumentacja bcryptjs](https://www.npmjs.com/package/bcryptjs?activeTab=versions).

## Q1 — Niewidoczne nagłówki paginacji w kliencie web

**Miejsca:** `server/src/server.js:128`; `mobile/src/api-client.js:60`; `mobile/src/main.js:5020` i obsługa historii rozmów.

API ustawia `X-Has-More`, `X-Next-Offset` i `X-Next-Cursor`, lecz konfiguracja CORS nie ustawia `exposedHeaders`. Przy GitHub Pages → Render przeglądarka nie udostępnia tych niestandardowych nagłówków JavaScriptowi. `fetchAllPages()` kończy na pierwszej stronie, a klient rozmów nie może prawidłowo wykrywać dalszej historii. Problem dotyczy danych przekraczających rozmiar strony, nie ich usuwania z bazy. Proxy tego samego originu może ukrywać błąd podczas testów.

**Naprawa:** dodać jawne `exposedHeaders` dla trzech nagłówków paginacji oraz ewentualnie `X-Request-Id`. Test przeglądarkowy powinien wykonywać prawdziwy request między dwoma originami i zawierać więcej rekordów niż jedna strona.

## Dodatkowe kwestie do sprawdzenia wdrożeniowo

- `mobile/index.html:8` deklaruje `frame-ancestors 'none'` w meta CSP. Przeglądarki ignorują tę dyrektywę w meta. Ochrona przed osadzaniem wymaga nagłówka HTTP na odpowiedzi frontendu. Helmet API nie zabezpiecza HTML podawanego przez GitHub Pages. Nie sprawdzano rzeczywistych nagłówków hostingu, więc nie potwierdzono podatności wdrożenia na clickjacking. [Specyfikacja CSP](https://www.w3.org/TR/CSP/latest).
- `trust proxy = 1` musi odpowiadać faktycznej topologii. Przy bezpośrednio dostępnym API lub alternatywnej krótszej ścieżce należy zweryfikować możliwość podszywania się pod IP przez `X-Forwarded-For`. Nie potwierdzono takiej ścieżki w produkcji.
- Limitery korzystają z pamięci procesu; wiele instancji i restarty zmieniają efektywny limit. Sprawdzić potrzebę współdzielonego magazynu.
- Backup jest warunkowy względem `BACKUPS_ENABLED`. Sam plik workflow nie dowodzi wykonywania kopii, dostępu do klucza odszyfrowującego, alertów ani osiągania RPO/RTO.
- `avatarMarkup` dopuszcza jedynie prefiks data URL i interpoluje resztę bez kodowania. Obecna walidacja awatarów serwera ogranicza osiągalność tej dodatkowej powierzchni; warto ujednolicić pełną walidację i budowanie DOM.

## Działające zabezpieczenia i ocena inżynierska

- Kontrola właściciela w głównych CRUD postaci i sprawdzanie członkostwa/ról w ścieżkach kampanii; kontrola odbiorców współdzielonych treści. Nie wykonywano pełnego dowodu odporności na wszystkie wyścigi TOCTOU.
- Parametryzowane wartości SQL; dynamiczne nazwy tabel DM pochodzą z zamkniętej konfiguracji. Nie znaleziono osiągalnej SQL injection w analizowanych ścieżkach.
- JWT ma ograniczone algorytmy, issuer i audience, minimalną długość sekretu oraz domyślnie krótki TTL. Tokeny refresh są losowe, hashowane w bazie i rotowane transakcyjnie z blokadą rekordu.
- Bcrypt z kosztem 12 i zastępczy hash dla nieistniejącego użytkownika; ogólny błąd niepoprawnego logowania.
- TLS bazy po włączeniu sprawdza certyfikat. Android blokuje cleartext, wyłącza backup i ma nieeksportowany FileProvider. Nie wykonano testów APK/IPA na urządzeniu.
- Web przechowuje sesję w `sessionStorage`, natywny klient korzysta z SecureStorage. To zmniejsza część zagrożeń storage, ale nie zastępuje poprawnego kodowania DOM.
- Błędy HTTP ograniczają ujawnianie szczegółów; audyt nie zapisuje wartości haseł/tokenów w analizowanej ścieżce. Skan sekretów przeszedł, ale nie jest pełnym skanem całej historii Git.
- CI obejmuje składnię/build, testy, lint, formatowanie, skan zależności, migracje, UI i CodeQL. Deployment Pages nie ma zależności od wyniku oddzielnego workflow CI; sprawdzić ochronę gałęzi i politykę publikacji.
- `main.js` ma 5838 linii, `dm-workspace.js` 1149. Duże moduły utrudniają spójność kodowania i kontroli dostępu. Priorytetem podziału powinny być wspólne mechanizmy bezpieczeństwa i niezależnie testowalne widoki, a nie kosmetyczna reorganizacja.
- Dokumentacja ma rozbieżności: README deklaruje wersję 1.5.5 i lokalny DNS, a historia wydań i `docs/AUDYT.md` opisują nowszą aplikację oraz Pages/Render. Deklaracji dawnego audytu o zerze podatności nie należy traktować jako aktualnego wyniku.

## Weryfikacja wykonana w tej sesji

| Kontrola | Wynik |
| --- | --- |
| `./_tools/devhouse doctor DnDCompanion` | Bez ostrzeżeń metadanych; nie jest oceną bezpieczeństwa |
| `./_tools/devhouse test DnDCompanion` | PASS: składnia API, build Vite, 20/20 testów jednostkowych, lint, formatowanie |
| `npm run security:secrets` | PASS także po dodaniu obu artefaktów audytu: 247 plików wejściowych |
| `node scripts/security-audit-probes.mjs` | Potwierdza bieżące słabości JWT, bcrypt i SSE; nie jest testem oczekiwanego bezpiecznego zachowania |
| Lint i format dodanego skryptu | PASS |
| Parser HTML dla przykładu S2 | Potwierdził dodatkowy atrybut style; nie zastępuje przeglądarki |
| `python3 scripts/run-isolated-career-verification.py` | BLOCKED: `PermissionError: Operation not permitted` przy bind lokalnego portu; nie uruchomiono API/migracji |
| Próba uruchomienia Chrome przez Playwright | BLOCKED: proces przeglądarki zakończył się przy starcie |
| `npm audit --json` | BLOCKED: `ENOTFOUND registry.npmjs.org`; brak aktualnej oceny CVE |

Nie żądano wyjścia poza ograniczenia sandboxa. Nie oceniono działającej produkcji, konfiguracji Render/Pages, uprawnień administracyjnych, realnej retencji i backupów ani zachowania urządzeń mobilnych. Nie deklaruje się zaliczenia zablokowanych testów. Istniejące testy dostępu obejmują m.in. izolację postaci, odmowę dostępu outsidera do DM oraz współbieżne refresh, lecz nie dowodzą ochrony przed S1–S5. Brakuje osobnych testów uprawnień player/co_dm/owner, odebrania roli, złośliwych atrybutów i aktywnych limiterów w scenariuszu nadużycia.

## Kolejność napraw i kryteria odbioru

1. Ograniczyć aktywne SSE i buforowanie, a następnie objąć kosztowne operacje i audyt limitami. W izolowanym środowisku potwierdzić 429/odmowę nadmiarowych połączeń, ograniczoną kolejkę i poprawne zwalnianie zasobów.
2. Poprawić budowanie atrybutów we wszystkich szablonach. Testy między kontami mają wykazać, że payload S2 pozostaje pojedynczą wartością i nie zmienia atrybutów ani układu.
3. Wprowadzić jednoznaczną politykę unieważniania sesji i odcinania SSE. Po zmianie hasła wcześniejszy JWT ma przestać działać zgodnie z udokumentowaną polityką.
4. Poprawić limit bcrypt z planem dla istniejących kont i testami długości w bajtach.
5. Naprawić CORS paginacji; sprawdzić pełną listę i historię rozmowy ponad limit strony z innego originu.
6. Uruchomić zablokowane kontrole w środowisku z siecią i lokalnymi portami: aktualny skan zależności, izolowane API/DB, testy przeglądarkowe i walidację rzeczywistych nagłówków hostingu. Ponowić audyt po poprawkach.
