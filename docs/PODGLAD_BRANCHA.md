# Podgląd zmian z brancha bez mergowania

Podgląd uruchamia dokładnie kod z aktualnie wybranego brancha, lokalne API oraz frontend Vite z hot reloadem. API łączy się z PostgreSQL wskazanym w lokalnym `.env`. Żadne zmiany nie są mergowane ani wdrażane na Render.

## Uruchomienie

```bash
git switch agent/dm-dashboard-stage-1
npm install
npm run dev:branch-preview
```

Skrypt:

1. stosuje brakujące migracje;
2. uruchamia API na `127.0.0.1:3010`, niezależnie od głównej usługi na porcie `3000`;
3. uruchamia frontend na `0.0.0.0:5173`;
4. wyświetla adres komputera i adresy dostępne w LAN;
5. przekazuje `/api`, `/health` i `/ready` przez proxy Vite do lokalnego API.

Skrypt automatycznie dodaje adres lokalny i wykryte adresy LAN podglądu do `CORS_ORIGINS` tej instancji API.

Na tym samym komputerze należy wejść na:

```text
http://127.0.0.1:5173
```

Na telefonie w tej samej sieci należy użyć wyświetlonego adresu LAN, np.:

```text
http://192.168.1.5:5173
```

Zmiany w plikach frontendu pojawiają się automatycznie. Po zmianie backendu należy ponownie uruchomić polecenie. Podgląd kończy `Ctrl+C`.

Port API podglądu można zmienić przez `BRANCH_PREVIEW_API_PORT`; proxy Vite zostanie ustawione automatycznie.

## Baza danych

Podgląd korzysta z `DATABASE_URL` w lokalnym `.env`. Zalecana jest lokalna/testowa baza, ponieważ formularze wykonują prawdziwe zapisy. Nie należy wskazywać produkcyjnej bazy Render podczas ręcznych testów UI.

## Ograniczenia

- HTTP w LAN wystarcza do testów interfejsu i API, ale systemowe powiadomienia PWA mogą wymagać HTTPS.
- Do testu instalacji PWA lub funkcji wymagających bezpiecznego kontekstu należy użyć istniejącej konfiguracji lokalnego HTTPS i certyfikatu LAN.
- Expo nie jest źródłem właściwego interfejsu tej aplikacji; Vite pokazuje faktyczną aplikację PWA/Capacitor i jest właściwym podglądem zmian.
