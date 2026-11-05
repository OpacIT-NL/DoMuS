import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ConfigState,
  defaultConfig,
  appOrigin,
  normalizeConfig,
  runtimeConfig,
  configArguments,
} from "../server/config.js";
import { CommandConsole, words } from "../server/console.js";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domus-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "config.json");
}
function consoleFor(file, answers = []) {
  const output = [],
    prompts = [],
    config = new ConfigState(file);
  const engine = new CommandConsole({
    config,
    write: (s) => output.push(s),
    ask: async (prompt, secret) => {
      prompts.push({ prompt, secret });
      if (!answers.length) throw Error("No input");
      return answers.shift();
    },
  });
  return { engine, config, output, prompts };
}
test("Phidias modes enforce privileges, persist explicitly and redact all secrets", async (t) => {
  const file = fixture(t),
    { engine, config, output, prompts } = consoleFor(file, [
      "db-secret",
      "db-secret",
      "imap-secret",
      "imap-secret",
      "smtp-secret",
      "smtp-secret",
    ]);
  await engine.execute("conf t");
  assert.equal(engine.mode, "disabled");
  await engine.execute("enable");
  await engine.execute("conf t");
  assert.equal(engine.prompt, "Config#> ");
  for (const cmd of [
    "host 0.0.0.0",
    "port 8080",
    "app-origin host dossiers.example.nl",
    "app-origin port 443",
    "app-origin protocol https",
    "sql host db",
    "sql port 3307",
    "sql username domus-prod",
    "sql database dossiers",
    "sql password",
    "imap host imap.example.nl",
    "imap username mail",
    "imap password",
    'imap mailbox "Dossiers 2026"',
    "smtp host smtp.example.nl",
    "smtp port 465",
    "smtp secure true",
    "smtp password",
    'smtp from "DoMuS <mail@example.nl>"',
    "storage mode smb",
    'storage root "/mnt/company dossiers"',
    "auth secure-cookies true",
  ])
    await engine.execute(cmd);
  assert.equal(config.running.sql.password, "db-secret");
  assert.equal(config.running.imap.mailbox, "Dossiers 2026");
  assert.equal(config.running.storage.root, "/mnt/company dossiers");
  assert.equal(config.running.smtp.secure, true);
  assert.equal(appOrigin(config.running), "https://dossiers.example.nl");
  assert.ok(prompts.every((p) => p.secret));
  assert.equal(config.startup().port, 3000);
  assert.equal(config.dirty(), true);
  await engine.execute("do show run");
  await engine.execute("copy run start");
  await engine.execute("do show start");
  assert.equal(config.dirty(), false);
  assert.equal(new ConfigState(file).running.sql.port, 3307);
  for (const secret of ["db-secret", "imap-secret", "smtp-secret"])
    assert.equal(output.join("\n").includes(secret), false);
  if (process.platform !== "win32")
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await engine.execute("end");
  assert.equal(engine.mode, "enabled");
  await engine.execute("disable");
  assert.equal(engine.mode, "disabled");
});
test("invalid input leaves running config unchanged; secret arguments are rejected", async (t) => {
  const { engine, config } = consoleFor(fixture(t));
  await engine.execute("en");
  await engine.execute("conf t");
  const before = structuredClone(config.running);
  for (const cmd of [
    "port 0",
    "port 65536",
    "port 1.5",
    "host https://host",
    "storage mode ftp",
    "smtp secure maybe",
    "app-origin host attacker/path",
    "sql password inline-secret",
    "sql unknown value",
    'storage root ""',
  ])
    await engine.execute(cmd);
  assert.deepEqual(config.running, before);
  assert.throws(() => words('storage root "unfinished'));
});
test("origin derives host/port, normalizes standard ports and supports IPv6", () => {
  const c = defaultConfig();
  assert.equal(appOrigin(c), "http://127.0.0.1:3000");
  c.host = "::1";
  c.port = 80;
  assert.equal(appOrigin(c), "http://[::1]");
  c.host = "0.0.0.0";
  assert.equal(appOrigin(c), "http://localhost");
  c.origin = { host: "example.nl", port: 443, protocol: "https" };
  assert.equal(appOrigin(c), "https://example.nl");
  assert.throws(() => normalizeConfig({ ...c, sql: { port: -1 } }));
  assert.throws(() => normalizeConfig({ ...c, origin: { host: "::" } }));
  assert.throws(() => normalizeConfig({ ...c, unknown: true }));
});
test("enable secret is hashed, verified and locked after repeated failures", async (t) => {
  const answers = ["a-long-enable-password", "a-long-enable-password"];
  const { engine, config, output } = consoleFor(fixture(t), answers);
  await engine.execute("en");
  await engine.execute("conf t");
  await engine.execute("enable secret");
  assert.match(config.running.console.enablePasswordHash, /^\$argon2id\$/);
  await engine.execute("copy run start");
  await engine.execute("disable");
  answers.push("wrong", "wrong", "wrong");
  for (let i = 0; i < 3; i++) await engine.execute("enable");
  assert.equal(engine.mode, "disabled");
  assert.ok(engine.enableBlockedUntil > Date.now());
  engine.enableBlockedUntil = 0;
  answers.push("a-long-enable-password");
  await engine.execute("enable");
  assert.equal(engine.mode, "enabled");
  assert.equal(output.join("\n").includes("a-long-enable-password"), false);
});
test("stale console cannot overwrite another save; relative paths use config location", async (t) => {
  const file = fixture(t),
    a = new ConfigState(file),
    b = new ConfigState(file);
  await a.set(["port"], 4000);
  await a.save();
  await b.set(["port"], 5000);
  await assert.rejects(b.save(), /andere console/);
  assert.equal(new ConfigState(file).running.port, 4000);
  assert.equal(
    runtimeConfig(file).storage.root,
    path.join(path.dirname(file), "data/documents"),
  );
  assert.deepEqual(configArguments(["admin", "--config", file]), {
    file,
    rest: ["admin"],
  });
  assert.throws(() => configArguments(["--config"]));
});
async function runCli(file, input) {
  const child = spawn(process.execPath, ["scripts/cli.js", "--config", file], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (out += b));
  child.stdin.end(input);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { code, out };
}
test("real piped CLI drains EOF input, hides password prompts and survives restart", async (t) => {
  const file = fixture(t);
  const r = await runCli(
    file,
    "enable\nconf t\nsql password\npipe-secret\npipe-secret\nport 4321\ncopy run start\nend\nshutdown\n",
  );
  assert.equal(r.code, 0);
  assert.equal(new ConfigState(file).running.port, 4321);
  assert.equal(new ConfigState(file).running.sql.password, "pipe-secret");
  assert.equal(r.out.includes("pipe-secret"), false);
  const r2 = await runCli(file, "enable\nshow start\nshutdown\n");
  assert.match(r2.out, /4321/);
  assert.equal(r2.out.includes("pipe-secret"), false);
});
test("discarded changes do not alter startup config", async (t) => {
  const file = fixture(t);
  await runCli(file, "enable\nconf t\nport 4321\n");
  assert.equal(new ConfigState(file).running.port, 3000);
});
test("server loads saved host/port/origin and serves the CLI without a database", async (t) => {
  const net = await import("node:net");
  const reservation = net.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const file = fixture(t),
    state = new ConfigState(file);
  await state.set(["port"], port);
  await state.set(["origin"], {
    host: "public.example.nl",
    port: 443,
    protocol: "https",
  });
  await state.save();
  const child = spawn(process.execPath, ["server/index.js", "--config", file], {
    env: { ...process.env, PORT: "1", APP_ORIGIN: "http://ignored.invalid" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
  });
  const until = Date.now() + 5000;
  while (!stdout.includes("DoMuS console.") && Date.now() < until) {
    if (child.exitCode !== null) throw Error(stderr);
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.match(stdout, new RegExp(`127.0.0.1:${port}`));
  assert.match(stdout, /browser-origin https:\/\/public.example.nl/);
  const root = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(root)).status, 200);
  assert.equal(
    (
      await fetch(root + "/api/logout", {
        method: "POST",
        headers: { origin: "https://public.example.nl" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(root + "/api/logout", {
        method: "POST",
        headers: { origin: "http://ignored.invalid" },
      })
    ).status,
    403,
  );
  child.stdin.write(
    "enable\nshow status\nconf t\nport 12345\ncopy run start\nend\nshutdown\n",
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("shutdown timeout: " + stderr)),
      5000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error(stderr));
    });
  });
  assert.equal(new ConfigState(file).running.port, 12345);
});
