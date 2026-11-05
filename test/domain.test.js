import test from "node:test";
import assert from "node:assert/strict";
import {
  numbered,
  childNumber,
  allowed,
  safePath,
  render,
} from "../server/domain.js";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { resolveDocument } = createRequire(import.meta.url)(
  "../desktop/path.cjs",
);
test("nummering met instelbare breedte en limiet", () => {
  assert.equal(numbered("202611", 1, 4), "2026110001.00");
  assert.equal(numbered("202611", 1, 5), "20261100001.00");
  assert.throws(() => numbered("202611", 10000, 4));
});
test("subdossiers behouden de eigen nummerbasis", () => {
  assert.equal(childNumber("EIGEN-42.00", 1), "EIGEN-42.01");
  assert.equal(childNumber("2026110001.00", 99), "2026110001.99");
  assert.throws(() => childNumber("x", 100));
});
test("ACL weigert standaard, erft en laat deny voorgaan", () => {
  const allow = { case_id: 1, permission: "document.read", effect: "allow" };
  assert.equal(allowed([], "document.read", 2, 1), false);
  assert.equal(allowed([allow], "document.read", 2, 1), true);
  assert.equal(allowed([allow], "document.read", 3, null), false);
  assert.equal(
    allowed(
      [allow, { ...allow, case_id: 2, effect: "deny" }],
      "document.read",
      2,
      1,
    ),
    false,
  );
  assert.equal(
    allowed([{ ...allow, case_id: null }], "document.read", 3, null),
    true,
  );
});
test("storage blokkeert traversal en absolute paden", () => {
  for (const key of ["../secret", "/etc/passwd", "a/../../b", "a\\..\\b"])
    assert.throws(() => safePath("/tmp/store", key));
  assert.equal(
    safePath("/tmp/store", "1/2/test.pdf"),
    "/tmp/store/1/2/test.pdf",
  );
});
test("templates vervangen uitsluitend ondersteunde variabelen", () => {
  assert.equal(
    render("Hallo {{client}}: {{number}} {{unknown}}", {
      client: "Klant",
      number: "1",
    }),
    "Hallo Klant: 1 {{unknown}}",
  );
});
test("desktop blokkeert symlink escape en uitvoerbare bestanden", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "domus-test-"));
  try {
    await fs.mkdir(path.join(dir, "share"));
    await fs.writeFile(path.join(dir, "outside.pdf"), "outside");
    await fs.writeFile(path.join(dir, "share", "test.pdf"), "ok");
    await fs.writeFile(path.join(dir, "share", "run.exe"), "bad");
    await fs.symlink(
      path.join(dir, "outside.pdf"),
      path.join(dir, "share", "escape.pdf"),
    );
    assert.equal(
      await resolveDocument(path.join(dir, "share"), "test.pdf"),
      path.join(dir, "share", "test.pdf"),
    );
    await assert.rejects(
      resolveDocument(path.join(dir, "share"), "escape.pdf"),
    );
    await assert.rejects(resolveDocument(path.join(dir, "share"), "run.exe"));
    await assert.rejects(
      resolveDocument(path.join(dir, "share"), "../outside.pdf"),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
