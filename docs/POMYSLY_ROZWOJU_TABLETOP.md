# D&D Companion — plan rozwoju panelu DM do fizycznej gry przy stole

Aktualizacja: 2026-08-18  
Status: **obowiązująca specyfikacja produktu i instrukcja wykonawcza dla Codexa**

> Ten dokument zastępuje wcześniejsze propozycje rozwoju skupione na Trybie sesji karty postaci, cyfrowych rzutach kośćmi, automatyzacji HP, cooldownach, statusach oraz globalnej wyszukiwarce. Nie należy wdrażać tych funkcji w ramach obecnego zadania.

## 1. Cel produktu i granice projektu

D&D Companion ma wspierać prawdziwą sesję RPG prowadzoną przy stole. Nie ma być VTT, grą komputerową ani symulatorem zasad lub walki.

Gracze nadal używają fizycznych kości, a aplikacja przechowuje karty postaci, dane kampanii, wiadomości i materiały. Najbliższy etap rozwoju dotyczy przede wszystkim DM-a: obecny Panel DM trzeba zmienić z prostego podglądu kart drużyny w centrum przygotowania, prowadzenia i dokumentowania kampanii.

### W tym etapie nie wdrażamy

- cyfrowego rollera i historii rzutów;
- automatycznych rzutów ze statystyk;
- symulacji walki;
- map bitewnych, tokenów ani fog of war;
- rozwiniętego Trybu sesji na karcie gracza;
- automatyzacji HP, cooldownów, statusów i odpoczynków;
- globalnej wyszukiwarki całej aplikacji;
- płatnych API, AI ani usług wymagających abonamentu;
- funkcji zastępujących fizyczną rozgrywkę.

### Zachowujemy z obecnego Panelu DM

- podgląd postaci należących do kampanii;
- pełną kartę wybranej postaci;
- prywatne notatki DM o postaci;
- ogólną notatkę DM;
- dodawanie przedmiotów graczom;
- podgląd notatnika gracza.

Funkcje te trzeba przenieść do nowego modułu **Drużyna**, a nie usuwać.

---

# 2. Problemy obecnego Panelu DM

Obecny panel jest głównie karuzelą pełnych kart postaci. To powoduje, że:

- pełne dane wielu postaci są ładowane i renderowane jednocześnie;
- najważniejsze informacje o kampanii nie są widoczne od razu;
- DM nie ma miejsca na plan sesji, NPC, zadania, wątki, lokacje i materiały;
- jedna ogólna notatka nie wystarcza do prowadzenia długiej kampanii;
- interfejs skaluje się źle wraz z liczbą postaci i danych;
- panel bardziej przypomina podgląd kart niż narzędzie prowadzącego.

Najważniejszą zmianą UX jest usunięcie karuzeli pełnych kart z ekranu startowego. Pełna karta ma być ładowana dopiero po wybraniu konkretnej postaci.

---

# 3. Docelowa nawigacja Panelu DM

Panel ma sześć głównych sekcji:

1. **Pulpit**
2. **Sesje**
3. **Drużyna**
4. **Kampania**
5. **Materiały**
6. **Ustawienia**

Moduł **Kampania** zawiera podsekcje:

- Zadania;
- NPC;
- Lokacje;
- Frakcje;
- Wątki;
- Sekrety i wskazówki;
- Notatki;
- Historia.

## Układ responsywny

### Telefon

- górny pasek: powrót, nazwa kampanii, menu kontekstowe;
- pod nim poziomo przewijane zakładki najważniejszych sekcji;
- zawartość w jednej kolumnie;
- stały przycisk akcji „+” w prawym dolnym rogu;
- formularze i szczegóły otwierane na pełnym ekranie lub jako dolny panel;
- listy i filtry zamiast wielokolumnowego Kanbanu.

Menu „+”:

- szybka notatka;
- nowy NPC;
- nowe zadanie;
- nowe wydarzenie;
- nowy materiał;
- nowa sesja.

### Tablet poziomo i komputer

- lewy pasek: nawigacja modułów;
- środkowa część: lista lub główna zawartość;
- opcjonalny prawy panel: szczegóły, powiązania i szybkie akcje;
- maksymalnie trzy logiczne kolumny;
- panel boczny może być zwijany;
- nawigacja i aktywny moduł mają zachowywać się bez pełnego przeładowania strony.

### Wspólne zasady UI

- zachować aktualny język wizualny aplikacji i istniejące zmienne CSS;
- nie tworzyć drugiego, niezależnego design systemu;
- używać istniejących komponentów, ikon i wzorców formularzy, jeżeli są dostępne;
- zapewnić stany: ładowanie, pusty widok, błąd, brak uprawnień i zapisano;
- ważne operacje mają dawać natychmiastowy feedback;
- formularze mają zapobiegać przypadkowemu utraceniu niezapisanych zmian;
- interfejs musi być obsługiwalny klawiaturą i mieć czytelne etykiety;
- nie ładować pełnych rekordów wszystkich modułów na wejściu — pobierać dane dla aktywnej sekcji.

---

# 4. Moduły i sposób działania

## 4.1. Pulpit DM

Pulpit jest ekranem otwieranym domyślnie.

### Nagłówek kampanii

Wyświetla:

- nazwę i grafikę kampanii;
- liczbę członków;
- datę ostatniej sesji;
- następną zaplanowaną sesję;
- przycisk „Rozpocznij sesję” lub „Przygotuj sesję”;
- menu zarządzania kampanią.

### Skrót drużyny

Każda postać jest małą kartą zawierającą:

- awatar;
- imię postaci;
- nazwę gracza;
- rasę, klasę i poziom, jeżeli te dane istnieją;
- znacznik prywatnej notatki DM;
- przycisk otwarcia szczegółów.

Nie renderować na Pulpicie pełnej karty postaci.

### Kafelki stanu kampanii

- aktywne zadania;
- otwarte wątki;
- ostatnio zmienione notatki;
- ostatnio poznani NPC;
- elementy przygotowane do następnej sesji;
- ostatnia zakończona sesja.

Każdy kafelek prowadzi do przefiltrowanej listy właściwego modułu.

### Szybkie działania

- dodaj NPC;
- dodaj zadanie;
- zapisz pomysł;
- utwórz sesję;
- dodaj materiał;
- dodaj wydarzenie historii.

### Dlaczego warto

DM po wejściu od razu widzi stan kampanii i kolejne zadania organizacyjne, zamiast zaczynać od karty pierwszego gracza.

---

## 4.2. Sesje

Moduł ma wspierać przygotowanie i notowanie prawdziwej sesji, ale jej nie symulować.

### Lista sesji

Pola:

- numer;
- tytuł;
- planowana i faktyczna data;
- status: planowana, w trakcie, zakończona, anulowana;
- uczestnicy;
- krótkie podsumowanie.

Lista powinna mieć filtry statusu i sortowanie po dacie/numerze.

### Edytor przygotowania sesji

Sesja zawiera:

- plan DM;
- uporządkowaną listę scen;
- przypiętych NPC;
- przypięte lokacje;
- przypięte zadania i wątki;
- sekrety lub wskazówki możliwe do ujawnienia;
- możliwe nagrody;
- luźne notatki;
- checklistę przygotowań.

Scena zawiera tytuł, opis, kolejność, status oraz powiązania. Kolejność można zmienić przyciskami, a na urządzeniach obsługujących drag-and-drop również przeciąganiem. Funkcja musi pozostać dostępna bez drag-and-drop.

### Widok „Sesja w trakcie”

Na komputerze:

- lewa kolumna: plan i sceny;
- środkowa: duże pole notatek na żywo i wydarzenia;
- prawa: przypięte NPC, lokacje, zadania, wątki i sekrety.

Na telefonie:

- nagłówek sesji;
- przełączane sekcje: Plan, Notatki, Przypięte;
- stały przycisk „Dodaj wydarzenie”.

Dla scen dostępne akcje:

- zrealizowane;
- pominięte;
- przenieś do kolejnej sesji;
- wróć do planowanych.

### Szybkie wydarzenia sesji

Typy wpisu:

- decyzja drużyny;
- poznany NPC;
- odkryta informacja;
- zmiana zadania;
- zdobyty przedmiot;
- ważne wydarzenie fabularne;
- własny wpis.

Wydarzenie można powiązać z elementami kampanii. Zapis ma trafiać również do historii kampanii, bez tworzenia duplikatów.

### Zakończenie sesji

Kreator zakończenia wyświetla:

- podsumowanie;
- ważne decyzje;
- poznanych NPC;
- zmiany zadań;
- zdobyte przedmioty;
- elementy przeniesione do następnej sesji;
- treść widoczną dla graczy;
- prywatną notatkę DM.

System nie ma generować tekstu przez AI. Może wstępnie zebrać zapisane wydarzenia do edytowalnego szkicu.

---

## 4.3. Drużyna

### Lista drużyny

Zamiast karuzeli wyświetlić listę lub responsywną siatkę. Element zawiera:

- awatar;
- postać i gracza;
- rasę, klasę, poziom;
- skrót prywatnej notatki;
- status aktywności;
- menu działań.

### Szczegóły postaci dla DM

Zakładki:

- Podsumowanie;
- Karta postaci;
- Ekwipunek;
- Notatki DM;
- Wątki i sekrety;
- Historia.

Domyślnie otwiera się Podsumowanie, nie pełna karta.

Sekcja DM zawiera:

- prywatną notatkę;
- cele i osobiste wątki;
- sekrety znane postaci;
- powiązanych NPC;
- zadania osobiste;
- historię działań DM.

### Akcje

- dodaj przedmiot;
- edytuj lub usuń przedmiot dodany przez DM;
- wyślij prywatną informację;
- udostępnij materiał;
- przypisz sekret;
- przypnij zadanie osobiste;
- dodaj notatkę;
- oznacz nieobecność na sesji.

Istniejące zachowanie karty i notatnika gracza trzeba zachować. Nie duplikować logiki domenowej — wykorzystać aktualne komponenty i endpointy.

---

## 4.4. Zadania

Pola:

- nazwa;
- opis prywatny;
- opis dla graczy;
- status: przygotowane, dostępne, aktywne, wstrzymane, ukończone, nieudane, ukryte;
- cel główny;
- etapy/cel cząstkowy;
- zleceniodawca;
- NPC i lokacje;
- nagrody;
- rozwiązanie lub prywatne zakończenie;
- sesja rozpoczęcia i zakończenia;
- widoczność: tylko DM, drużyna, wybrane postacie.

DM może przygotować ukryte zadanie, a następnie użyć akcji „Ujawnij graczom”.

### Wyświetlanie

Na szerokim ekranie opcjonalny Kanban: Przygotowane, Aktywne, Zamknięte. Zawsze musi istnieć alternatywny widok listy. Na telefonie domyślnie lista z filtrami.

---

## 4.5. NPC

Pola:

- imię i portret;
- opis wyglądu;
- charakter i sposób mówienia;
- rola;
- frakcja;
- aktualna lokacja;
- stosunek do drużyny;
- status: aktywny, zaginiony, martwy, nieznany;
- opis publiczny;
- prywatne informacje DM;
- cele i sekrety;
- relacje z NPC i postaciami;
- historia spotkań;
- widoczność dla graczy.

Nie tworzyć na tym etapie graficznej mapy relacji. Czytelna lista relacji wystarczy.

Lista NPC powinna mieć wyszukiwanie lokalne w obrębie modułu oraz filtry statusu, frakcji, lokacji i widoczności.

---

## 4.6. Lokacje

Pola:

- nazwa;
- typ;
- ilustracja;
- opis publiczny i prywatny;
- lokacja nadrzędna;
- NPC;
- zadania i wątki;
- sekrety;
- historia wydarzeń;
- materiały;
- widoczność.

Lokacje tworzą hierarchię, np. region → miasto → dzielnica → budynek → pomieszczenie. To katalog wiedzy, nie interaktywna mapa.

---

## 4.7. Frakcje

Pola:

- nazwa i symbol;
- opis publiczny i prywatny;
- cele;
- przywódca i członkowie;
- siedziba;
- stosunek do drużyny: wrogi, nieprzychylny, neutralny, przyjazny, sojuszniczy;
- sojusznicy i przeciwnicy;
- prywatne plany;
- widoczność.

---

## 4.8. Wątki fabularne

Wątek jest oddzielny od zadania. Zadanie opisuje cel drużyny, a wątek opisuje element rozwijanej historii.

Pola:

- tytuł;
- opis;
- status: pomysł, przygotowany, aktywny, zawieszony, rozwiązany, porzucony;
- priorytet;
- postacie, NPC, lokacje, frakcje i sesje;
- planowane rozwinięcia;
- informacje odkryte przez graczy;
- opis publiczny i prywatny.

---

## 4.9. Sekrety i wskazówki

Typy:

- sekret świata;
- wskazówka;
- plotka;
- dowód;
- informacja o NPC;
- fałszywy trop;
- własny.

Status wiedzy:

- nieodkryte;
- częściowo odkryte;
- odkryte.

Należy przechowywać, która postać zna daną informację. Akcja ujawnienia musi wymagać wyboru odbiorców i potwierdzenia, żeby DM nie ujawnił sekretu przypadkowo.

---

## 4.10. Notatki DM

Obecną pojedynczą notatkę zastąpić systemem notatek, zachowując jej treść przez bezpieczną migrację.

Pola:

- tytuł;
- treść;
- kategoria;
- tagi;
- kolor;
- przypięcie;
- archiwizacja;
- powiązania z sesją, postacią, NPC, lokacją, zadaniem, frakcją lub wątkiem;
- daty utworzenia i modyfikacji.

Kategorie początkowe:

- Pomysły;
- Przygotowanie sesji;
- Fabuła;
- Gracze;
- Zasady własne;
- Luźne;
- Archiwum.

Automatyczny zapis powinien być opóźniony (debounce), pokazywać stan zapisu i nie wysyłać żądania po każdym znaku.

Komputer: lista z lewej, edytor z prawej.  
Telefon: lista, a edytor na osobnym pełnym ekranie.

---

## 4.11. Materiały / handouty

Typy:

- obraz;
- list;
- dokument;
- opis przedmiotu;
- opis lokacji;
- ogłoszenie;
- tekst;
- link;
- PDF, jeżeli obecna infrastruktura bezpiecznie obsługuje pliki.

Widoczność:

- prywatny;
- cała drużyna;
- wybrane postacie;
- przygotowany do późniejszego ujawnienia.

Akcja „Pokaż graczom” tworzy dostęp dla odbiorców i powiadomienie. Nie wysyłać ponownego powiadomienia przy zwykłej edycji udostępnionego materiału, chyba że DM jawnie wybierze „Powiadom ponownie”.

Materiały wyświetlać jako siatkę kart z miniaturą, nazwą, typem, widocznością i datą. Dodać filtry.

Pliki muszą mieć walidację MIME, limit rozmiaru, bezpieczne nazwy i kontrolę dostępu. Nie umieszczać plików prywatnych pod publicznym URL bez autoryzacji.

---

## 4.12. Historia kampanii

Jedna chronologiczna oś wydarzeń. Wpisy mogą powstawać automatycznie albo ręcznie.

Przykłady:

- rozpoczęto lub zakończono sesję;
- zmieniono status zadania;
- poznano NPC;
- ujawniono materiał;
- zmieniono status NPC;
- ukończono wątek;
- przyznano przedmiot.

Pola:

- data rzeczywista;
- opcjonalna data świata;
- typ;
- tytuł;
- opis;
- źródło;
- powiązania;
- widoczność.

Automatyczny wpis ma być tworzony w tej samej transakcji co zdarzenie źródłowe lub przez niezawodny mechanizm domenowy. Nie tworzyć historii wyłącznie po stronie klienta.

---

## 4.13. Ustawienia i uprawnienia

Funkcje:

- zmiana nazwy, opisu i grafiki;
- zapraszanie i usuwanie członków;
- wybór postaci gracza;
- archiwizacja kampanii;
- eksport danych kampanii;
- zarządzanie rolami.

Role przewidziane w modelu:

- właściciel / główny DM;
- współprowadzący;
- gracz.

Współprowadzący nie może zmienić właściciela ani usunąć kampanii. Uprawnienia do prywatnych danych DM muszą być sprawdzane na backendzie dla każdego endpointu, nie tylko ukrywane w UI.

---

# 5. Model danych — wytyczne

Codex ma najpierw sprawdzić istniejący schemat i nazewnictwo. Poniższe encje są modelem logicznym, nie nakazem dokładnych nazw tabel.

Minimalne encje:

- campaign_sessions;
- session_scenes;
- session_events;
- dm_notes;
- campaign_npcs;
- campaign_locations;
- campaign_factions;
- campaign_quests;
- quest_steps;
- campaign_story_threads;
- campaign_secrets;
- secret_recipients;
- campaign_materials;
- material_recipients;
- campaign_timeline_events;
- entity_relations;
- opcjonalnie campaign_co_dms lub rozszerzenie campaign_members.

Wspólne pola, gdzie mają sens:

- id;
- campaign_id;
- created_by;
- title/name;
- public_content;
- private_content;
- status;
- visibility;
- sort_order;
- created_at;
- updated_at;
- archived_at lub deleted_at.

## Ważne zasady bazy

- wszystkie rekordy muszą należeć do kampanii;
- klucze obce, indeksy i ograniczenia mają być jawne;
- indeksować co najmniej campaign_id, status, updated_at i najczęstsze relacje;
- migracje muszą być wstecznie bezpieczne;
- nie usuwać dotychczasowej notatki DM przed przeniesieniem danych;
- operacje obejmujące kilka tabel wykonywać transakcyjnie;
- listy mają korzystać z paginacji lub rozsądnych limitów;
- stosować istniejący styl identyfikatorów i migracji projektu;
- prywatność realizować danymi i autoryzacją, nie samym CSS.

## Relacje uniwersalne

Jeżeli obecna architektura na to pozwala, powiązania między modułami można obsłużyć tabelą relacji z typem encji i identyfikatorem. Jeśli projekt unika relacji polimorficznych, użyć jawnych tabel łączących. Codex ma wybrać rozwiązanie zgodne z obecnymi wzorcami i opisać decyzję.

---

# 6. API i backend

Codex ma dopasować endpointy do istniejącego stylu routingu. Każdy moduł potrzebuje:

- listy elementów kampanii;
- pobrania szczegółów;
- utworzenia;
- aktualizacji;
- archiwizacji/usunięcia;
- zmiany statusu;
- zarządzania widocznością;
- zarządzania powiązaniami.

## Wymagania API

- walidacja wszystkich danych wejściowych;
- sprawdzenie członkostwa i roli w kampanii;
- osobne DTO/widoki dla DM i gracza, aby prywatne pola nigdy nie wyciekły;
- stabilne kody błędów;
- limit długości tekstów i rozmiaru plików;
- paginacja, sortowanie i filtry po stronie serwera;
- ochrona przed IDOR — samo znanie identyfikatora nie daje dostępu;
- reużycie istniejącego systemu powiadomień i SSE;
- powiadomienia tylko dla właściwych odbiorców;
- brak sekretów i prywatnych notatek w payloadach gracza;
- testy autoryzacji dla każdej roli.

Nie tworzyć jednego ogromnego endpointu zwracającego cały panel. Pulpit powinien mieć lekki endpoint podsumowania, a poszczególne moduły ładować się osobno.

---

# 7. Migracja istniejącego Panelu DM

1. Zidentyfikować komponenty, endpointy i tabele obecnego panelu.
2. Dodać nowy szkielet nawigacji bez usuwania starej funkcjonalności.
3. Przenieść listę członków do modułu Drużyna.
4. Ładować pełną kartę dopiero po wyborze postaci.
5. Przenieść ogólną notatkę DM do pierwszej notatki w nowym systemie:
   - tytuł: „Ogólna notatka DM”;
   - kategoria: „Luźne”;
   - zachować autora, kampanię i treść;
   - migracja ma być idempotentna.
6. Zachować notatki przypisane do postaci oraz dodawanie przedmiotów.
7. Po potwierdzeniu zgodności usunąć wyłącznie nieużywany kod starej karuzeli.
8. Nie usuwać kolumn ani tabel w tej samej migracji, w której przenoszone są dane. Destrukcyjne porządki odłożyć na osobny, późniejszy etap.

---

# 8. Kolejność wdrożenia

Nie implementować całego dokumentu jednym ogromnym patchem. Każdy etap musi kończyć się działającą aplikacją, migracją, testami i krótką dokumentacją.

## Etap 0 — audyt

- sprawdź architekturę frontendu, backendu i bazy;
- znajdź aktualny Panel DM, routing, style, testy i system uprawnień;
- zapisz krótki plan plików do zmiany;
- sprawdź, czy repo ma dodatkowe instrukcje AGENTS.md;
- uruchom testy bazowe;
- nie zakładaj nazw plików ani frameworków na podstawie tego dokumentu.

## Etap 1 — nowy szkielet i Pulpit

- responsywna nawigacja Panelu DM;
- nowy Pulpit;
- lekki endpoint podsumowania;
- skrócona lista drużyny;
- szybkie akcje;
- przeniesienie pełnej karty do szczegółów postaci;
- zachowanie obecnych notatek i przyznawania przedmiotów.

### Kryteria ukończenia

- panel otwiera Pulpit;
- nie renderuje wielu pełnych kart jednocześnie;
- DM może wejść w pełną kartę wybranej postaci;
- stare funkcje nadal działają;
- telefon, tablet i desktop mają czytelny układ;
- brak regresji uprawnień.

## Etap 2 — system notatek DM

- tabele i migracja starej notatki;
- lista, edytor, kategorie, tagi, przypięcie;
- autosave z debounce i informacją o stanie;
- powiązanie z postacią i kampanią;
- szybka notatka z globalnego „+”.

## Etap 3 — sesje

- lista sesji;
- przygotowanie i sceny;
- widok sesji w trakcie;
- szybkie wydarzenia;
- zakończenie i podsumowanie;
- przenoszenie niezrealizowanych scen.

## Etap 4 — NPC, zadania i wątki

- kompletne CRUD;
- widoczność publiczna/prywatna;
- filtry i powiązania;
- akcje ujawniania graczom;
- integracja z Pulpitem i sesjami.

## Etap 5 — lokacje, frakcje, sekrety

- hierarchia lokacji;
- frakcje i relacje;
- śledzenie wiedzy poszczególnych postaci;
- bezpieczne ujawnianie.

## Etap 6 — materiały

- tekstowe handouty najpierw;
- obrazy i pliki tylko po sprawdzeniu istniejącego storage;
- odbiorcy, powiadomienia, kontrola dostępu;
- miniatury i limity.

## Etap 7 — historia i ustawienia

- automatyczna oś kampanii;
- filtry historii;
- współprowadzący i role;
- eksport kampanii;
- archiwizacja.

---

# 9. Testy i jakość

Dla każdego etapu wymagane są testy zgodne z obecnym stosem.

## Backend

- DM ma dostęp do swoich kampanii;
- gracz nie może otworzyć endpointów DM;
- osoba spoza kampanii otrzymuje odmowę;
- współprowadzący ma tylko nadane uprawnienia;
- publiczny rekord nie ujawnia private_content;
- filtr campaign_id jest wymuszony;
- zmiana statusu tworzy właściwy wpis historii;
- ujawnienie sekretu/materiału trafia wyłącznie do odbiorców;
- migracja notatek nie duplikuje danych;
- walidacja odrzuca nieprawidłowe statusy i nadmierne payloady.

## Frontend

- poprawne stany ładowania, błędu i pustej listy;
- przejścia między modułami;
- otwarcie szczegółów postaci;
- zachowanie szkicu/autosave;
- filtry;
- dialog potwierdzenia ujawnienia sekretu;
- responsywność w kluczowych szerokościach;
- obsługa klawiatury;
- brak pobierania prywatnych danych dla gracza.

## Testy regresji

- logowanie;
- kampanie i członkostwo;
- karta postaci;
- wiadomości i powiadomienia;
- dodawanie przedmiotów przez DM;
- istniejące notatki;
- build PWA i Capacitor, jeżeli repo ma odpowiednie polecenia.

---

# 10. Wydajność, offline i bezpieczeństwo

- Pulpit ma pobierać podsumowanie, nie wszystkie dane modułów;
- duże listy paginować;
- wyszukiwanie ograniczyć do aktualnego modułu;
- stosować lazy loading ciężkich widoków;
- nie umieszczać prywatnych danych DM w cache dostępnym dla gracza;
- nie logować treści sekretów, notatek ani tokenów;
- aktualizacje powinny używać kontroli wersji/updated_at tam, gdzie grozi nadpisanie;
- podstawowy odczyt niedawno otwartych danych może działać offline dopiero po bezpiecznym zaprojektowaniu cache;
- zmiany offline w danych DM nie są wymagane w pierwszych etapach;
- upload plików musi być zabezpieczony przed nieprawidłowym typem, wielkością i dostępem;
- wszystkie nowe zależności muszą być uzasadnione, open source i zgodne z licencją projektu;
- preferować rozwiązania już obecne w repo.

---

# 11. Definicja ukończenia całej przebudowy

Przebudowa jest ukończona, gdy:

- Panel DM nie zaczyna się od karuzeli pełnych kart;
- DM widzi Pulpit z aktualnym stanem kampanii;
- może przygotować, prowadzić i zakończyć sesję;
- może zarządzać NPC, zadaniami, wątkami, lokacjami, frakcjami i sekretami;
- może prowadzić wiele uporządkowanych notatek;
- może udostępniać graczom wybrane materiały i informacje;
- prywatne informacje nigdy nie są zwracane nieuprawnionym użytkownikom;
- istniejące dane i funkcje Panelu DM zostały zachowane;
- interfejs dobrze działa na telefonie, tablecie i komputerze;
- wszystkie migracje przechodzą na pustej oraz istniejącej bazie;
- testy i build projektu przechodzą;
- dokumentacja opisuje nowe endpointy, encje i uprawnienia.

---

# 12. Instrukcja wykonawcza dla Codexa

## Polecenie nadrzędne

Przeczytaj cały ten dokument przed zmianami. Traktuj go jako obowiązującą specyfikację najbliższego rozwoju Panelu DM. Nie realizuj starych pomysłów dotyczących rollera, automatyzacji karty postaci, walki ani globalnej wyszukiwarki.

## Sposób pracy

1. Najpierw wykonaj **Etap 0 — audyt**.
2. Sprawdź faktyczny kod, schemat bazy, migracje, testy, routing i istniejące instrukcje repozytorium.
3. Przed implementacją przedstaw krótki plan oparty na realnych nazwach plików.
4. Implementuj etapy po kolei. Domyślnie zacznij od **Etapu 1** i nie przechodź automatycznie do kolejnego dużego etapu, jeżeli poprzedni nie jest przetestowany.
5. Reużywaj obecnych komponentów i backendu. Nie przepisuj całej aplikacji.
6. Zachowuj kompatybilność danych i funkcji.
7. Każdą decyzję odbiegającą od dokumentu uzasadnij w podsumowaniu.
8. Nie dodawaj płatnych usług ani zależności bez potrzeby.
9. Po każdym etapie uruchom właściwe testy, lint i build dostępne w repo.
10. Zaktualizuj dokumentację techniczną oraz listę wykonanych i pozostałych elementów.

## Zakazy

- nie usuwaj działających funkcji przed wdrożeniem zamiennika;
- nie wykonuj destrukcyjnej migracji razem z migracją danych;
- nie opieraj autoryzacji wyłącznie na frontendzie;
- nie zwracaj prywatnych pól DM w odpowiedzi dla gracza;
- nie twórz monolitycznego komponentu całego panelu;
- nie implementuj wszystkich etapów w jednym nieprzeglądalnym commicie;
- nie zmieniaj niezwiązanych części aplikacji;
- nie zakładaj, że wcześniejsze propozycje w historii rozmów są nadal aktualne, jeśli przeczą temu dokumentowi.

## Pierwsze konkretne zadanie

Zrealizuj **Etap 0 i Etap 1**:

- przeanalizuj aktualny Panel DM;
- przebuduj nawigację;
- dodaj Pulpit kampanii;
- zastąp karuzelę skróconą listą drużyny;
- przenieś pełną kartę do szczegółów wybranej postaci;
- zachowaj prywatne notatki, notatnik gracza i dodawanie przedmiotów;
- dodaj testy;
- sprawdź responsywność;
- uruchom pełny zestaw dostępnych testów i build;
- podsumuj zmienione pliki, migracje, testy i ryzyka.

Po zakończeniu Etapu 1 przygotuj repo do Etapu 2, ale nie wdrażaj kolejnych dużych modułów w sposób prowizoryczny.
