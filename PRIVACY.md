# Polityka prywatności D&D Companion

Data obowiązywania: 9 sierpnia 2026 r.

D&D Companion przetwarza dane potrzebne do prowadzenia kont, postaci, komunikacji, kampanii, synchronizacji i ochrony usługi.

## Przetwarzane dane

- nazwa użytkownika, hash hasła oraz opcjonalny awatar;
- karty postaci, ekwipunek, umiejętności i notatniki;
- relacje znajomych, pseudonimy, wiadomości, zaproszenia, blokady i zgłoszenia;
- kampanie, członkostwo oraz prywatne notatki DM;
- ustawienia interfejsu i techniczne tokeny sesji;
- logi bezpieczeństwa obejmujące akcję, wynik, czas, IP i user-agent.

Hasła nie są przechowywane jawnie. Refresh tokeny są przechowywane na serwerze jako skróty SHA-256.

## Udostępnianie w kampanii

Postać jest prywatna do chwili dołączenia nią do kampanii. Członkowie drużyny mogą wtedy zobaczyć dane postaci, a właściciel kampanii (DM) otrzymuje pełny podgląd karty. Prywatne notatki DM widzi wyłącznie DM danej kampanii.

## Retencja i usuwanie

Logi audytowe są domyślnie usuwane po 90 dniach. Wygasłe tokeny oraz nieaktualne zaproszenia są okresowo usuwane. Użytkownik może usunąć postać albo trwale usunąć konto wraz z danymi zależnymi. Zaszyfrowane kopie zapasowe mogą pozostać do końca okresu ich retencji.

## Urządzenie i powiadomienia

Dostęp do internetu służy synchronizacji. Uprawnienie powiadomień można zmienić w ustawieniach systemu. Aktualny mechanizm może wymagać działającej aplikacji; pełne powiadomienia push będą wymagały konfiguracji Firebase.

## Zasady

Dane nie są sprzedawane ani wykorzystywane do reklam lub profilowania marketingowego. Zgłoszenia bezpieczeństwa należy przesyłać zgodnie z [SECURITY.md](SECURITY.md).
