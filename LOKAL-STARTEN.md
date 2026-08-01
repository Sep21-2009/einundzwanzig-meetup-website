# Webseite von GitHub herunterladen und lokal starten

Die ausführliche Browser-Anleitung befindet sich in [`lokal-starten.html`](lokal-starten.html).

## Warum ein Webserver nötig ist

Navigation und Footer werden aus `components/nav.html` und `components/footer.html` per JavaScript nachgeladen. Beim direkten Öffnen über `file://` blockieren Browser diese Zugriffe häufig. Starte die Seite deshalb über HTTP.

## Von GitHub herunterladen

### ZIP

1. Repository auf GitHub öffnen.
2. **Code** → **Download ZIP**.
3. ZIP vollständig entpacken.
4. Den Ordner öffnen, in dem `index.html` liegt.

### Git

```bash
git clone <HTTPS-ADRESSE-DES-REPOSITORYS>
cd <NAME-DES-REPOSITORYS>
```

## Windows – schneller lokaler Server

PowerShell im Ordner mit `index.html` öffnen:

```powershell
py -m http.server 8000 --bind 127.0.0.1
```

Dann im Browser öffnen:

```text
http://127.0.0.1:8000/
```

Falls `py` nicht funktioniert, `python` oder `python3` versuchen. Beenden mit `Strg+C`.

## Linux – schneller lokaler Server

```bash
cd /pfad/zum/projekt
python3 -m http.server 8000 --bind 127.0.0.1
```

Dann öffnen:

```text
http://127.0.0.1:8000/
```

Python installieren:

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install python3

# Fedora
sudo dnf install python3

# Arch Linux
sudo pacman -S python
```

## Im Heimnetz bereitstellen

Windows:

```powershell
py -m http.server 8000 --bind 0.0.0.0
```

Linux:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Anschließend von einem anderen Gerät `http://<IP-DES-SERVERS>:8000/` aufrufen. Der Python-Testserver hat keine Anmeldung und sollte nicht direkt ins Internet weitergeleitet werden.

## Aktualisieren

Bei einer Git-Installation:

```bash
git pull
```

Danach im Browser einen Hard Reload mit `Strg+F5` durchführen.

## Typische Fehler

- **Navigation/Footer fehlen:** nicht per `file://` öffnen, sondern den HTTP-Server verwenden.
- **Port belegt:** einen anderen Port verwenden, beispielsweise `8080`.
- **Live-Preis fehlt:** Preis manuell eintragen; der Rechner funktioniert weiterhin lokal.
- **Änderungen fehlen:** Browser-Cache mit `Strg+F5` neu laden.
