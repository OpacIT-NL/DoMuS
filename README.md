# DoMuS

Documentmanager en dossiersysteem dat rechtstreeks als Node.js-proces op je server draait. Nederlandstalige webinterface, een MySQL/MariaDB-datamodel en een Electron-client voor het openen van documenten op een SMB-share.

Dit is een eerste implementatie, nog geen productiegevalideerde release. De unit-tests, syntaxchecks en HTTP-smoketest zijn lokaal uitgevoerd. Database-integratie, echte SMTP/IMAP-servers en de desktop-installatiepakketten moeten nog in de doelomgeving worden getest. CI-configuratie is aanwezig voor MySQL 8.4 en MariaDB 11.4.

## Installeren en configureren via CLI

Benodigd: Node.js 22 of nieuwer en MySQL 8.4 of MariaDB 11.4. Maak een database met `utf8mb4` en een aparte databasegebruiker met rechten op die database. De CLI configureert de verbinding; hij maakt geen databaseserver of SQL-account aan.

```sh
npm ci
npm run cli
```

De console is overgenomen en aangepast uit Phidias (`Sentinel-Builder`). De prompts, modi, afkortingen en verborgen wachtwoordinvoer werken op dezelfde manier. De bronvermelding en meegeleverde licentie staan in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

```text
Console$> enable
Console#> conf t
Config#> host 127.0.0.1
Config#> port 3000
Config#> sql host 127.0.0.1
Config#> sql port 3306
Config#> sql username domus
Config#> sql database domus
Config#> sql password
Password (hidden):
Confirm password (hidden):
Config#> storage mode server
Config#> storage root ./data/documents
Config#> enable secret
Password (hidden):
Confirm password (hidden):
Config#> copy run start
Config#> end
Console#> db init
Console#> user create admin admin
Password (hidden):
Confirm password (hidden):
Console#> shutdown
```

Er is geen `.env` nodig. De CLI bewaart startup-config in `config.json` naast `package.json`. Dat bestand wordt niet ingecheckt. SQL- en mailwachtwoorden staan daarin omdat deze nodig zijn om te verbinden; het bestand wordt atomair geschreven met bestandsmodus `0600`. Het enable-wachtwoord wordt als Argon2id-hash opgeslagen. `show run` en `show start` verbergen alle wachtwoorden en de enable-hash. Gebruik `enable secret` om privileged mode met een wachtwoord te beveiligen; zonder ingestelde secret is de lokale console toegankelijk voor wie het serverproces kan bedienen.

`db init` installeert de tabellen en standaardinstellingen in de bestaande SQL-database met de SQL-instellingen uit running-config. Bestaande gegevens en aangepaste instellingen blijven behouden. Het commando maakt geen database of beheerder aan. Vanuit configuratiemodus kan dit ook met `do db init`.

Hetzelfde installatiepad is beschikbaar voor scripts en de productie-updateprocedure:

```sh
npm run migrate
```

De eerste beheerder kun je direct met `user create admin admin` aanmaken, zoals hierboven. Als alternatief blijft het beheerdersscript beschikbaar; het wachtwoord wordt via stdin gelezen en moet minimaal 12 tekens bevatten. Bijvoorbeeld in Bash:

```bash
read -rs -p 'Beheerderswachtwoord: ' DOMUS_ADMIN_PASSWORD
printf '%s' "$DOMUS_ADMIN_PASSWORD" | npm run admin -- admin
unset DOMUS_ADMIN_PASSWORD
npm start
```

Open standaard `http://127.0.0.1:3000`. Ook `npm start` biedt de Phidias-console aan via stdin, inclusief pipes van procesmanagers. `npm run cli` is een losse configuratieconsole waarvoor geen werkende databaseverbinding nodig is. `shutdown` sluit de betreffende console/server af; EOF sluit alleen de terminalinvoer, zodat een server zonder stdin blijft draaien.

**Running-config en startup-config:** wijzigingen blijven in de console totdat je `copy run start` uitvoert. Herstart de webserver om opgeslagen service-instellingen toe te passen. Er is geen automatische datamigratie bij het wijzigen van SQL of opslag. `enable secret` werkt in de huidige console onmiddellijk en na opslaan ook bij volgende starts. Een console met verouderde startup-config mag wijzigingen van een andere console niet overschrijven; open die console opnieuw.

Een ander configuratiebestand kan bij alle startcommando's:

```sh
npm run cli -- --config /pad/naar/config.json
npm run migrate -- --config /pad/naar/config.json
npm run admin -- admin --config /pad/naar/config.json
npm start -- --config /pad/naar/config.json
```

Relatieve opslagpaden zijn relatief aan de map van dat configuratiebestand. Geef alle processen hetzelfde bestand mee.

### CLI-commando's

In enabled mode: `db init` installeert de database-inhoud. Bij gewijzigde SQL-instellingen: `copy run start` en herstart de webserver om ook zijn verbinding te wijzigen.

| Modus          | Commando                                                    | Betekenis                                                              |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Disabled       | `enable` / `en`                                             | Naar privileged mode, zo nodig met enable-wachtwoord                   |
| Enabled        | `conf t` / `configure terminal`                             | Naar configuratiemodus                                                 |
| Enabled        | `show run` / `show running-config`                          | Huidige consoleconfiguratie, geheimen verborgen                        |
| Enabled        | `show start` / `show startup-config`                        | Opgeslagen configuratie, geheimen verborgen                            |
| Enabled        | `show status`                                               | Actieve listener, configuratiepad en wijzigingsstatus                  |
| Enabled/config | `copy run start`                                            | Bewaar running-config als startup-config                               |
| Config         | `host <IPv4/IPv6>` / `port <1-65535>`                       | Luisteradres en poort                                                  |
| Config         | `app-origin host <hostnaam/IP>`                             | Publieke browserhost; alias: `origin host`                             |
| Config         | `app-origin port <poort>`                                   | Publieke browserpoort                                                  |
| Config         | `app-origin protocol <http/https>`                          | Publiek protocol; geen TLS-listener op de Node-server                  |
| Config         | `no app-origin host` / `no app-origin port`                 | Weer afleiden van listenerinstellingen                                 |
| Config         | `sql host`, `sql port`, `sql username`, `sql database`      | SQL-verbinding, elk gevolgd door een waarde                            |
| Config         | `sql password`                                              | SQL-wachtwoord via verborgen prompt met bevestiging                    |
| Config         | `imap host`, `imap port`, `imap username`, `imap mailbox`   | IMAP-instellingen, elk gevolgd door een waarde                         |
| Config         | `imap secure <true/false>` / `imap password`                | Direct TLS en verborgen wachtwoordinvoer                               |
| Config         | `smtp host`, `smtp port`, `smtp username`, `smtp from`      | SMTP-instellingen, elk gevolgd door een waarde                         |
| Config         | `smtp secure <true/false>` / `smtp password`                | Direct TLS of verplichte STARTTLS; verborgen wachtwoordinvoer          |
| Config         | `no imap host` / `no smtp host`                             | Integratie uitschakelen                                                |
| Config         | `no imap password` / `no smtp password` / `no sql password` | Wachtwoord wissen                                                      |
| Config         | `no imap username` / `no smtp username`                     | Gebruikersnaam wissen, bijvoorbeeld voor een SMTP-relay zonder login   |
| Config         | `storage mode <server/smb>` / `storage root <pad>`          | Documentopslag                                                         |
| Config         | `auth secure-cookies <true/false>`                          | Secure-attribuut van sessiecookies                                     |
| Config         | `enable secret` / `no enable secret`                        | Enable-wachtwoord instellen/verwijderen                                |
| Config         | `do <commando>`                                             | Enabled-commando uitvoeren zonder de modus te verlaten                 |
| Config         | `exit` / `end`                                              | Terug naar enabled mode                                                |
| Enabled        | `disable` / `exit`                                          | Terug naar disabled mode                                               |
| Enabled        | `shutdown`                                                  | Console/server afsluiten; waarschuwing bij niet-opgeslagen wijzigingen |
| Alle           | `help` / `?`                                                | Beschikbare commando's                                                 |

Tekst met spaties kan tussen aanhalingstekens, bijvoorbeeld `storage root "/mnt/Document Share"`. Geef wachtwoorden niet als commandoargument mee; gebruik de verborgen prompt. De standalone CLI accepteert `exit` in disabled mode om de sessie af te sluiten; de serverconsole vereist privileged `shutdown` om de server te stoppen.

### Gebruikers aanmaken via CLI

```text
Console$> enable
Console#> user create alice
Password (hidden):
Confirm password (hidden):
Console#> user create beheerder admin
Password (hidden):
Confirm password (hidden):
```

`user create <naam>` maakt een gewone gebruiker; voeg `admin` toe voor een beheerder met volledige toegang. De Phidias-alias `username <naam> [admin]` werkt ook. Beide commando's zijn beschikbaar in enabled mode en na `conf t`; vanuit configuratiemodus werkt ook `do user create <naam> [admin]`.

Wachtwoorden worden verborgen ingevoerd, bevestigd en met Argon2id gehasht (12–1000 tekens). Accounts worden **direct** in de SQL-database uit running-config opgeslagen, niet pas bij `copy run start`. Bestaande gebruikers worden nooit overschreven of tot beheerder gepromoveerd door een create-commando. Voer bij een nieuwe installatie eerst `db init` uit. Gewone gebruikers krijgen daarna via **Beheer** hun rollen en rechten. De gebruiker is meteen bruikbaar; voor wijzigingen aan de SQL-verbindingsconfiguratie blijft opslaan en herstarten van de webserver nodig.

### Host, poort en browser-origin

De browser-origin wordt standaard afgeleid van `host` en `port`, met `http` als protocol. Een wildcard luisteradres (`0.0.0.0` of `::`) gebruikt `localhost` als afgeleide browserhost; stel voor andere toegang een concrete publieke host in. Origins worden genormaliseerd: HTTPS-poort 443 wordt bijvoorbeeld `https://dossiers.example.nl`, zonder `:443`.

Voor een HTTPS reverse proxy:

```text
enable
conf t
host 0.0.0.0
port 3000
app-origin host dossiers.example.nl
app-origin port 443
app-origin protocol https
auth secure-cookies true
copy run start
```

De Node-listener blijft HTTP. De reverse proxy verzorgt TLS en moet WebSockets doorlaten. De API vergelijkt de Origin-header met de ingestelde publieke origin; muterende requests vanuit scripts moeten deze header ook sturen.

### Mail instellen

```text
enable
conf t
imap host imap.example.nl
imap port 993
imap secure true
imap username dossiers@example.nl
imap password
imap mailbox INBOX
smtp host smtp.example.nl
smtp port 587
smtp secure false
smtp username dossiers@example.nl
smtp password
smtp from "DoMuS <dossiers@example.nl>"
copy run start
```

Bij beide `password`-commando's verschijnt een verborgen prompt met bevestiging. Herstart vervolgens DoMuS. `smtp secure false` betekent verplichte STARTTLS; `true` betekent direct TLS, meestal op poort 465. IMAP gebruikt standaard direct TLS op 993; zet `imap secure false` voor een server met STARTTLS op bijvoorbeeld poort 143.

## Draaien op je Node.js-server

Start DoMuS vanuit de projectmap met:

```sh
npm start
```

Of gebruik direct hetzelfde Node-entrypoint in je procesmanager:

```sh
node server/index.js
```

Stel de werkmap van het proces in op de DoMuS-projectmap. De servergebruiker moet de configuratie kunnen lezen en opslaan, en documenten kunnen schrijven in de ingestelde `storage root`. MySQL/MariaDB mag op dezelfde server of op een andere host staan; stel de verbinding in via `sql host`, `sql port` en de overige SQL-commando's.

De actieve serverconsole ondersteunt `enable` en `conf t`. Draait het proces op de achtergrond zonder interactieve invoer, gebruik dan `npm run cli` in de projectmap. Sla wijzigingen op met `copy run start` en herstart het serverproces via je procesmanager. Gebruik bij een afwijkend configuratiepad voor beide processen dezelfde `--config`-optie.

Maak samenhangende back-ups van database, configuratie en documenten. Het schemascript is herhaalbaar voor de initiële installatie; het is nog geen versiegebaseerd migratiesysteem voor toekomstige schemawijzigingen.

## Functionele inrichting

1. Maak klanten aan in **CRM**.
2. Maak dossiers aan en selecteer een klant. Een leeg dossiernummer gebruikt de automatische reeks; een eigen nummer krijgt het hoofdsuffix `.00`.
3. Voeg vanuit een hoofddossier subdossiers toe. Deze krijgen `.01` t/m `.99`, horen bij dezelfde klant en kunnen zelf geen subdossiers bevatten.
4. Maak mappen aan en upload documenten met één of meer categorieën.
5. Voeg via **+ Versie** een nieuwe versie van hetzelfde document toe.
6. Definieer in **Beheer** gebruikers, rollen, toegangsregels, metadata en e-mailtemplates.
7. Kies de standaardweergave globaal in **Beheer** of persoonlijk in **Voorkeuren**.

### Nummering

Standaard: `YYYYMM` + vier volgcijfers + `.00`, bijvoorbeeld `2026110001.00`. Het aantal volgcijfers is instelbaar op vier of vijf. De maand wordt bepaald in UTC. De reeks begint iedere maand opnieuw. SQL-transacties en rijlocks voorkomen dubbele nummers bij gelijktijdige aanvragen; de unieke database-index is de laatste controle. Handmatig bezette nummers worden overgeslagen. Een uitgeputte maandreeks levert een fout op.

Het hernummeren van een hoofddossier hernummert zijn subdossiers atomair. Opslagpaden gebruiken interne IDs en blijven daardoor geldig. Vrije nummerbasissen ondersteunen letters, cijfers, `_` en `-`; punten zijn gereserveerd voor het subdossiersuffix.

### Documenten

- **Document Manager:** één regel per logisch document, met de nieuwste versie; categorieën zoeken door alle dossiermappen heen.
- **Document Verkenner:** iedere versie staat apart, te filteren op het volledige logische mappad.
- Een upload maakt een nieuw fysiek bestand, bijvoorbeeld `42/Correspondentie/17/brief.v2.pdf`. `42` is het dossier-ID en `17` het document-ID, zodat gelijknamige documenten niet botsen.
- SHA-256, bestandsgrootte, uploader en aanmaakdatum worden per versie opgeslagen.
- Uploadlimiet: 25 MiB per bestand. Categorieën worden bij de eerste upload ingesteld; categorieën wijzigen en documenten verplaatsen zijn nog niet beschikbaar.

### ACL

Rechten lopen via rollen. Er zijn afzonderlijke acties voor CRM lezen/schrijven, dossiers lezen/schrijven, documenten lezen/schrijven/lokaal openen, e-mail lezen/importeren/versturen en metadata schrijven. Regels zijn globaal of dossiergebonden. Regels op het hoofddossier gelden voor zijn subdossiers. **Deny gaat altijd vóór allow**; zonder allow is toegang geweigerd. Beheerders hebben volledige toegang.

Voor een gebruiker met dossiergebonden documentrechten is ook `case.read` nodig om het dossier te vinden. CRM-rechten gelden voor alle klanten, niet per klant. `case.write` als globale regel maakt nieuwe hoofddossiers mogelijk. Rechten worden bij iedere API-aanvraag opnieuw bepaald. De Electron-client ontvangt uitsluitend openverzoeken na controle van zowel `document.open` als `document.read` en een nog geldige serversessie.

Wachtwoorden worden met Argon2id gehasht. Sessies gebruiken willekeurige tokens met uitsluitend hun SHA-256-hash in de database, HttpOnly/SameSite-cookies en een levensduur van acht uur. Er is een activiteitenlog voor de belangrijkste dossier-, document-, mail- en ACL-acties; dit is nog geen volledige compliance-audittrail.

### Metadata

Globale velddefinities ondersteunen tekst, getallen, datums en booleans. Verplichte velden worden bij het opslaan van metadata gecontroleerd; een nieuw dossier kan aanvankelijk nog lege metadata bevatten. Velddefinities kunnen momenteel worden toegevoegd, niet gewijzigd of verwijderd.

### E-mail

Stel SMTP en/of IMAP in via `enable` → `conf t` (zie hierboven). EML en MSG worden geïmporteerd als leesbare tekst, met behoud van het oorspronkelijke bestand inclusief bijlagen. Bijlagen zijn via het origineel beschikbaar, niet automatisch als aparte documenten. HTML wordt niet in de interface uitgevoerd.

De handmatige IMAP-import haalt maximaal de laatste 100 berichten uit de ingestelde mailbox naar het gekozen dossier. Er is geen periodieke synchronisatie. Berichten worden niet verwijderd of bewust als gelezen gemarkeerd. Duplicaten binnen hetzelfde dossier worden op bronhash overgeslagen. IMAP gebruikt standaard direct TLS en kan worden ingesteld op STARTTLS; SMTP gebruikt direct TLS of verplichte STARTTLS. OAuth2 en instellingen per gebruiker zijn nog niet ingebouwd.

Templates ondersteunen `{{client}}`, `{{number}}` en `{{title}}` in onderwerp en platte berichttekst. De verzendactie verstuurt direct; controleer ontvanger en template vóór het klikken op **Versturen**. Bij een verbindingsfout kan SMTP-acceptatie onzeker zijn: controleer de mailserver voordat je opnieuw verstuurt. Er is nog geen outbox-worker of automatisch retrymechanisme.

## SMB en Electron

Mount dezelfde share op de server en op de client. Op Windows kan de client een UNC-pad kiezen, bijvoorbeeld `\\fileserver\dossiers`. Op Linux moet de share als lokaal toegankelijk bestandssysteem zijn aangekoppeld, bijvoorbeeld `/mnt/dossiers`.

Op de server:

```text
enable
conf t
storage mode smb
storage root /mnt/dossiers
copy run start
```

Herstart DoMuS na het opslaan.

Zorg dat de gebruiker waaronder het Node.js-proces draait toegang heeft tot het ingestelde sharepad. De server heeft schrijftoegang nodig voor nieuwe uploads. Geef desktopgebruikers bij voorkeur alleen leestoegang tot versiebestanden. De applicatie opent het bestaande bestand: rechtstreeks opslaan vanuit Word/LibreOffice op een schrijfbare share verandert dat bestand en omzeilt versiebeheer. Gebruik **Opslaan als** en upload daarna als nieuwe versie; automatisch check-in/check-out is nog niet aanwezig. Share-ACL's moeten aansluiten op de applicatierechten: de web-ACL kan rechtstreeks browsen op een te ruim toegankelijke share niet beperken.

Client starten:

```sh
cd desktop
npm ci
npm start
```

Kies de lokale share-root, maak via **Voorkeuren → Ticket maken** een eenmalig ticket en verbind binnen één minuut. De client houdt geen wachtwoord of ticket op schijf bij. Per gebruiker is één verbonden client mogelijk. Na verbreken of opnieuw starten moet de gebruiker opnieuw koppelen.

De client controleert het pad inclusief symlinks, accepteert uitsluitend gangbare documentextensies en vraagt bevestiging vóór openen. HTTPS/WSS is vereist behalve op localhost. De applicatie opent bestanden met de standaardtoepassing van Windows of Linux.

### Installatiepakketten

```sh
cd desktop
npm ci
npm run build:linux     # .deb en .flatpak, op een Linux-buildmachine
npm run build:windows   # NSIS installer, op een Windows-buildmachine
```

Artifacts verschijnen in `desktop/dist/`. Pas de maintainergegevens in `desktop/package.json` aan vóór distributie. Code signing is nog niet ingesteld. De workflow `desktop.yml` kan deze builds handmatig uitvoeren; er zijn tijdens deze implementatie nog geen installatiepakketten gebouwd.

Flatpak vereist `flatpak` en `flatpak-builder` op de buildmachine. De sandbox krijgt standaard geen toegang tot alle bestanden. Geef de geïnstalleerde app gericht toegang tot de share, bijvoorbeeld:

```sh
flatpak override --user --filesystem=/mnt/dossiers:ro nl.domus.desktop
```

Controleer de SMB-mount en het openen via de standaardtoepassing op de gebruikte Linux-desktop; dit is hier niet praktisch getest. Zie de [electron-builder Flatpak-documentatie](https://www.electron.build/docs/flatpak/) en [Linux-targets](https://www.electron.build/v26/docs/linux/).

## Tests

```sh
npm run check
npm test
# Alleen tegen een afzonderlijke testdatabase: de integratietest maakt records aan.
TEST_DATABASE_URL=mysql://user:password@localhost:3306/domus_test npm test
```

De integratietest controleert onder andere gelijktijdige dossiernummering en documentuploads, hoofd-/subdossierhernummering, ACL-overerving en weigering, EML-import en uitloggen. GitHub Actions configureert beide database-engines. Zonder `TEST_DATABASE_URL` wordt die test expliciet overgeslagen.

De testset bevat unit-tests voor nummering, ACL, veilige bestandspaden en de CLI: modi, validatie, persistente configuratie, geheimafscherming, enable-authenticatie, piped input en afgeleide origins. Een HTTP-smoketest controleert tevens dat de server de opgeslagen listener en origin gebruikt. De database-integratietest vereist een beschikbare testdatabase. De backend-dependencyaudit meldt nul bekende kwetsbaarheden op het moment van installatie. Nog niet geverifieerd: database-integratietest, browserinteracties, SMTP/IMAP met echte accounts en Electron/SMB op Windows en Linux.

## Technische bronnen

- [Nodemailer SMTP](https://nodemailer.com/smtp), [MailParser](https://nodemailer.com/extras/mailparser) en [ImapFlow](https://imapflow.com/docs/api/imapflow-client/).
- [MSG-reader API](https://hiraokahypertools.github.io/msgreader/typedoc/classes/MsgReader.default.html).
- [Zod 4-migratie](https://zod.dev/v4/changelog).

## GitHub Releases

De workflow `.github/workflows/release.yml` bouwt op native Windows- en Linux-runners en publiceert alle downloads samen, nadat de tests en builds slagen. Trigger met een nieuwe versietag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Of kies **Actions → Release → Run workflow** en geef een bestaande tag op. De versie uit de tag wordt gebruikt in de servermanifesten en de desktopbuilds. Een tag zoals `v0.2.0-beta.1` maakt een prerelease. Een reeds gepubliceerde release wordt niet overschreven; een onafgemaakte draft kan opnieuw worden uitgevoerd.

Downloads:

- Windows x64: NSIS-installer (`.exe`).
- Linux x64: `.deb` en `.flatpak`.
- Server: `domus-server-<versie>.zip`, met `package.json`, `server/`, `public/` en `scripts/` direct op het hoogste niveau, zonder omhullende map.
- `SHA256SUMS.txt` met checksums van de vier pakketten.

De server-zip bevat geen lokale configuratie, documenten, `node_modules` of builddependencies. Pak hem uit in je applicatiemap, voer `npm ci --omit=dev` uit en volg `SERVER-INSTALL.md`. De workflow controleert ook of de uitgepakte serverdependencies installeren en de CLI start. Windows code signing is nog niet ingesteld.

Lokaal alleen het serverpakket maken:

```sh
npm ci
npm run package:server
# Of met een expliciete releaseversie:
npm run package:server -- --version 0.2.0 --output dist
```

Dit schrijft een zip naar `dist/`. Het pakket gebruikt dezelfde Node.js-code op Windows en Linux; native dependencies worden op de doelserver geïnstalleerd.
