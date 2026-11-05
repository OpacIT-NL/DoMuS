import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test(
  "MySQL/MariaDB: nummering, ACL, versies, metadata en e-mail",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "domus-integration-"));
    const { defaultConfig } = await import("../server/config.js");
    const configuration = defaultConfig(),
      url = new URL(process.env.TEST_DATABASE_URL);
    configuration.sql = {
      host: url.hostname,
      port: Number(url.port || 3306),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
    };
    configuration.port = 3197;
    configuration.origin.host = "localhost";
    configuration.storage.root = root;
    const file = path.join(root, "config.json");
    await fs.writeFile(file, JSON.stringify(configuration), { mode: 0o600 });
    process.argv.push("--config", file);
    const { query, db } = await import("../server/db.js");
    let child;
    try {
      const { initializeDatabase } = await import("../server/database-init.js");
      await initializeDatabase(configuration.sql);
      // Repeating installation must retain production data and customized defaults.
      await query(
        "UPDATE settings SET value='explorer' WHERE name='default_view'",
      );
      await initializeDatabase(configuration.sql);
      assert.equal(
        (await query("SELECT value FROM settings WHERE name='default_view'"))[0]
          .value,
        "explorer",
      );
      const suffix = Date.now().toString();
      const password = "test-password-123";
      const { createUser } = await import("../server/user-create.js");
      await createUser(configuration.sql, {
        username: "admin" + suffix,
        password,
        admin: true,
      });
      await assert.rejects(
        createUser(configuration.sql, {
          username: "admin" + suffix,
          password: "different-password",
          admin: false,
        }),
        /bestaat al/,
      );
      child = spawn(process.execPath, ["server/index.js", "--config", file], {
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let errors = "";
      child.stderr.on("data", (b) => (errors += b));
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("Server start timeout: " + errors)),
          10000,
        );
        child.stdout.once("data", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.once("exit", () => {
          clearTimeout(timeout);
          reject(Error(errors));
        });
      });
      async function request(url, method = "GET", body, cookie = "") {
        const r = await fetch("http://localhost:3197/api" + url, {
          method,
          headers: {
            origin: "http://localhost:3197",
            cookie,
            ...(body instanceof FormData
              ? {}
              : { "content-type": "application/json" }),
          },
          body: body
            ? body instanceof FormData
              ? body
              : JSON.stringify(body)
            : undefined,
        });
        return {
          status: r.status,
          body: await r.json(),
          cookie: r.headers.get("set-cookie")?.split(";")[0],
        };
      }
      const login = await request("/login", "POST", {
        username: "admin" + suffix,
        password,
      });
      assert.equal(login.status, 200);
      const token = login.cookie;
      const call = (url, method, body) => request(url, method, body, token);
      const customer = await call("/clients", "POST", { name: "Testklant" });
      assert.equal(customer.status, 201);
      const caseBody = { client_id: customer.body.id, title: "Testdossier" };
      const cases = await Promise.all(
        Array.from({ length: 6 }, () => call("/cases", "POST", caseBody)),
      );
      assert.ok(cases.every((c) => c.status === 201));
      const numbers = await Promise.all(
        cases.map((c) => call("/cases/" + c.body.id)),
      );
      assert.equal(new Set(numbers.map((c) => c.body.number)).size, 6);
      const id = cases[0].body.id;
      const children = await Promise.all(
        Array.from({ length: 3 }, () =>
          call("/cases", "POST", { ...caseBody, parent_id: id }),
        ),
      );
      assert.ok(children.every((c) => c.status === 201));
      assert.equal(
        (
          await call("/cases/" + id + "/number", "PUT", {
            number: "CUSTOM-" + suffix,
          })
        ).status,
        200,
      );
      assert.ok(
        (await call("/cases/" + children[0].body.id)).body.number.startsWith(
          "CUSTOM-" + suffix + ".0",
        ),
      );
      const folder = numbers[0].body.folders[0].id;
      async function upload(documentId) {
        const form = new FormData();
        form.set("file", new Blob(["document content"]), "contract.txt");
        form.set("folder_id", String(folder));
        form.set("tags", '["contract"]');
        if (documentId) form.set("document_id", String(documentId));
        return call("/cases/" + id + "/documents", "POST", form);
      }
      assert.equal((await upload()).status, 201);
      let versions = (await call("/cases/" + id + "/documents")).body;
      const documentId = versions[0].document_id;
      const uploaded = await Promise.all([
        upload(documentId),
        upload(documentId),
      ]);
      assert.ok(uploaded.every((r) => r.status === 201));
      versions = (await call("/cases/" + id + "/documents")).body;
      assert.deepEqual(
        versions.map((v) => v.version),
        [3, 2, 1],
      );
      for (const v of versions)
        assert.equal(
          await fs.readFile(path.join(root, v.storage_key), "utf8"),
          "document content",
        );
      const user = await call("/admin/users", "POST", {
        username: "user" + suffix,
        password,
      });
      const loginUser = await request("/login", "POST", {
        username: "user" + suffix,
        password,
      });
      assert.equal(
        (await request("/cases/" + id, "GET", null, loginUser.cookie)).status,
        403,
      );
      const role = await call("/admin/roles", "POST", {
        name: "role" + suffix,
      });
      await call("/admin/memberships", "POST", {
        user_id: user.body.id,
        role_id: role.body.id,
      });
      await call("/admin/acl", "POST", {
        role_id: role.body.id,
        case_id: id,
        permission: "case.read",
        effect: "allow",
      });
      assert.equal(
        (
          await request(
            "/cases/" + children[0].body.id,
            "GET",
            null,
            loginUser.cookie,
          )
        ).status,
        200,
      );
      await call("/admin/acl", "POST", {
        role_id: role.body.id,
        case_id: children[0].body.id,
        permission: "case.read",
        effect: "deny",
      });
      assert.equal(
        (
          await request(
            "/cases/" + children[0].body.id,
            "GET",
            null,
            loginUser.cookie,
          )
        ).status,
        403,
      );
      const eml = new FormData();
      eml.set(
        "file",
        new Blob([
          "From: test@example.com\r\nTo: recipient@example.com\r\nSubject: Test\r\n\r\nHello",
        ]),
        "test.eml",
      );
      assert.equal(
        (await call("/cases/" + id + "/emails/import", "POST", eml)).status,
        200,
      );
      assert.equal(
        (await call("/cases/" + id + "/emails")).body[0].subject,
        "Test",
      );
      assert.equal((await call("/logout", "POST")).status, 200);
      assert.equal((await call("/me")).status, 401);
    } finally {
      if (child) {
        child.kill();
        await new Promise((r) =>
          child.exitCode !== null ? r() : child.once("exit", r),
        );
      }
      await db.end();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
