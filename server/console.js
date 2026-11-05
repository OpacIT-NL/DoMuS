// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Phidias lib/console.js; see THIRD_PARTY_NOTICES.md.
import argon2 from "argon2";
import { createUser, validateUsername } from "./user-create.js";
import { initializeDatabase } from "./database-init.js";
import { readFileSync } from "node:fs";
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const PASSWORD_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};
export const PROMPTS = {
  disabled: "Console$> ",
  enabled: "Console#> ",
  config: "Config#> ",
};
const SAVE_COMMANDS = new Set([
  "copy run start",
  "copy running-config startup-config",
  "copy running-config start",
  "copy run startup-config",
]);
export function words(line) {
  const result = [],
    pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+))/gy;
  let position = 0,
    match;
  while (position < line.trimEnd().length) {
    pattern.lastIndex = position;
    match = pattern.exec(line);
    if (!match) throw Error("Ongesloten aanhalingsteken of ongeldige syntax.");
    result.push(
      match[1] !== undefined
        ? JSON.parse(`"${match[1]}"`)
        : (match[2] ?? match[3]),
    );
    position = pattern.lastIndex;
  }
  return result;
}
export function displayConfig(document) {
  const copy = structuredClone(document);
  for (const service of ["sql", "imap", "smtp"])
    if (copy[service].password) copy[service].password = "[configured; hidden]";
  if (copy.console.enablePasswordHash)
    copy.console.enablePasswordHash = "[configured; hidden]";
  return JSON.stringify(copy, null, 2);
}
export class CommandConsole {
  constructor({
    config,
    initDatabase = initializeDatabase,
    addUser = createUser,
    ask,
    write,
    shutdown = async () => {},
    closeSession = null,
    status = () => "",
  }) {
    Object.assign(this, {
      config,
      initDatabase,
      addUser,
      ask,
      write,
      shutdown,
      closeSession,
      status,
    });
    this.mode = "disabled";
    this.stopped = false;
    this.failedEnables = 0;
    this.enableBlockedUntil = 0;
  }
  get prompt() {
    return PROMPTS[this.mode];
  }
  get dirty() {
    return this.config.dirty();
  }
  cancel() {
    if (this.mode === "config") this.mode = "enabled";
  }
  async password() {
    const password = await this.ask("Password (hidden): ", true);
    if (password !== (await this.ask("Confirm password (hidden): ", true)))
      throw Error("Wachtwoorden komen niet overeen.");
    return password;
  }
  help(mode = this.mode) {
    if (mode === "disabled")
      return this.write(
        "enable (en) | show version | help (?)" +
          (this.closeSession ? " | exit" : ""),
      );
    if (mode === "enabled")
      return this.write(
        "configure terminal (conf t) | show running-config (show run)\nshow startup-config (show start) | show status | show version\ndb init (installeer tabellen en standaardinstellingen)\nuser create <name> [admin] | username <name> [admin]\ncopy running-config startup-config (copy run start)\ndisable (dis) | exit | shutdown | help (?)",
      );
    this.write(`host <IPv4/IPv6> | port <1-65535>
app-origin host <hostname/IP> | app-origin port <1-65535> | app-origin protocol <http|https>
no app-origin host | no app-origin port (afleiden van host/port)
sql host <host> | sql port <port> | sql username <name> | sql database <name> | sql password
imap host <host> | imap port <port> | imap username <name> | imap password
imap mailbox <name> | imap secure <true|false>
smtp host <host> | smtp port <port> | smtp username <name> | smtp password
smtp from <address> | smtp secure <true|false>
no imap host | no smtp host | no imap password | no smtp password | no sql password
no smtp username | no imap username
storage mode <server|smb> | storage root <path>
auth secure-cookies <true|false>
user create <name> [admin] | username <name> [admin] (direct opslaan in SQL)
enable secret (enable password) | no enable secret
copy running-config startup-config (copy run start)
exit (end) | disable (dis) | do <enabled command> | help (?)
Wachtwoorden worden uitsluitend via een verborgen prompt ingevoerd.
Servicewijzigingen gelden na opslaan en herstart; data wordt niet verplaatst.`);
  }
  async execute(line) {
    try {
      const args = words(line.trim());
      if (!args.length) return;
      const lower = args.map((v) => v.toLowerCase()),
        command = lower.join(" ");
      if (["?", "help"].includes(command)) return this.help();
      if (this.mode === "disabled") {
        if (command === "exit" && this.closeSession)
          return await this.stop(true);
        if (command === "show version") return this.write(`DoMuS v${version}`);
        if (!["enable", "en"].includes(command))
          throw Error("Onvoldoende rechten. Gebruik eerst enable.");
        if (Date.now() < this.enableBlockedUntil)
          throw Error(
            "Enable is tijdelijk geblokkeerd. Probeer na 30 seconden opnieuw.",
          );
        const hash = this.config.running.console.enablePasswordHash;
        if (
          hash &&
          !(await argon2.verify(
            hash,
            await this.ask("Enable password (hidden): ", true),
          ))
        ) {
          if (++this.failedEnables >= 3) {
            this.enableBlockedUntil = Date.now() + 30000;
            this.failedEnables = 0;
          }
          throw Error("Ongeldig enable-wachtwoord.");
        }
        this.failedEnables = 0;
        this.mode = "enabled";
        return this.write("Privileged mode enabled.");
      }
      if (this.mode === "config") {
        if (lower[0] === "do") return await this.enabled(args.slice(1));
        if (SAVE_COMMANDS.has(command)) return await this.enabled(args);
        if (["exit", "end"].includes(command)) {
          this.mode = "enabled";
          return;
        }
        if (["disable", "dis"].includes(command)) {
          this.mode = "disabled";
          return;
        }
        return await this.configure(args);
      }
      await this.enabled(args);
    } catch (e) {
      this.write("% " + e.message);
    }
  }
  async stop(closeOnly = false) {
    if (
      this.dirty &&
      (
        await this.ask(
          "Niet-opgeslagen wijzigingen gaan verloren. Afsluiten? Typ yes: ",
        )
      )
        .trim()
        .toLowerCase() !== "yes"
    )
      return;
    this.stopped = true;
    await (closeOnly ? this.closeSession() : this.shutdown());
  }
  async createAccount(args) {
    const lower = args.map((value) => value.toLowerCase());
    const offset = lower[0] === "username" ? 1 : 2;
    if (
      (offset === 2 && lower[1] !== "create") ||
      ![offset + 1, offset + 2].includes(args.length) ||
      (args.length === offset + 2 && lower.at(-1) !== "admin")
    )
      throw Error(
        "Gebruik: user create <name> [admin] of username <name> [admin]. Wachtwoord via verborgen prompt.",
      );
    const username = validateUsername(args[offset]),
      admin = args.length === offset + 2;
    const sql = structuredClone(this.config.running.sql);
    this.write(
      `Account aanmaken in ${sql.host}:${sql.port}/${sql.database} (running-config).`,
    );
    const password = await this.password();
    if (password.length < 12 || password.length > 1000)
      throw Error("Wachtwoord moet 12–1000 tekens bevatten.");
    await this.addUser(sql, { username, password, admin });
    this.write(
      `${admin ? "Beheerder" : "Gebruiker"} ${username} aangemaakt en direct opgeslagen in de database.`,
    );
    if (!admin)
      this.write(
        "Ken rollen en rechten toe via Beheer voordat deze gebruiker dossiers kan openen.",
      );
    if (this.dirty)
      this.write(
        "SQL-configuratie wordt niet automatisch opgeslagen. Gebruik copy run start om configuratiewijzigingen te bewaren.",
      );
  }
  async enabled(args) {
    const command = args.map((v) => v.toLowerCase()).join(" ");
    if (["?", "help"].includes(command)) return this.help("enabled");
    if (
      [
        "configure terminal",
        "config terminal",
        "conf terminal",
        "configure t",
        "config t",
        "conf t",
      ].includes(command)
    ) {
      this.mode = "config";
      return this.write(
        "Enter configuration commands. Use exit to return to enabled mode.",
      );
    }
    if (["disable", "dis", "exit"].includes(command)) {
      this.mode = "disabled";
      return;
    }
    if (["show running-config", "show run"].includes(command)) {
      this.write(displayConfig(this.config.running));
      return this.write(
        this.dirty
          ? "Niet-opgeslagen wijzigingen."
          : "Running-config is opgeslagen.",
      );
    }
    if (["show startup-config", "show start"].includes(command))
      return this.write(displayConfig(this.config.startup()));
    if (command === "show status")
      return this.write(
        `${this.status()}\nConfig: ${this.config.file}\nNiet opgeslagen: ${this.dirty ? "ja" : "nee"}. Servicewijzigingen worden actief na herstart.`,
      );
    if (command === "show version") return this.write(`DoMuS v${version}`);
    if (["user", "username"].includes(args[0]?.toLowerCase()))
      return await this.createAccount(args);
    if (command === "db init") {
      const sql = structuredClone(this.config.running.sql);
      this.write(
        `Database initialiseren: ${sql.host}:${sql.port}/${sql.database} (running-config).`,
      );
      await this.initDatabase(sql);
      this.write(
        "Database-inhoud geïnstalleerd. Bestaande gegevens en instellingen zijn behouden.",
      );
      if (this.dirty)
        this.write(
          "Let op: configuratiewijzigingen zijn nog niet opgeslagen. Gebruik copy run start.",
        );
      return;
    }
    if (SAVE_COMMANDS.has(command)) {
      await this.config.save();
      return this.write(
        "Startup-config opgeslagen. Herstart DoMuS om servicewijzigingen toe te passen.",
      );
    }
    if (["shutdown", "exit server"].includes(command)) return await this.stop();
    throw Error("Onbekend commando. Gebruik help.");
  }
  async configure(args) {
    if (["user", "username"].includes(args[0]?.toLowerCase()))
      return await this.createAccount(args);
    const lower = args.map((v) => v.toLowerCase()),
      command = lower.join(" ");
    if (["enable secret", "enable password"].includes(command)) {
      const password = await this.password();
      if (password.length < 12)
        throw Error("Gebruik minstens 12 tekens voor enable secret.");
      await this.config.set(
        ["console", "enablePasswordHash"],
        await argon2.hash(password, PASSWORD_OPTIONS),
      );
      return this.write("Enable secret gewijzigd in running-config.");
    }
    if (["no enable secret", "no enable password"].includes(command)) {
      await this.config.set(["console", "enablePasswordHash"], null);
      return;
    }
    if (
      args.length === 2 &&
      ["sql", "imap", "smtp"].includes(lower[0]) &&
      lower[1] === "password"
    ) {
      await this.config.set([lower[0], "password"], await this.password());
      return this.write("Wachtwoord gewijzigd in running-config.");
    }
    if (args.length === 3 && lower[0] === "no") {
      if (
        ["app-origin", "origin"].includes(lower[1]) &&
        ["host", "port"].includes(lower[2])
      )
        return await this.config.set(["origin", lower[2]], null);
      if (
        ["sql", "imap", "smtp"].includes(lower[1]) &&
        (lower[2] === "password" ||
          (lower[1] !== "sql" && ["host", "username"].includes(lower[2])))
      )
        return await this.config.set([lower[1], lower[2]], "");
    }
    let keys,
      value,
      type = "string";
    if (args.length === 2 && ["host", "port"].includes(lower[0])) {
      keys = [lower[0]];
      value = args[1];
      if (lower[0] === "port") type = "number";
    }
    if (args.length === 3) {
      const group = ["app-origin", "origin"].includes(lower[0])
        ? "origin"
        : lower[0];
      const key = lower[1] === "user" ? "username" : lower[1];
      const options = {
        origin: ["host", "port", "protocol"],
        sql: ["host", "port", "username", "database"],
        imap: ["host", "port", "username", "mailbox", "secure"],
        smtp: ["host", "port", "username", "from", "secure"],
        storage: ["mode", "root"],
        auth: ["secure-cookies"],
      };
      if (options[group]?.includes(key)) {
        keys = [group, key === "secure-cookies" ? "secureCookies" : key];
        value = args[2];
        if (key === "port") type = "number";
        if (["secure", "secure-cookies"].includes(key)) type = "boolean";
      }
    }
    if (!keys)
      throw Error(
        "Onbekende instelling of argumenten. Gebruik help. Voer wachtwoorden in via de verborgen prompt.",
      );
    if (type === "number") {
      if (!/^\d+$/.test(value)) throw Error("Verwacht een gehele poort.");
      value = Number(value);
    }
    if (type === "boolean") {
      if (!["true", "false"].includes(value.toLowerCase()))
        throw Error("Verwacht true of false.");
      value = value.toLowerCase() === "true";
    }
    await this.config.set(keys, value);
    this.write(
      "Running-config gewijzigd; opslaan met copy run start, daarna DoMuS herstarten.",
    );
  }
}
