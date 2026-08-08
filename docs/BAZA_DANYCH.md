# Baza danych

## Konfiguracja i migracje

API używa PostgreSQL wskazanego przez `DATABASE_URL`; `DATABASE_SSL=true` włącza SSL. Migracje uruchamia polecenie:

```bash
npm run db:migrate
```

Skrypt stosuje pliki `server/migrations/*.sql` alfabetycznie i zapisuje pełną nazwę w `schema_migrations`. Migracje są jednokierunkowe — przed zmianą schematu produkcyjnego należy wykonać backup.

## Tabele

| Tabela | Przeznaczenie i ważne relacje |
|---|---|
| `schema_migrations` | historia zastosowanych plików migracji |
| `users` | nazwa, hash bcrypt, awatar Data URL i znaczniki czasu |
| `refresh_tokens` | hash SHA-256 tokenu, wygaśnięcie i unieważnienie; FK do użytkownika |
| `characters` | właściciel, nazwa i dokument `data JSONB`; kasowanie kaskadowe z kontem |
| `friendships` | symetryczna relacja zapisana jako uporządkowana para użytkowników |
| `friend_invites` | jednorazowe hashe kodów zaproszeń z terminem ważności |
| `direct_messages` | wiadomości 1:1, status odczytu, maks. 2000 znaków |
| `friendship_aliases` | prywatny pseudonim znajomego per użytkownik |
| `user_blocks` | kierunkowa blokada użytkownika |
| `user_reports` | powód, opis i status zgłoszenia |
| `campaigns` | nazwa kampanii i właściciel/DM |
| `campaign_members` | członkostwo, rola i wybrana postać; unikalna postać w kampanii |
| `campaign_invitations` | oczekujące/zaakceptowane/odrzucone zaproszenia |
| `campaign_dm_notes` | prywatna notatka DM dla kampanii, maks. 50 000 znaków |
| `campaign_character_dm_notes` | prywatna notatka DM o konkretnej postaci |
| `user_ui_preferences` | JSONB ustawień interfejsu, np. zwinięte sekcje |
| `audit_logs` | aktor, akcja, encja, HTTP, wynik, czas, IP, user-agent i metadata JSONB |

Wszystkie dane zależne od użytkownika są objęte `ON DELETE CASCADE` albo — dla pól historycznych — świadomą polityką z migracji. Usunięcie konta usuwa jego postacie, sesje i powiązane rekordy.

## Dokument `characters.data`

JSONB zawiera m.in.:

- profil: rasa, klasy, poziom, awatar, motto i waga;
- sześć statystyk głównych oraz wyliczone wartości bojowe;
- statystyki walki, pomocnicze, podstatystyki standardowe i własne;
- rozwój specjalny, gildie z rangą i profesją;
- umiejętności, pasywki i obozówki z opisami/cooldownami;
- ekwipunek w uporządkowanej tablicy;
- notatnik tekstowy i kreski kartki.

API normalizuje limity, typy i wartości wyliczane przed zapisem. Zmiana modelu JSONB nie wymaga migracji SQL, ale wymaga zachowania kompatybilności w parserze i serializatorze.

## Indeksy i ograniczenia

Migracje definiują indeksy dla właścicieli postaci, rozmów, nieprzeczytanych wiadomości, zaproszeń, członkostwa, preferencji i głównych wymiarów audytu. Nazwa użytkownika jest unikalna bez rozróżniania wielkości liter. Oczekujące zaproszenie kampanii jest unikalne dla pary kampania–zaproszony.

## Operacje i utrzymanie

Repozytorium nie dostarcza jeszcze automatycznej retencji. Należy wdrożyć okresowe:

- usuwanie wygasłych/unieważnionych refresh tokenów i kodów zaproszeń;
- archiwizację lub usuwanie starych `audit_logs`;
- backup `pg_dump` i test odtwarzania;
- monitoring rozmiaru JSONB postaci, wiadomości i awatarów;
- `VACUUM (ANALYZE)` zgodnie z obciążeniem.

Przykładowy backup (parametry należy dostosować do środowiska):

```bash
pg_dump --format=custom --file=dnd_app.dump "$DATABASE_URL"
```

Plik backupu zawiera dane użytkowników i musi być szyfrowany oraz przechowywany poza repozytorium.
