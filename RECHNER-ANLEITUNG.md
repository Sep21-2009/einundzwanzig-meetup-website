# Ausführliche Anleitung zum Bitcoin-Rentenrechner

Die vollständige, gestaltete Anleitung befindet sich in [`rechner-anleitung.html`](rechner-anleitung.html). Sie erklärt sämtliche Eingaben, Berechnungsmodelle, Entnahmestrategien, die DCA-Ansparphase und die Monte-Carlo-Auswertung.

## Schnellstart

1. **EUR oder USD wählen.** Die Auswahl gilt für den gesamten Rechner. Der DCA-Zahlenwert bleibt beim Wechsel bewusst nominal gleich und sollte danach geprüft werden.
2. **Bitcoin-Preis prüfen.** Der Live-Preis wird vorausgewählt, kann aber frei überschrieben werden.
3. **Bitcoin-Bestand eingeben.** BTC und Sats können direkt umgeschaltet werden.
4. **Rechenziel wählen.** Feste Entnahme, Entnahme berechnen oder 3-/4-%-Regel.
5. **Kursmodell auswählen.** Konstant, Abschwächung anhand von Bärenmarkt-Böden oder Power Law.
6. **Rentenstart, Laufzeit und optional DCA eintragen.** Jeder DCA-Kauf verwendet den Preis seines tatsächlichen Kaufmonats.
7. **Monte Carlo konfigurieren.** Volatilität, Anzahl der Pfade, Seed und Zielquote festlegen.
8. **Mehrere Szenarien vergleichen.** Kein einzelnes Ergebnis ist eine Kursprognose.

## Rechenziele

### Feste Entnahme

Ein selbst gewählter Monatsbetrag wird bis zum Ende der Laufzeit simuliert. Der Rechner zeigt, ob der Bestand reicht, wie viele BTC verkauft werden und welches Endvermögen verbleibt.

### Entnahme berechnen

Der glatte Modellverlauf berechnet den maximalen festen Monatsbetrag, bei dem das nominale Kapital zum Rentenstart nach keinem Rentenmonat unterschritten wird.

Für Monte Carlo stehen zwei Ziele zur Auswahl:

- **Bestand reicht:** Alle Entnahmen können in der gewählten Zielquote bis zum Ende bedient werden.
- **Startkapital am Ende erhalten:** Das nominale Endkapital ist in der gewählten Zielquote mindestens so hoch wie beim Rentenstart.

### 3-/4-%-Regel

Der Monatsbetrag des ersten Rentenjahres wird aus dem Kapital zum Rentenstart und dem eingestellten Prozentsatz berechnet. Danach steigt die Entnahme einmal pro Jahr um die angenommene Inflation.

## Kursmodelle

- **Konstant:** identische Jahresrendite über die gesamte Laufzeit.
- **Abschwächung:** aus benachbarten Bärenmarkt-Böden werden Boden-zu-Boden-CAGRs berechnet und zu einer abflachenden Renditekurve zusammengeführt.
- **Power Law:** der heutige Preis bleibt Anker; der Exponent bestimmt die Steilheit der zukünftigen Kurve.

## DCA und Rentenstart

Bei einem zukünftigen Rentenstart beginnt die Ansparphase heute. Der erste Kauf erfolgt sofort, danach monatlich. Der letzte Kauf liegt vor dem ersten Entnahmetag. In Monte Carlo hat jeder Pfad eigene Kaufpreise und dadurch einen eigenen BTC-Bestand zum Rentenstart.

## Monte-Carlo-Auswertung

- **P10:** schwaches Szenario; 10 % der Ergebnisse liegen darunter.
- **P50/Median:** die Hälfte liegt darunter, die Hälfte darüber.
- **P90:** starkes Szenario; nur 10 % liegen darüber.
- **Erfolgsquote:** Anteil der Pfade, die das gewählte Ziel erfüllen.

Ein Median von 0 bedeutet, dass mindestens die Hälfte der Pfade vorzeitig aufgebraucht wurde. Monte Carlo ist eine vereinfachte Modellrechnung und keine belastbare Zukunftswahrscheinlichkeit.

## Datenschutz und Grenzen

Die Berechnung läuft lokal im Browser. Nur öffentliche Bitcoin-Preis- und Blockdaten werden für die Navigation geladen. Nicht automatisch berücksichtigt werden unter anderem Steuern, Gebühren, Spreads, persönliche Ausgabenänderungen und Verwahrungsrisiken.
