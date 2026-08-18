# Pomysły na rozwój D&D Companion — pomocnik do fizycznej gry przy stole

Aktualizacja: 2026-08-18

## Kierunek produktu

D&D Companion nie ma zastępować fizycznej sesji RPG ani zamieniać się w VTT. Gra nadal odbywa się realnie przy stole, z rozmową, kartami, figurkami, mapą, notatkami i kośćmi według preferencji drużyny.

Aplikacja ma pełnić rolę cyfrowego pomocnika, który:

- przechowuje i porządkuje kartę postaci;
- przyspiesza wykonywanie powtarzalnych czynności podczas sesji;
- pomaga pilnować zasobów, efektów, umiejętności i ekwipunku;
- ułatwia organizację kampanii między sesjami;
- daje DM-owi wygodne narzędzia organizacyjne, bez symulowania całej gry;
- działa możliwie dobrze offline;
- nie wymaga płatnych usług zewnętrznych.

Jeżeli jakaś funkcja wymaga biblioteki zewnętrznej, powinna to być biblioteka open source dołączona bezpośrednio do aplikacji. Jeżeli kiedykolwiek potrzebna byłaby usługa firmy trzeciej, musi posiadać faktycznie darmowy plan bez ograniczenia do okresu próbnego. Preferowane jest jednak całkowite unikanie takich zależności.

## Co aplikacja już ma

Obecna wersja zawiera już solidną bazę:

- wiele postaci i rozbudowaną kartę postaci;
- statystyki, podstatystyki i własne wzory;
- umiejętności, talenty, pasywki i obozówki;
- koszt, cooldown, czas trwania i wzory dla części umiejętności;
- ekwipunek z ilością, ikonami i kolejnością;
- notatnik tekstowy i kartkę do rysowania;
- znajomych, wiadomości prywatne i powiadomienia;
- kampanie i drużyny;
- Panel DM z podglądem postaci, prywatnymi notatkami i możliwością dodawania przedmiotów;
- PWA oraz aplikację mobilną przez Capacitor;
- backend Express, PostgreSQL oraz SSE.

Nowe funkcje powinny przede wszystkim rozwijać te elementy zamiast budować osobny system gry.

---

# 1. Tryb sesji — najważniejszy kierunek rozwoju

## 1.1. Tryb sesji postaci

Specjalny uproszczony widok uruchamiany podczas gry przy stole.

Powinien pokazywać tylko najpotrzebniejsze rzeczy:

- bieżące HP;
- najważniejsze zasoby;
- aktywne efekty;
- aktywne cooldowny;
- ulubione umiejętności;
- najczęściej używane przedmioty;
- podstawowe statystyki i podstatystyki;
- szybki dostęp do notatnika.

Pełna edycja postaci nadal pozostaje w zwykłym widoku.

### Priorytet: bardzo wysoki

To jedna z funkcji, która najlepiej pasuje do charakteru aplikacji jako pomocnika przy stole.

## 1.2. Przypinanie najważniejszych elementów

Możliwość oznaczenia jako ulubione:

- umiejętności;
- przedmiotów;
- statystyk;
- zasobów;
- pasywek;
- notatek.

Przypięte elementy trafiałyby do Trybu sesji.

## 1.3. Opcja „nie wygaszaj ekranu podczas sesji”

Podczas aktywnego Trybu sesji aplikacja może opcjonalnie utrzymywać ekran aktywny.

Nie wymaga zewnętrznej usługi.

## 1.4. Szybki notatnik sesyjny

Oddzielny prosty notes przeznaczony do zapisywania rzeczy na szybko podczas gry.

Każdy wpis może automatycznie otrzymywać godzinę lub numer sesji.

Po sesji notatki można przenieść do właściwego notatnika postaci albo dziennika kampanii.

---

# 2. HP, zasoby i stan postaci

## 2.1. Bieżące i maksymalne HP

Obecne pole HP warto rozdzielić logicznie na:

- maksymalne HP;
- bieżące HP;
- opcjonalne dodatkowe/tymczasowe HP.

Zmiana powinna być bardzo szybka.

## 2.2. Szybkie obrażenia i leczenie

Zamiast ręcznego wpisywania nowego HP:

- `-5` obrażeń;
- `+8` leczenia;
- ustaw konkretną wartość.

Opcjonalnie można wpisać krótką przyczynę.

## 2.3. Własne liczniki zasobów

Użytkownik może tworzyć dowolne zasoby, np.:

- mana;
- stamina;
- punkty szczęścia;
- punkty ki;
- amunicja;
- ładunki przedmiotu;
- punkty specjalnej mechaniki kampanii.

Każdy licznik:

- nazwa;
- wartość bieżąca;
- wartość maksymalna;
- sposób resetowania.

## 2.4. Zasoby przy umiejętnościach

Umiejętność może mieć własną liczbę użyć, np.:

- 3 użycia;
- 1 raz na odpoczynek;
- 2 razy na sesję;
- własny licznik.

## 2.5. Statusy i efekty

Aktywne efekty takie jak:

- zatrucie;
- ogłuszenie;
- krwawienie;
- błogosławieństwo;
- osłabienie;
- własny efekt.

Efekt może posiadać:

- nazwę;
- opis;
- czas trwania;
- liczbę tur;
- źródło;
- ikonę.

## 2.6. Historia zmian stanu postaci

Prosta historia ostatnich zmian:

- HP;
- zasobów;
- statusów;
- wykorzystanych ładunków.

Przydatne szczególnie wtedy, gdy podczas sesji ktoś przypadkiem zmieni złą wartość.

## 2.7. Cofnięcie ostatniej zmiany

Jedno kliknięcie pozwalające cofnąć ostatnią zmianę HP, licznika albo przedmiotu.

### Priorytet: bardzo wysoki

---

# 3. Cooldowny, czas trwania i odpoczynki

## 3.1. Aktywne cooldowny

Obecne pola cooldown mogą zostać zamienione w faktycznie działające liczniki.

Po użyciu umiejętności można aktywować cooldown, np.:

- 3 tury;
- 10 minut;
- do końca sceny;
- do odpoczynku.

## 3.2. Liczniki czasu trwania

To samo dla efektów i przedmiotów.

## 3.3. Przycisk „następna tura”

Nie jako pełna walka w telefonie, ale jako prosty mechanizm zmniejszający:

- cooldowny;
- efekty liczone w turach;
- aktywne czasy działania.

## 3.4. Krótki / długi / własny odpoczynek

Aplikacja może pozwolić zdefiniować, co resetuje dany odpoczynek.

Przykład:

- odnów określone zasoby;
- usuń wybrane efekty;
- przywróć użycia umiejętności;
- zakończ wybrane cooldowny.

Nie należy na sztywno narzucać zasad konkretnej edycji D&D — mechanizm powinien być konfigurowalny.

---

# 4. Roller kości jako dodatek, nie centrum aplikacji

## 4.1. Prosty roller

Obsługa:

- k4;
- k6;
- k8;
- k10;
- k12;
- k20;
- k100;
- dowolnej liczby kości;
- modyfikatora.

## 4.2. Rzut bezpośrednio ze statystyki

Kliknięcie wybranej statystyki może pozwalać wykonać rzut z jej modyfikatorem.

## 4.3. Własne makra rzutów

Np.:

`2k6 + Siła + 3`

Można wykorzystać istniejący mechanizm wzorów.

## 4.4. Ulubione rzuty

Kilka najczęściej używanych formuł dostępnych bezpośrednio w Trybie sesji.

## 4.5. Historia ostatnich rzutów

Wystarczy lokalna lub krótkoterminowa historia.

Nie ma potrzeby budowania rozbudowanego systemu publicznych rzutów ani zdalnej sesji.

### Priorytet: średni

Fizyczne kości nadal mogą pozostać podstawowym sposobem gry.

---

# 5. Ekwipunek — rozwój pod użycie przy stole

## 5.1. Status przedmiotu

Przedmiot może być oznaczony jako:

- założony;
- trzymany;
- w plecaku;
- schowany;
- zużyty.

## 5.2. Ulubione przedmioty

Najczęściej używane przedmioty trafiają do Trybu sesji.

## 5.3. Ładunki i zużycie

Przedmiot może mieć np.:

- 3/5 ładunków;
- 7 strzał;
- 2 mikstury.

## 5.4. Własne tagi

Np.:

- broń;
- leczenie;
- quest;
- magiczne;
- zużywalne;
- narzędzia.

## 5.5. Wyszukiwanie i filtrowanie ekwipunku

Przy dużej liczbie przedmiotów.

## 5.6. Udźwig

Opcjonalne:

- waga przedmiotu;
- łączna waga;
- limit postaci;
- ostrzeżenie o przekroczeniu limitu.

Powinno być możliwe całkowite wyłączenie systemu udźwigu.

## 5.7. Historia przedmiotów

Krótka historia:

- dodano;
- usunięto;
- przekazano;
- zużyto.

## 5.8. Przekazywanie przedmiotów między postaciami

Jeżeli dwie postacie są w tej samej kampanii, właściciel może zaproponować przekazanie przedmiotu.

Druga osoba zatwierdza operację.

Nie jest to system handlu online — jedynie wygodny zapis tego, co fizycznie wydarzyło się przy stole.

---

# 6. Umiejętności, pasywki i talenty

## 6.1. Wyszukiwanie

Szybka wyszukiwarka wszystkich zdolności postaci.

## 6.2. Tagi

Np.:

- walka;
- leczenie;
- ruch;
- reakcja;
- eksploracja;
- społeczne.

## 6.3. Ulubione umiejętności

Najczęściej używane trafiają do Trybu sesji.

## 6.4. Historia użyć

Opcjonalna informacja o ostatnim użyciu.

## 6.5. Automatyczne wykorzystanie zasobu

Umiejętność może opcjonalnie być powiązana z licznikiem zasobu.

Przykład:

- użycie zaklęcia odejmuje 2 many;
- strzał zmniejsza amunicję o 1;
- specjalna zdolność zużywa 1 ładunek.

Operacja zawsze powinna być możliwa do cofnięcia.

## 6.6. Biblioteka własnych wpisów

Użytkownik może zapisywać własne:

- umiejętności;
- talenty;
- przedmioty;
- pasywki.

Następnie może dodawać je do innych własnych postaci bez ponownego przepisywania.

---

# 7. Wyszukiwanie i szybki dostęp

## 7.1. Globalna wyszukiwarka

Jedno pole może przeszukiwać:

- statystyki;
- umiejętności;
- talenty;
- przedmioty;
- notatki;
- gildie;
- profesje;
- kampanie.

## 7.2. Ostatnio używane

Sekcja pokazująca ostatnio otwierane elementy.

## 7.3. Skróty na ekranie głównym aplikacji

Użytkownik może sam wybrać, które sekcje chce mieć pod ręką.

### Priorytet: wysoki

---

# 8. Kampania — pomoc między sesjami

## 8.1. Dziennik kampanii

Wspólna chronologia wydarzeń.

Każdy wpis może mieć:

- tytuł;
- datę;
- numer sesji;
- opis;
- autora.

## 8.2. Podsumowanie sesji

Oddzielny typ wpisu w dzienniku.

Po każdej sesji można zapisać krótkie podsumowanie tego, co wydarzyło się przy stole.

## 8.3. Zadania i cele

Prosta lista:

- nowe;
- aktywne;
- wykonane;
- porzucone.

Dodatkowo:

- opis;
- nagroda;
- notatki;
- osoba odpowiedzialna.

## 8.4. Wspólne notatki drużyny

Oddzielne od prywatnych notatek postaci.

## 8.5. Znani NPC

Drużynowy spis NPC, których gracze już poznali.

Pola:

- imię;
- krótki opis;
- relacja z drużyną;
- ostatnie spotkanie;
- notatki.

DM decyduje, co jest widoczne dla graczy.

## 8.6. Znane miejsca

Podobny prosty katalog lokacji:

- nazwa;
- opis;
- region;
- notatki;
- status np. odwiedzone / znane / niedostępne.

Nie jest to mapa interaktywna ani VTT.

## 8.7. Ogłoszenia DM

Przypięte informacje dla całej kampanii.

Przykłady:

- następna sesja;
- zmiana zasad;
- ważna informacja organizacyjna.

## 8.8. Czat kampanii

Przydatny przede wszystkim między sesjami.

Nie musi zastępować Discorda czy Messengera — ma być prostym kanałem dotyczącym konkretnej kampanii.

## 8.9. Ankiety

Proste głosowanie, np.:

- który termin sesji pasuje;
- którą drogę wybieramy;
- kto bierze dany przedmiot.

W całości obsługiwane przez własny backend.

---

# 9. Organizacja sesji

## 9.1. Kalendarz sesji w aplikacji

DM proponuje termin, gracze oznaczają:

- będę;
- nie będę;
- jeszcze nie wiem.

## 9.2. Eksport terminu do pliku ICS

Zamiast integrować się z Google Calendar lub inną płatną/zewnętrzną usługą, aplikacja może wygenerować standardowy plik `.ics`.

Użytkownik otwiera go w dowolnym kalendarzu w telefonie.

## 9.3. Historia sesji

Lista odbytych sesji z:

- datą;
- uczestnikami;
- krótkim opisem;
- powiązanym wpisem dziennika.

## 9.4. Lista przygotowań przed sesją

Każdy użytkownik może mieć checklistę, np.:

- sprawdzić ekwipunek;
- przygotować rozwój postaci;
- przeczytać ostatnie podsumowanie;
- zabrać kości.

## 9.5. Lokalnie ustawiane przypomnienia

Aplikacja może korzystać z obecnego systemu lokalnych powiadomień.

Nie wymaga płatnej usługi push.

---

# 10. Wspólny skarbiec drużyny

## 10.1. Wspólna waluta

Np.:

- złoto;
- srebro;
- własne waluty.

## 10.2. Wspólne przedmioty

Rzeczy należące do całej drużyny.

## 10.3. Historia operacji

Kto:

- dodał;
- pobrał;
- przekazał;
- zużył.

## 10.4. Podział łupów

DM może dodać zestaw nagród po sesji, a następnie przypisać je postaciom.

Nie jest potrzebny automatyczny system aukcji ani ekonomia online.

---

# 11. Panel DM — rozwój zgodny z fizyczną sesją

## 11.1. Panel sesji DM

Jeden ekran z:

- listą graczy;
- bieżącym HP, jeśli gracze je udostępniają;
- aktywnymi efektami;
- ważnymi prywatnymi notatkami;
- szybkimi przyciskami przyznawania nagród.

## 11.2. Prosty tracker inicjatywy

Tracker ma tylko pomagać w kolejności przy stole.

Funkcje:

- ręczne wpisanie inicjatywy;
- przeciąganie kolejności;
- aktualna tura;
- następna/poprzednia tura;
- licznik rund.

Nie należy dodawać mapy, ruchu po polach ani automatycznej symulacji walki.

## 11.3. Przeciwnicy jako proste karty pomocnicze

DM może utworzyć prywatną kartę przeciwnika z:

- nazwą;
- HP;
- kilkoma statystykami;
- krótkimi zdolnościami;
- notatkami.

To odpowiednik kartki za ekranem DM, a nie pełny system walki.

## 11.4. Biblioteka NPC

Prywatne karty DM:

- imię;
- portret;
- opis;
- charakter;
- relacje;
- miejsce;
- tajne notatki.

## 11.5. Biblioteka lokacji

Prywatne opisy miejsc dla DM.

## 11.6. Biblioteka własnych przeciwników

Możliwość duplikowania przygotowanych wcześniej kart.

## 11.7. Przyznawanie nagród

DM może dodać jednej lub wielu postaciom:

- przedmiot;
- walutę;
- XP;
- własny zasób.

## 11.8. Sekretne notatki DM o postaci

Obecna funkcja powinna pozostać i może zostać rozszerzona o tagi oraz przypomnienia.

## 11.9. Udostępnianie informacji graczom

DM może oznaczyć jako „ujawnione”:

- NPC;
- lokację;
- wpis;
- przedmiot;
- fragment informacji.

Gracze dostają ją w aplikacji jako kartę/handout.

## 11.10. Generator prostych tabel losowych

Bez AI i bez API.

DM może stworzyć własną tabelę, np.:

- pogoda;
- spotkania;
- imiona;
- plotki;
- skarby.

Aplikacja losuje jedną pozycję.

## 11.11. Wbudowane proste generatory offline

Opcjonalnie można dołączyć statyczne zestawy:

- imion;
- nazw tawern;
- nazw miejsc;
- prostych cech NPC.

Dane mogą być przechowywane lokalnie jako JSON i nie wymagają żadnego API.

---

# 12. Pokazywanie informacji przy stole

## 12.1. Tryb „pokaż kartę”

Użytkownik może otworzyć wybraną:

- umiejętność;
- statystykę;
- przedmiot;
- notatkę.

Aplikacja pokazuje ją w dużym, czytelnym widoku, aby łatwo pokazać ekran DM-owi lub innemu graczowi.

## 12.2. Tymczasowy widok tylko do odczytu

Przy przekazaniu telefonu innej osobie można ukryć:

- prywatne wiadomości;
- prywatne notatki;
- ustawienia konta.

Wyświetlana jest tylko karta postaci lub wybrana sekcja.

## 12.3. Handouty DM

DM może udostępnić tekst lub obraz graczom.

Powinny to być małe materiały przechowywane w ramach własnej infrastruktury, bez zewnętrznego hostingu plików.

Ze względu na obecne przechowywanie obrazów w bazie należy wprowadzić rozsądne limity rozmiaru i kompresję.

---

# 13. QR i szybkie łączenie ludzi przy stole

## 13.1. Kod QR zaproszenia do znajomych

Obecny kod zaproszenia może być pokazany również jako QR.

## 13.2. Kod QR zaproszenia do kampanii

DM pokazuje QR na ekranie, gracze skanują go telefonami.

## 13.3. QR do udostępnienia konkretnej informacji

Opcjonalnie w przyszłości np. jednorazowy link do handoutu.

Generator QR można zrealizować lokalną biblioteką open source, bez usług zewnętrznych.

---

# 14. Rozwój postaci

## 14.1. Historia poziomów

Zapis zmian poziomu postaci.

## 14.2. Notatki rozwoju

Gracz może zapisać plan:

- co chce rozwinąć;
- jaką zdolność wybrać;
- czego potrzebuje do kolejnego poziomu.

## 14.3. XP / postęp

Opcjonalny licznik:

- aktualne XP;
- próg kolejnego poziomu.

Może być całkowicie wyłączony dla kampanii bez XP.

## 14.4. Snapshot przed dużą zmianą

Przed awansem aplikacja może zapisać kopię stanu postaci.

---

# 15. Szablony i kopiowanie

## 15.1. Duplikowanie postaci

Kopia bez kampanii i relacji społecznych.

## 15.2. Szablon postaci

Możliwość zapisania układu:

- statystyk;
- pól;
- kategorii;
- własnych wzorów.

Przydatne przy kampaniach korzystających z własnego systemu zasad.

## 15.3. Szablony ekwipunku

Np. zestaw startowy.

## 15.4. Szablony zdolności

Dla własnych systemów i klas.

### Priorytet: średni

---

# 16. Bezpieczeństwo danych

## 16.1. Eksport postaci do JSON

Pełna kopia postaci możliwa do zapisania lokalnie.

## 16.2. Import postaci z JSON

Z walidacją wersji formatu i podglądem przed importem.

## 16.3. Eksport czytelnej karty do PDF

Generowany lokalnie po stronie urządzenia lub przez mechanizm drukowania przeglądarki.

Bez zewnętrznej usługi konwersji.

## 16.4. Wersja do druku

Czytelna karta A4 jako awaryjna fizyczna kopia.

To szczególnie dobrze pasuje do aplikacji wspierającej grę przy stole.

## 16.5. Snapshoty postaci

Automatyczne lub ręczne punkty przywracania.

## 16.6. Historia zmian postaci

Możliwość podejrzenia najważniejszych zmian.

## 16.7. Kosz

Usunięte postacie i ważne dane pozostają przez określony czas możliwe do odzyskania.

## 16.8. Eksport całej kampanii przez DM

Kopia:

- dziennika;
- NPC;
- lokacji;
- zadań;
- notatek DM;
- listy członków.

Bez haseł, tokenów i danych prywatnych kont.

### Priorytet: wysoki

---

# 17. Offline — bardzo ważne przy fizycznych sesjach

## 17.1. Pełny odczyt postaci offline

Po wcześniejszym otwarciu postać powinna być dostępna nawet bez internetu.

## 17.2. Offline dla Trybu sesji

Najważniejsze dane:

- HP;
- zasoby;
- umiejętności;
- ekwipunek;
- notatki.

## 17.3. Kolejka zmian

Zmiany wykonane offline są zapisywane lokalnie.

Po odzyskaniu połączenia aplikacja synchronizuje je z serwerem.

## 17.4. Czytelne rozwiązywanie konfliktów

Jeżeli ta sama postać została zmieniona na dwóch urządzeniach, aplikacja nie powinna po cichu nadpisywać danych.

## 17.5. Informacja o stanie synchronizacji

Np.:

- zsynchronizowano;
- zapisano lokalnie;
- oczekuje na synchronizację;
- konflikt.

### Priorytet: bardzo wysoki

Fizyczna sesja nie powinna być uzależniona od jakości Wi-Fi lub LTE przy stole.

---

# 18. Wygoda interfejsu

## 18.1. Konfigurowalny ekran główny

Użytkownik wybiera, które kafelki chce widzieć.

## 18.2. Tryb telefonu i tabletu

Lepsze wykorzystanie większych ekranów.

## 18.3. Widok poziomy

Przydatny szczególnie dla tabletów i Panelu DM.

## 18.4. Większe przyciski w Trybie sesji

Obsługa jedną ręką podczas gry.

## 18.5. Dynamiczny rozmiar tekstu

## 18.6. Lepsza dostępność

- kontrast;
- czytniki ekranu;
- obsługa klawiatury w PWA;
- czytelne focusy.

## 18.7. Motyw jasny/ciemny

Jeżeli nie jest jeszcze dostępny jako pełna funkcja.

## 18.8. Indywidualne kolory kategorii

Np. leczenie, walka, eksploracja.

---

# 19. Funkcje społecznościowe, które nadal mają sens

## 19.1. Wiadomości kampanii

Głównie organizacyjne i między sesjami.

## 19.2. Przypięte wiadomości

## 19.3. Reakcje emoji

Można zrealizować wewnętrznie bez usług zewnętrznych.

## 19.4. Wysyłanie linku do konkretnego elementu aplikacji

Np. link otwierający konkretną kampanię lub wpis dziennika.

## 19.5. Powiadomienia tylko o ważnych wydarzeniach

Użytkownik może zdecydować, które typy powiadomień chce otrzymywać.

---

# 20. Drobne funkcje o dużej wartości

## 20.1. Kalkulator prostych wartości

Mały kalkulator dostępny z Trybu sesji.

## 20.2. Licznik pieniędzy postaci

Obsługa wielu walut.

## 20.3. Historia transakcji

Krótki opis, np. „nocleg”, „nagroda”, „mikstura”.

## 20.4. Liczniki własne bez przypisywania do HP lub many

Np. reputacja, głód, stres, korupcja.

## 20.5. Proste timery

Np. 10 minut przerwy, czas trwania efektu w czasie rzeczywistym.

Działają lokalnie.

## 20.6. Losowanie osoby z drużyny

Przydatne dla DM do losowych zdarzeń.

## 20.7. Losowanie z własnej listy

Dowolna tabela użytkownika.

## 20.8. Numer sesji

Automatyczny licznik kolejnych sesji kampanii.

## 20.9. Oznaczanie „ważne”

Dla notatek, NPC, przedmiotów i informacji kampanii.

---

# 21. Funkcje, których nie warto dodawać do tego projektu

Aby D&D Companion pozostał pomocnikiem, a nie osobną grą/VTT, nie rekomenduje się budowania:

- taktycznej mapy bitewnej;
- przesuwania tokenów po mapie;
- fog of war;
- pełnej automatycznej symulacji walki;
- zdalnego stołu do gry;
- rozmów głosowych i wideo;
- streamingu ekranu;
- rozbudowanych animacji 3D kości;
- pełnego kreatora map;
- marketplace przedmiotów;
- mikrotransakcji;
- systemu automatycznego matchmakingu;
- hostowanych serwerów głosowych;
- AI wymagającego płatnego API jako kluczowej części aplikacji;
- obowiązkowych integracji z Discordem, Google Calendar, Notion itp.;
- funkcji, bez których aplikacja przestaje działać po wyczerpaniu darmowego limitu zewnętrznego API.

---

# 22. Funkcje z propozycji Codexa — ocena po doprecyzowaniu kierunku

## Zdecydowanie zostawić

- roller kości;
- rzuty ze statystyk;
- własne formuły;
- HP i własne zasoby;
- szybkie obrażenia i leczenie;
- warunki i statusy;
- cooldowny;
- prosty tracker inicjatywy;
- historia zmian;
- dziennik kampanii;
- zadania;
- wspólne notatki;
- kalendarz sesji;
- skarbiec drużyny;
- role i uprawnienia;
- biblioteka NPC;
- karty NPC;
- nagrody;
- prywatne notatki DM;
- szablony i duplikowanie postaci;
- globalne wyszukiwanie;
- tagi;
- status wyposażenia;
- udźwig;
- biblioteka własnych wpisów;
- eksport/import JSON;
- PDF/druk;
- kosz;
- offline i synchronizacja.

## Zostawić, ale uprościć

### Panel spotkania

Tak, ale jako ekran organizacyjny DM, nie centrum cyfrowej walki.

### Tryb prezentacji informacji

Tak, ale jako prosty handout/karta do pokazania graczowi.

### Czat kampanii

Tak, ale głównie do organizacji między sesjami.

### Publiczne/prywatne rzuty

Nie są kluczowe. Można ewentualnie dodać później jako prostą opcję udostępnienia wyniku.

### Historia rzutów

Krótka historia wystarczy. Nie ma potrzeby budować dużego archiwum wszystkich rzutów kampanii.

---

# 23. Rekomendowana kolejność wdrażania

## Etap 1 — Tryb sesji

Największa wartość dla osoby faktycznie siedzącej przy stole.

1. bieżące/maksymalne HP;
2. własne liczniki zasobów;
3. szybkie obrażenia i leczenie;
4. statusy;
5. aktywne cooldowny;
6. ulubione umiejętności/przedmioty;
7. Tryb sesji;
8. cofnięcie ostatniej zmiany.

## Etap 2 — szybka obsługa dużych postaci

1. globalne wyszukiwanie;
2. tagi;
3. filtrowanie ekwipunku;
4. status wyposażenia;
5. ładunki i amunicja;
6. biblioteka własnych wpisów.

## Etap 3 — odporność na problemy techniczne podczas sesji

1. offline odczyt postaci;
2. offline Trybu sesji;
3. kolejka zmian;
4. synchronizacja;
5. eksport JSON;
6. PDF/druk;
7. snapshoty.

## Etap 4 — pomoc dla kampanii

1. dziennik kampanii;
2. podsumowania sesji;
3. questy;
4. wspólne notatki;
5. znani NPC;
6. znane miejsca;
7. kalendarz i RSVP;
8. ICS;
9. skarbiec.

## Etap 5 — narzędzia DM przy stole

1. Panel sesji DM;
2. prosty tracker inicjatywy;
3. proste karty przeciwników;
4. biblioteka NPC;
5. nagrody;
6. handouty;
7. własne tabele losowe.

## Etap 6 — dodatki

1. roller kości;
2. makra rzutów;
3. QR zaproszeń;
4. ankiety;
5. rozwój postaci i XP;
6. szablony postaci.

---

# 24. Proponowany najbliższy pakiet funkcjonalny

Najbardziej sensowny kolejny większy pakiet dla obecnej wersji D&D Companion:

1. **Tryb sesji**;
2. **bieżące/maksymalne HP**;
3. **własne liczniki zasobów**;
4. **statusy i efekty**;
5. **aktywne cooldowny**;
6. **ulubione umiejętności i przedmioty**;
7. **szybkie obrażenia/leczenie**;
8. **cofnięcie ostatniej zmiany**;
9. **globalne wyszukiwanie**;
10. **podstawowy cache postaci offline**.

Ten zestaw bardzo mocno poprawiłby używanie aplikacji podczas realnej sesji przy stole, a jednocześnie nie przesuwa projektu w stronę VTT.

---

# 25. Docelowa rola D&D Companion

Dobrą granicą projektową jest zasada:

> Jeżeli funkcja pomaga szybciej sprawdzić, zapisać, policzyć, przypomnieć lub uporządkować coś, co dzieje się podczas fizycznej sesji — pasuje do D&D Companion.
>
> Jeżeli funkcja zaczyna zastępować stół, mapę, figurki, rozmowę albo samą rozgrywkę — prawdopodobnie nie pasuje do tego projektu.

W ten sposób aplikacja może stać się bardzo rozbudowanym i wygodnym companionem bez zamieniania się w kolejną platformę do grania online.
