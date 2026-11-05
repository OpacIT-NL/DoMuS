// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Phidias lib/config.js; see THIRD_PARTY_NOTICES.md.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const DEFAULT_FILE = fileURLToPath(new URL("../config.json", import.meta.url));
export function configArguments(args = process.argv.slice(2)) {
  let file = DEFAULT_FILE,
    found = false;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config") {
      if (found || !args[i + 1] || args[i + 1].startsWith("--"))
        throw Error("Gebruik --config <bestand> eenmaal.");
      file = path.resolve(args[++i]);
      found = true;
    } else rest.push(args[i]);
  }
  return { file, rest };
}
export function defaultConfig() {
  return {
    host: "127.0.0.1",
    port: 3000,
    origin: { host: null, port: null, protocol: "http" },
    sql: {
      host: "127.0.0.1",
      port: 3306,
      username: "domus",
      password: "",
      database: "domus",
    },
    imap: {
      host: "",
      port: 993,
      username: "",
      password: "",
      mailbox: "INBOX",
      secure: true,
    },
    smtp: {
      host: "",
      port: 587,
      username: "",
      password: "",
      from: "",
      secure: false,
    },
    storage: { mode: "server", root: "./data/documents" },
    auth: { secureCookies: false },
    console: { enablePasswordHash: null },
  };
}
function check(condition, message) {
  if (!condition) throw Error("Configuratie: " + message);
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function validHost(host) {
  return (
    typeof host === "string" &&
    (net.isIP(host) ||
      /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
  );
}
export function normalizeConfig(value) {
  check(object(value), "verwacht een object");
  const defaults = defaultConfig(),
    config = { ...defaults, ...structuredClone(value) };
  for (const key of Object.keys(config))
    check(Object.hasOwn(defaults, key), `onbekende instelling ${key}`);
  for (const key of [
    "origin",
    "sql",
    "imap",
    "smtp",
    "storage",
    "auth",
    "console",
  ]) {
    check(object(config[key]), `${key} moet een object zijn`);
    for (const name of Object.keys(config[key]))
      check(
        Object.hasOwn(defaults[key], name),
        `onbekende instelling ${key}.${name}`,
      );
    config[key] = { ...defaults[key], ...config[key] };
  }
  const port = (v, key) =>
    check(
      Number.isInteger(v) && v >= 1 && v <= 65535,
      `${key}: verwacht een poort van 1 t/m 65535`,
    );
  const text = (v, key, empty = false) =>
    check(
      typeof v === "string" && !v.includes("\0") && (empty || !!v.trim()),
      `${key}: ongeldige of lege tekst`,
    );
  check(
    typeof config.host === "string" && net.isIP(config.host),
    "host moet een IPv4- of IPv6-adres zijn",
  );
  port(config.port, "port");
  check(
    ["http", "https"].includes(config.origin.protocol),
    "app-origin protocol moet http of https zijn",
  );
  check(
    config.origin.host === null ||
      (validHost(config.origin.host) &&
        !["0.0.0.0", "::"].includes(config.origin.host)),
    "app-origin host moet een concrete hostnaam of IP-adres zijn",
  );
  if (config.origin.port !== null) port(config.origin.port, "app-origin port");
  for (const service of ["sql", "smtp", "imap"]) {
    const c = config[service];
    check(
      (service !== "sql" && c.host === "") || validHost(c.host),
      `${service} host is ongeldig`,
    );
    port(c.port, `${service} port`);
    text(c.username, `${service} username`, service !== "sql");
    text(c.password, `${service} password`, true);
  }
  text(config.sql.database, "sql database");
  text(config.imap.mailbox, "imap mailbox");
  text(config.smtp.from, "smtp from", true);
  check(
    !/[\r\n]/.test(config.smtp.from),
    "smtp from mag geen regeleinde bevatten",
  );
  for (const [key, v] of [
    ["imap secure", config.imap.secure],
    ["smtp secure", config.smtp.secure],
    ["auth secure-cookies", config.auth.secureCookies],
  ])
    check(typeof v === "boolean", `${key} moet true of false zijn`);
  check(
    ["server", "smb"].includes(config.storage.mode),
    "storage mode moet server of smb zijn",
  );
  text(config.storage.root, "storage root");
  const hash = config.console.enablePasswordHash;
  check(
    hash === null ||
      (typeof hash === "string" && /^\$argon2id\$v=19\$/.test(hash)),
    "ongeldige enable secret hash",
  );
  return config;
}
export function ensureConfig(file) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      temporary,
      JSON.stringify(defaultConfig(), null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    try {
      fs.linkSync(temporary, file);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export function loadConfig(
  file = configArguments().file,
  { create = false } = {},
) {
  if (create) ensureConfig(file);
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    if (e.code === "ENOENT")
      throw Error(
        "Geen configuratie. Start npm run cli en sla op met copy run start.",
      );
    if (e instanceof SyntaxError)
      throw Error("Ongeldig configuratiebestand: verwacht geldige JSON.");
    throw e;
  }
}
function atomicWrite(file, contents) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export class ConfigState {
  constructor(file = configArguments().file) {
    this.file = path.resolve(file);
    this.running = loadConfig(this.file, { create: true });
    this.saved = structuredClone(this.running);
  }
  async set(keys, value) {
    const next = structuredClone(this.running);
    keys.slice(0, -1).reduce((o, k) => o[k], next)[keys.at(-1)] = value;
    this.running = normalizeConfig(next);
  }
  dirty() {
    return JSON.stringify(this.running) !== JSON.stringify(this.saved);
  }
  startup() {
    return loadConfig(this.file);
  }
  async save() {
    // Serialize writers and reject stale consoles instead of silently losing updates.
    const lock = this.file + ".lock";
    let fd;
    try {
      try {
        fd = fs.openSync(lock, "wx", 0o600);
      } catch (e) {
        if (e.code === "EEXIST")
          throw Error("Configuratie wordt al opgeslagen; probeer opnieuw.");
        throw e;
      }
      if (JSON.stringify(this.startup()) !== JSON.stringify(this.saved))
        throw Error(
          "Startup-config is door een andere console gewijzigd. Heropen deze console voordat je opslaat.",
        );
      const checked = normalizeConfig(this.running);
      atomicWrite(this.file, JSON.stringify(checked, null, 2) + "\n");
      this.saved = structuredClone(checked);
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
        fs.rmSync(lock, { force: true });
      }
    }
  }
}
export function appOrigin(config) {
  const host =
    config.origin.host ??
    (["0.0.0.0", "::"].includes(config.host) ? "localhost" : config.host);
  return new URL(
    `${config.origin.protocol}://${host.includes(":") ? "[" + host + "]" : host}:${config.origin.port ?? config.port}`,
  ).origin;
}
export function runtimeConfig(file = configArguments().file) {
  const config = loadConfig(file, { create: true });
  return {
    ...config,
    storage: {
      ...config.storage,
      root: path.resolve(path.dirname(file), config.storage.root),
    },
    appOrigin: appOrigin(config),
  };
}
