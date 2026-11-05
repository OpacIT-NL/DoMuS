import test from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { createUser } from "../server/user-create.js";
import { CommandConsole } from "../server/console.js";
import { defaultConfig } from "../server/config.js";

test("user creation hashes passwords, parameterizes insertion and closes the SQL connection", async () => {
  let options,
    params,
    closed = false;
  const result = await createUser(
    defaultConfig().sql,
    { username: "Alice", password: "secret password 123" },
    {
      connect: async (o) => {
        options = o;
        return {
          execute: async (sql, p) => {
            assert.match(sql, /^INSERT INTO users/);
            params = p;
            return [{ insertId: 42 }];
          },
          end: async () => {
            closed = true;
          },
        };
      },
    },
  );
  assert.equal(result.id, 42);
  assert.equal(options.database, "domus");
  assert.equal(params[0], "Alice");
  assert.equal(params[2], false);
  assert.match(params[1], /^\$argon2id\$/);
  assert.ok(await argon2.verify(params[1], "secret password 123"));
  assert.ok(closed);
});
test("invalid user input never opens SQL; duplicates and missing schema have actionable errors", async () => {
  for (const user of [
    { username: "", password: "long-password" },
    { username: " Alice ", password: "long-password" },
    { username: "Alice", password: "short" },
    { username: "Alice", password: "long-password", admin: "yes" },
  ])
    await assert.rejects(
      createUser(defaultConfig().sql, user, {
        connect: () => assert.fail("Must not connect"),
      }),
    );
  for (const [code, message] of [
    ["ER_DUP_ENTRY", /bestaat al/],
    ["ER_NO_SUCH_TABLE", /db init/],
  ]) {
    let closed = false;
    await assert.rejects(
      createUser(
        defaultConfig().sql,
        { username: "Alice", password: "long-password", admin: true },
        {
          connect: async () => ({
            execute: async () => {
              throw Object.assign(Error("SQL error"), { code });
            },
            end: async () => {
              closed = true;
            },
          }),
        },
      ),
      message,
    );
    assert.ok(closed);
  }
});
test("CLI creates ordinary and administrator users with hidden confirmed passwords in privileged modes", async () => {
  const output = [],
    prompts = [],
    calls = [],
    answers = [];
  const config = { running: defaultConfig(), dirty: () => false };
  const cli = new CommandConsole({
    config,
    write: (s) => output.push(s),
    ask: async (_, secret) => {
      prompts.push(secret);
      return answers.shift();
    },
    addUser: async (sql, user) => calls.push({ sql, user }),
  });
  await cli.execute("user create blocked admin");
  assert.equal(prompts.length, 0);
  assert.equal(calls.length, 0);
  await cli.execute("enable");
  answers.push("long password 123", "long password 123");
  await cli.execute("user create Alice");
  assert.equal(calls[0].user.admin, false);
  config.running.sql.database = "configured-db";
  await cli.execute("conf t");
  answers.push("admin password 123", "admin password 123");
  await cli.execute("username Bob admin");
  assert.equal(calls[1].user.admin, true);
  assert.equal(calls[1].sql.database, "configured-db");
  answers.push("long password 123", "long password 123");
  await cli.execute("do user create Carol");
  assert.equal(calls.length, 3);
  assert.ok(prompts.every(Boolean));
  assert.ok(!output.join("\n").includes("password 123"));
  await cli.execute("user create Dave admin inline-password");
  assert.equal(calls.length, 3);
  answers.push("long password 123", "different");
  await cli.execute("user create Dave");
  assert.equal(calls.length, 3);
  assert.match(output.at(-1), /komen niet overeen/);
  answers.push("short", "short");
  await cli.execute("user create Dave");
  assert.equal(calls.length, 3);
  cli.addUser = async () => {
    throw Error("Gebruikersnaam bestaat al");
  };
  answers.push("long password 123", "long password 123");
  output.length = 0;
  await cli.execute("user create Alice");
  assert.match(output.at(-1), /bestaat al/);
  assert.ok(!output.some((s) => s.includes("direct opgeslagen")));
});
