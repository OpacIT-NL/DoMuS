# DoMuS-server installeren

Pak de server-zip rechtstreeks uit in de gewenste applicatiemap. `package.json`, `server/`, `public/` en `scripts/` staan direct op dat niveau.

Vereist: Node.js 22 of nieuwer en een beschikbare MySQL/MariaDB-database met een eigen gebruiker. Voer vanuit de uitgepakte map uit:

```sh
npm ci --omit=dev
npm run cli
```

Configureer via `enable` → `conf t` de SQL-verbinding, host/poort, opslag en eventueel mail. `sql password` vraagt het wachtwoord verborgen op. Bewaar met `copy run start` en keer terug met `end`. Voer in enabled mode `db init` uit om de tabellen en standaardinstellingen te installeren. Maak daarna de eerste beheerder met `user create admin admin`; voer het wachtwoord tweemaal in op de verborgen prompts. Sluit daarna af met `shutdown`.

Als alternatief voor `db init` kun je dezelfde installatie uitvoeren met:

```sh
npm run migrate
```

Als alternatief voor het CLI-commando kun je de eerste beheerder via stdin aanmaken. Doe dit alleen als je hem nog niet hebt aangemaakt. Voorbeeld in Bash:

```bash
read -rs -p 'Beheerderswachtwoord: ' DOMUS_ADMIN_PASSWORD
printf '%s' "$DOMUS_ADMIN_PASSWORD" | npm run admin -- admin
unset DOMUS_ADMIN_PASSWORD
npm start
```

De server draait ook direct met `node server/index.js`. Gebruik de applicatiemap als werkmap. Zie `README.md` voor de volledige CLI-commando's en instellingen.

Het pakket bevat geen bestaande configuratie, documenten of dependencies. `npm ci` installeert de dependencies voor het besturingssysteem van jouw server. De desktopclient is een afzonderlijke release-download; de scripts voor tests en het bouwen van releases staan alleen in de bronrepository.

Bij een upgrade: stop DoMuS, maak een back-up van database/configuratie/documenten, pak de nieuwe release uit, voer `npm ci --omit=dev` uit en volg eventuele migratie-instructies uit de release notes. Je bestaande `config.json` en `data/` worden niet als bestanden in de release meegeleverd.
