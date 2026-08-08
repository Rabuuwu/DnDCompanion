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

1. Dodaj nowy plik z kolejnym numerem, obecnie co najmniej `010_...sql`.
2. Stosuj operacje możliwie idempotentne.
3. Wykonaj backup przed wdrożeniem.
4. Uruchom `npm run db:migrate` przed restartem API.
5. Nie zmieniaj nazw ani treści migracji zastosowanych w środowisku.

## Wersjonowanie aplikacji

Wersję należy aktualizować spójnie w:

- `mobile/index.html` (metadane klienta);
- `mobile/android/app/build.gradle` (`versionName`, rosnący `versionCode`);
- `.env`/`.env.example` (`ANDROID_APP_VERSION`, adres APK);
- `server/data/changelog.json`;
- cache name w `mobile/public/sw.js`, jeśli zmieniają się zasoby PWA.

Aktualna wersja: `1.5.2`, Android `versionCode 35`, service worker `v23`.

## Build

```bash
npm run build
npm run build:pwa --workspace mobile
npm run build:apk --workspace mobile
```

`build:apk` tworzy podpisany APK release i plik SHA-256. Wymaga `DND_RELEASE_STORE_FILE`, `DND_RELEASE_STORE_PASSWORD`, `DND_RELEASE_KEY_ALIAS` i `DND_RELEASE_KEY_PASSWORD`. Finalny identyfikator Androida to `pl.rabuuwu.dndcompanion`. GitHub Actions pobiera wartości z sekretów repozytorium. IPA wymaga macOS, Xcode, konta Apple Developer, profilu provisioning i podpisu; samo środowisko Linux nie tworzy dystrybucyjnego IPA.

Workflow `.github/workflows/release.yml` buduje artefakt ręcznie lub po tagu. Tylko tag `v<wersja>`, np. `v1.5.2`, publikuje GitHub Release. Przed utworzeniem tagu uruchom:

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

PWA wymaga bezpiecznego kontekstu. Obecne wdrożenie używa prywatnego CA i lokalnego DNS, dlatego każde urządzenie musi zaufać temu CA. Certyfikat serwera i klucz prywatny nie mogą trafić do repozytorium; do pobrania udostępnia się wyłącznie certyfikat publiczny CA.

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
