import test from "node:test";
import assert from "node:assert/strict";
import { initializeDatabase } from "../server/database-init.js";
import { CommandConsole } from "../server/console.js";
import { defaultConfig } from "../server/config.js";

function mockConnection({ lock = 1, fail = false } = {}) {
  const calls = [];
  let closed = false;
  return {
    calls,
    get closed() {
      return closed;
    },
    async execute(sql, args) {
      calls.push({ sql, args });
      if (sql.includes("GET_LOCK")) return [[{ acquired: lock }]];
      if (fail && sql.startsWith("CREATE TABLE"))
        throw Error("DDL permission denied");
      return [[]];
    },
    async end() {
      closed = true;
    },
  };
}
test("db init installs the existing schema and defaults using the supplied SQL connection", async () => {
  const connection = mockConnection();
  let options;
  const sql = {
    ...defaultConfig().sql,
    host: "database.internal",
    port: 3307,
    password: "hidden",
    database: "production",
  };
  const result = await initializeDatabase(sql, {
    connect: async (o) => {
      options = o;
      return connection;
    },
  });
  assert.equal(options.database, "production");
  assert.equal(options.password, "hidden");
  assert.equal(options.port, 3307);
  const statements = connection.calls.slice(1, -1).map((c) => c.sql);
  assert.equal(result.statements, statements.length);
  assert.ok(
    statements.some((s) => s.startsWith("CREATE TABLE IF NOT EXISTS users")),
  );
  assert.ok(
    statements.some((s) => s.startsWith("INSERT IGNORE INTO settings")),
  );
  assert.ok(
    statements.every(
      (s) =>
        s.startsWith("CREATE TABLE IF NOT EXISTS") ||
        s.startsWith("INSERT IGNORE"),
    ),
  );
  assert.match(connection.calls.at(-1).sql, /RELEASE_LOCK/);
  assert.equal(connection.closed, true);
});
test("db init releases its lock and connection on errors and does not continue after failure", async () => {
  const connection = mockConnection({ fail: true });
  await assert.rejects(
    initializeDatabase(defaultConfig().sql, {
      connect: async () => connection,
    }),
    /DDL permission denied/,
  );
  assert.equal(connection.calls.length, 3);
  assert.match(connection.calls.at(-1).sql, /RELEASE_LOCK/);
  assert.equal(connection.closed, true);
  const busy = mockConnection({ lock: 0 });
  await assert.rejects(
    initializeDatabase(defaultConfig().sql, { connect: async () => busy }),
    /al bezig/,
  );
  assert.equal(busy.calls.length, 1);
  assert.equal(busy.closed, true);
});
test("CLI restricts db init to enabled mode, uses running SQL and reports failure without success", async () => {
  const running = defaultConfig(),
    output = [],
    calls = [];
  const cli = new CommandConsole({
    config: { running, dirty: () => true },
    write: (s) => output.push(s),
    ask: async () => "",
    initDatabase: async (sql) => calls.push(sql),
  });
  await cli.execute("db init");
  assert.equal(calls.length, 0);
  await cli.execute("enable");
  await cli.execute("help");
  assert.match(output.at(-1), /db init/);
  running.sql.database = "new-database";
  await cli.execute("db init");
  assert.equal(calls[0].database, "new-database");
  assert.match(output.at(-1), /copy run start/);
  await cli.execute("conf t");
  await cli.execute("db init");
  assert.equal(calls.length, 1);
  await cli.execute("do db init");
  assert.equal(calls.length, 2);
  cli.initDatabase = async () => {
    throw Error("Access denied");
  };
  output.length = 0;
  await cli.execute("do db init");
  assert.match(output.at(-1), /Access denied/);
  assert.ok(!output.some((s) => s.includes("geïnstalleerd")));
});
