# Gemeinsame Navigation

Alle HTML-Seiten im Ordner `app/src/main/assets/www/` laden dieselbe Navigation:

```html
<div data-include="components/nav.html"></div>
```

Die sichtbare Navigation wird ausschließlich in `components/nav.html` gepflegt. Das Design liegt zentral in `css/navigation.css` und `css/responsive.css`; das Verhalten in `js/navigation.js`.

Der FIRE-Rechner besitzt keine zusätzliche eigene Kopfzeile mehr. Dadurch sehen Startseite, Unterseiten, Anleitungen und Rechner identisch aus.

Beim Scrollen wird die Leiste erst ab 48 Pixeln leicht verkleinert. Die Verringerung ist bewusst gering: wenige Pixel Innenabstand, rund 3–4 % kleinere Logobreite und maximal ein Pixel weniger Buttonhöhe.

Prüfung nach Änderungen:

```bash
./scripts/verify-shared-navigation.sh
```

Das Skript kontrolliert automatisch alle HTML-Dateien im Wurzelordner der Webseite.
