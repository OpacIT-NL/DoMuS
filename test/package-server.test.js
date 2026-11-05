import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { unzipSync, strFromU8 } from "fflate";
import { packageServer, releaseVersion } from "../scripts/package-server.js";

test("server ZIP has root-level entrypoints, matching versions and no deployment secrets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "domus-package-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const item of [
    "package.json",
    "package-lock.json",
    "README.md",
    "SERVER-INSTALL.md",
    "THIRD_PARTY_NOTICES.md",
    "licenses",
    "server",
    "scripts",
    "public",
  ])
    await fs.cp(new URL("../" + item, import.meta.url), path.join(root, item), {
      recursive: true,
    });
  for (const name of [
    "config.json",
    ".env",
    "server/config.json",
    "public/.env",
    "data/private.pdf",
    "node_modules/secret.txt",
  ]) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), "secret-do-not-ship");
  }
  const result = await packageServer({ root, version: "1.2.3-beta.1" }),
    archive = unzipSync(await fs.readFile(result.file));
  for (const file of [
    "package.json",
    "package-lock.json",
    "server/index.js",
    "server/schema.sql",
    "public/index.html",
    "scripts/cli.js",
    "scripts/admin.js",
    "scripts/migrate.js",
    "licenses/Phidias-GPL-3.0.txt",
  ])
    assert.ok(archive[file], file);
  assert.ok(
    Object.keys(archive).every(
      (name) =>
        !name.startsWith("/") &&
        !name.includes("..") &&
        !name.startsWith("domus-"),
    ),
  );
  for (const file of [
    "config.json",
    ".env",
    "server/config.json",
    "public/.env",
    "data/private.pdf",
    "node_modules/secret.txt",
    "scripts/package-server.js",
    "desktop/main.cjs",
  ])
    assert.equal(archive[file], undefined, file);
  const manifest = JSON.parse(strFromU8(archive["package.json"])),
    lock = JSON.parse(strFromU8(archive["package-lock.json"]));
  assert.equal(manifest.version, "1.2.3-beta.1");
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[""].version, manifest.version);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(lock.packages["node_modules/fflate"], undefined);
  assert.deepEqual(Object.keys(manifest.scripts).sort(), [
    "admin",
    "cli",
    "migrate",
    "start",
  ]);
  await fs.symlink(
    path.join(root, "config.json"),
    path.join(root, "server", "secret.js"),
  );
  await assert.rejects(packageServer({ root }), /Symlink/);
});
test("release versions reject path traversal and shell syntax", () => {
  for (const version of [
    "../secret",
    "1.2",
    "v1.2.3",
    "01.2.3",
    "1.2.3\nother",
    "1.2.3;echo x",
  ])
    assert.throws(() => releaseVersion(version));
  assert.equal(releaseVersion("1.2.3"), "1.2.3");
});
