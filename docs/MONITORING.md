# Monitoring dostępności

Produkcja jest monitorowana zewnętrznie przez UptimeRobot bez przekazywania danych użytkowników.

## Zalecany monitor

- typ: HTTPS;
- adres: `https://dndcompanion-api.onrender.com/ready`;
- metoda: `GET`;
- oczekiwany status: `200`;
- interwał: 5 minut;
- timeout: 30 sekund.

Endpoint `/ready` sprawdza API razem z połączeniem do PostgreSQL. `/health` potwierdza wyłącznie działanie procesu i nie powinien być podstawowym monitorem gotowości.

Alerty UptimeRobot należy skierować co najmniej na adres e-mail właściciela. Po trzech kolejnych błędach należy sprawdzić status Render, logi usługi, stan bazy i ostatni workflow backupu.

Repozytorium nie wysyła błędów ani danych użytkowników do Sentry lub innych zewnętrznych systemów telemetrycznych. Diagnostyka opiera się na logach Render, dzienniku audytowym PostgreSQL i GitHub Actions.
