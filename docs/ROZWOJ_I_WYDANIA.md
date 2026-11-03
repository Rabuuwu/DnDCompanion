# Rozwój, wdrożenie i wydania

## Codzienna praca

```bash
npm install
npm run db:migrate
npm run dev:server
npm run dev:mobile
```

Nie używaj produkcyjnej bazy do testów integracyjnych. `expo-preview/` jest osobnym projektem pomocniczym; przed jego modyfikacją obowiązują instrukcje w tamtejszym `AGENTS.md`.

## Kontrola przed scaleniem

```bash
npm run check
npm audit
git diff --check
```

Dodatkowo ręcznie sprawdź: logowanie i odświeżenie sesji, CRUD postaci, zapis ekwipunku/notatnika, wiadomość i powiadomienie, zaproszenie kampanii, Panel DM oraz instalację PWA.

## Migracje bazy

1. Dodaj nowy plik z kolejnym numerem, po `016_security_sessions_and_quotas.sql`.
2. Stosuj operacje możliwie idempotentne.
3. Wykonaj backup przed wdrożeniem.
4. Wykonaj `npm run db:migrate` w kontrolowanym wdrożeniu. `npm start` w produkcji/Render również stosuje brakujące migracje przed otwarciem API; nie uruchomi serwera, jeśli migracja zawiedzie.
5. Nie zmieniaj nazw ani treści migracji zastosowanych w środowisku.

## Wersjonowanie aplikacji

Jedynym źródłem aktywnej wersji jest główny plik `release.json`:

- `version` — wersja semantyczna aplikacji i nazwa artefaktu;
- `androidVersionCode` — rosnąca liczba wymagana przez Androida;
- `androidPackageId` — finalny identyfikator pakietu;
- `repository` — repozytorium używane do wygenerowania adresu GitHub Release.

Android Gradle, Vite, API, skrypt APK i GitHub Actions odczytują ten plik automatycznie. Przy wydaniu trzeba zmienić `version`, zwiększyć `androidVersionCode` oraz dodać odpowiadający wpis na początku `server/data/changelog.json`. `npm run release:check` sprawdza ich zgodność. Cache name w `mobile/public/sw.js` zmieniaj, jeśli zmieniają się zasoby PWA.

## Build

```bash
npm run build
npm run build:pwa --workspace mobile
npm run build:apk --workspace mobile
```

`build:apk` tworzy podpisany APK release i plik SHA-256. Wymaga `DND_RELEASE_STORE_FILE`, `DND_RELEASE_STORE_PASSWORD`, `DND_RELEASE_KEY_ALIAS` i `DND_RELEASE_KEY_PASSWORD`. Finalny identyfikator Androida to `pl.rabuuwu.dndcompanion`. GitHub Actions pobiera wartości z sekretów repozytorium. IPA wymaga macOS, Xcode, konta Apple Developer, profilu provisioning i podpisu; samo środowisko Linux nie tworzy dystrybucyjnego IPA.

Workflow `.github/workflows/release.yml` po poprawnym CI dla najnowszego commitu `main` buduje podpisany APK, wykonuje Android lint i publikuje GitHub Release wraz z tagiem `v<wersja>`, jeśli ta wersja nie została jeszcze opublikowana. Obsługuje również ręczne uruchomienie na `main` i tagi, zawsze z weryfikacją poprawnego CI dla commitu. Zwykły commit bez zwiększenia wersji nie tworzy ponownego wydania. Changelog aplikacji trafia do opisu wydania. Przed PR wydania uruchom:

```bash
npm run check
npm run release:check
npm audit
```

## Usługi LAN

Zalecany zestaw jednostek systemowych:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dnd-dns.service dnd-api.service dnd-download-web.service dnd-pwa-web.service
systemctl status dnd-dns.service dnd-api.service dnd-download-web.service dnd-pwa-web.service --no-pager
```

Po zmianie kodu serwera uruchom migracje i zrestartuj API. Po zmianie klienta przebuduj PWA przed restartem usługi. Jednostki powinny zostać skopiowane z `deploy/systemd/` do `/etc/systemd/system/`; konfiguracja DNS używana przez usługę znajduje się docelowo w `/etc/dndcompanion-dns.conf`.

Sprawdzenie:

```bash
curl http://127.0.0.1:3000/ready
dig @192.168.1.5 dndcompanion.pl
curl --cacert /ścieżka/do/local-ca.crt https://dndcompanion.pl/ready
```

## TLS i PWA w LAN

PWA wymaga bezpiecznego kontekstu. Pomocniczy wariant LAN używa prywatnego CA i lokalnego DNS, dlatego urządzenie korzystające z tego wariantu musi zaufać temu CA. Produkcyjna PWA na GitHub Pages używa publicznego TLS. Certyfikat serwera i klucz prywatny nie mogą trafić do repozytorium; do pobrania udostępnia się wyłącznie certyfikat publiczny CA.

Vite Preview na 443 i Python SimpleHTTPServer na 80 są rozwiązaniem lokalnym. Przed publicznym wdrożeniem zastąp je Caddy/nginx, publicznym DNS i certyfikatem ACME.

## Rollback

- zachowaj poprzednią paczkę statyczną i APK;
- wykonaj backup bazy przed migracją;
- przy błędzie kodu przywróć poprzednią wersję plików i zrestartuj usługę;
- migracje nie mają automatycznego `down`, dlatego rollback schematu musi być przygotowany osobno i przetestowany.

## Lista wydania

- [ ] wersje i changelog są spójne;
- [ ] `npm run check` przechodzi;
- [ ] migracje przechodzą na kopii bazy;
- [ ] testy kluczowych ścieżek przechodzą na Androidzie i PWA;
- [ ] `npm audit` jest przeanalizowany;
- [ ] backup oraz procedura powrotu są gotowe;
- [ ] brak sekretów i paczek w zmianach Git;
- [ ] PWA ma odświeżony cache i manifest;
- [ ] APK/IPA są podpisane właściwym profilem dla kanału dystrybucji.


## Wydanie 1.6.4

Procedura, zakres testów i wymagania migracji: [WYDANIE_1.6.4.md](WYDANIE_1.6.4.md). PWA i Android są publikowane dopiero po zaliczeniu CI. Certyfikat podpisujący APK pozostaje w istniejących sekretach GitHub Actions; nie należy pobierać go do repozytorium ani publikować w logach.
