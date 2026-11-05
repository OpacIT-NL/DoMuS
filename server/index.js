import { config } from "./runtime-config.js";
import { ConfigState } from "./config.js";
import { CommandConsole } from "./console.js";
import { Terminal } from "./terminal.js";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import argon2 from "argon2";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import http from "node:http";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { db, query, transaction, audit } from "./db.js";
import {
  authenticate,
  session,
  can,
  requirePermission as permit,
  fail,
  hash,
} from "./security.js";
import {
  numbered,
  childNumber,
  safePath,
  safeName,
  permissions,
} from "./domain.js";
import { mailRoutes } from "./mail.js";
const app = express(),
  server = http.createServer(app),
  root = path.resolve(config.storage.root);
await fs.mkdir(root, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
app.use(helmet(), express.json({ limit: "1mb" }), cookieParser());
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("origin") !== config.appOrigin
  )
    return res.status(403).json({ error: "Ongeldige origin" });
  next();
});
const cookie = {
  httpOnly: true,
  sameSite: "strict",
  secure: config.auth.secureCookies,
  path: "/",
  maxAge: 8 * 3600000,
};
app.post(
  "/api/login",
  rateLimit({ windowMs: 900000, limit: 20 }),
  async (req, res) => {
    const { username, password } = z
      .object({ username: z.string().max(100), password: z.string().max(1000) })
      .parse(req.body);
    const user = (
      await query("SELECT * FROM users WHERE username=? AND active=1", [
        username,
      ])
    )[0];
    if (!user || !(await argon2.verify(user.password_hash, password)))
      throw fail(401, "Onjuiste inloggegevens");
    const token = crypto.randomBytes(32).toString("hex");
    await query(
      "INSERT INTO sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))",
      [hash(token), user.id],
    );
    res.cookie("sid", token, cookie).json({ ok: true });
  },
);
app.use("/api", authenticate);
app.post("/api/logout", async (req, res) => {
  await query("DELETE FROM sessions WHERE token_hash=?", [
    hash(req.cookies.sid),
  ]);
  res.clearCookie("sid", { path: "/" }).json({ ok: true });
});
app.get("/api/me", async (req, res) => {
  const settings = Object.fromEntries(
    (await query("SELECT * FROM settings")).map((s) => [s.name, s.value]),
  );
  res.json({
    id: req.user.id,
    username: req.user.username,
    admin: !!req.user.admin,
    default_view: req.user.default_view || settings.default_view,
  });
});
app.put("/api/me/view", async (req, res) => {
  const view = z.enum(["manager", "explorer", "metadata"]).parse(req.body.view);
  await query("UPDATE users SET default_view=? WHERE id=?", [
    view,
    req.user.id,
  ]);
  res.json({ ok: true });
});
const clientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().max(254).default(""),
  phone: z.string().max(100).default(""),
  address: z.string().default(""),
  notes: z.string().default(""),
});
app.get("/api/clients", async (req, res) => {
  await permit(req.user, "crm.read");
  res.json(await query("SELECT * FROM clients ORDER BY name"));
});
app.post("/api/clients", async (req, res) => {
  await permit(req.user, "crm.write");
  const c = clientSchema.parse(req.body);
  const r = await query(
    "INSERT INTO clients(name,email,phone,address,notes) VALUES (?,?,?,?,?)",
    Object.values(c),
  );
  await audit(req.user, "client.create", r.insertId);
  res.status(201).json({ id: r.insertId });
});
app.put("/api/clients/:id", async (req, res) => {
  await permit(req.user, "crm.write");
  const c = clientSchema.parse(req.body);
  await query(
    "UPDATE clients SET name=?,email=?,phone=?,address=?,notes=? WHERE id=?",
    [...Object.values(c), req.params.id],
  );
  res.json({ ok: true });
});
app.get("/api/cases", async (req, res) => {
  const term = "%" + String(req.query.q || "") + "%";
  const rows = await query(
    "SELECT c.*,cl.name client FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE c.number LIKE ? OR c.title LIKE ? OR cl.name LIKE ? ORDER BY c.number",
    [term, term, term],
  );
  const visible = [];
  for (const c of rows)
    if (await can(req.user, "case.read", c.id)) visible.push(c);
  res.json(visible);
});
app.post("/api/cases", async (req, res) => {
  const b = z
    .object({
      client_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      parent_id: z.number().int().positive().nullable().default(null),
      number: z
        .string()
        .regex(/^[\p{L}\p{N}_-]+(?:\.00)?$/u)
        .max(95)
        .optional(),
    })
    .parse(req.body);
  await permit(req.user, "case.write", b.parent_id);
  const id = await transaction(async (c) => {
    let number,
      sub = 0;
    if (b.parent_id) {
      const p = (
        await query(
          "SELECT * FROM cases WHERE id=? FOR UPDATE",
          [b.parent_id],
          c,
        )
      )[0];
      if (!p || p.parent_id || p.client_id !== b.client_id)
        throw fail(400, "Ongeldig hoofddossier of klant");
      const used = await query(
        "SELECT sub_number FROM cases WHERE parent_id=?",
        [p.id],
        c,
      );
      sub = Array.from({ length: 99 }, (_, i) => i + 1).find(
        (n) => !used.some((x) => x.sub_number === n),
      );
      if (!sub) throw fail(409, "Maximaal 99 subdossiers");
      number = childNumber(p.number, sub);
    } else if (b.number) {
      number = b.number.endsWith(".00") ? b.number : b.number + ".00";
    } else {
      const now = new Date(),
        period =
          String(now.getUTCFullYear()) +
          String(now.getUTCMonth() + 1).padStart(2, "0");
      await query("INSERT IGNORE INTO sequences VALUES (?,0)", [period], c);
      const seq = (
        await query(
          "SELECT value FROM sequences WHERE period=? FOR UPDATE",
          [period],
          c,
        )
      )[0];
      const width = Number(
        (
          await query(
            "SELECT value FROM settings WHERE name='number_width'",
            [],
            c,
          )
        )[0].value,
      );
      let next = seq.value;
      do {
        number = numbered(period, ++next, width);
      } while (
        (await query("SELECT id FROM cases WHERE number=?", [number], c)).length
      );
      await query(
        "UPDATE sequences SET value=? WHERE period=?",
        [next, period],
        c,
      );
    }
    const r = await query(
      "INSERT INTO cases(client_id,parent_id,number,sub_number,title) VALUES (?,?,?,?,?)",
      [b.client_id, b.parent_id, number, sub, b.title],
      c,
    );
    await query(
      "INSERT INTO folders(case_id,path) VALUES (?,'/')",
      [r.insertId],
      c,
    );
    return r.insertId;
  });
  await audit(req.user, "case.create", id);
  res.status(201).json({ id });
});
app.put("/api/cases/:id/number", async (req, res) => {
  const id = Number(req.params.id);
  await permit(req.user, "case.write", id);
  let number = z
    .string()
    .regex(/^[\p{L}\p{N}_-]+(?:\.00)?$/u)
    .max(95)
    .parse(req.body.number);
  if (!number.endsWith(".00")) number += ".00";
  await transaction(async (c) => {
    const p = (
      await query("SELECT * FROM cases WHERE id=? FOR UPDATE", [id], c)
    )[0];
    if (!p || p.parent_id) throw fail(400, "Hernummer het hoofddossier");
    await query("UPDATE cases SET number=? WHERE id=?", [number, id], c);
    for (const child of await query(
      "SELECT id,sub_number FROM cases WHERE parent_id=?",
      [id],
      c,
    ))
      await query(
        "UPDATE cases SET number=? WHERE id=?",
        [childNumber(number, child.sub_number), child.id],
        c,
      );
  });
  await audit(req.user, "case.renumber", id);
  res.json({ ok: true });
});
app.get("/api/cases/:id", async (req, res) => {
  const id = Number(req.params.id);
  await permit(req.user, "case.read", id);
  const c = (
    await query(
      "SELECT c.*,cl.name client FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE c.id=?",
      [id],
    )
  )[0];
  if (!c) throw fail(404, "Dossier niet gevonden");
  const granted = [];
  for (const p of permissions) if (await can(req.user, p, id)) granted.push(p);
  res.json({
    ...c,
    permissions: granted,
    folders: await query(
      "SELECT * FROM folders WHERE case_id=? ORDER BY path",
      [id],
    ),
    fields: await query(
      "SELECT f.*,v.value FROM metadata_fields f LEFT JOIN metadata_values v ON v.field_id=f.id AND v.case_id=?",
      [id],
    ),
  });
});
app.post("/api/cases/:id/folders", async (req, res) => {
  const id = Number(req.params.id);
  await permit(req.user, "document.write", id);
  const name = z
    .string()
    .regex(/^\/(?:[\p{L}\p{N} _-]+\/?)*$/u)
    .max(500)
    .parse(req.body.path);
  const r = await query("INSERT INTO folders(case_id,path) VALUES (?,?)", [
    id,
    name,
  ]);
  res.status(201).json({ id: r.insertId });
});
app.put("/api/cases/:id/metadata", async (req, res) => {
  const id = Number(req.params.id);
  await permit(req.user, "metadata.write", id);
  const values = z.record(z.string(), z.string().max(10000)).parse(req.body);
  await transaction(async (c) => {
    for (const f of await query("SELECT * FROM metadata_fields", [], c)) {
      const value = values[f.id] ?? "";
      if (f.required && !value) throw fail(400, `${f.label} is verplicht`);
      if (value && f.type === "number" && !Number.isFinite(Number(value)))
        throw fail(400, "Ongeldig getal");
      if (value && f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw fail(400, "Ongeldige datum");
      if (value && f.type === "boolean" && !["true", "false"].includes(value))
        throw fail(400, "Ongeldige boolean");
      await query(
        "INSERT INTO metadata_values VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
        [id, f.id, value],
        c,
      );
    }
  });
  await audit(req.user, "metadata.update", id);
  res.json({ ok: true });
});
app.get("/api/cases/:id/documents", async (req, res) => {
  const id = Number(req.params.id);
  await permit(req.user, "document.read", id);
  const rows = await query(
    "SELECT d.id document_id,d.title,d.tags,f.path,v.* FROM documents d JOIN folders f ON f.id=d.folder_id JOIN versions v ON v.document_id=d.id WHERE d.case_id=? ORDER BY d.id,v.version DESC",
    [id],
  );
  res.json(rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) })));
});
app.post(
  "/api/cases/:id/documents",
  async (req, res, next) => {
    try {
      await permit(req.user, "document.write", Number(req.params.id));
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw fail(400, "Bestand ontbreekt");
    const caseId = Number(req.params.id);
    let saved,
      committed = false;
    try {
      const result = await transaction(async (c) => {
        let doc;
        if (req.body.document_id) {
          doc = (
            await query(
              "SELECT * FROM documents WHERE id=? AND case_id=? FOR UPDATE",
              [Number(req.body.document_id), caseId],
              c,
            )
          )[0];
          if (!doc) throw fail(404, "Document niet gevonden");
        } else {
          const folder = (
            await query(
              "SELECT * FROM folders WHERE id=? AND case_id=?",
              [Number(req.body.folder_id), caseId],
              c,
            )
          )[0];
          if (!folder) throw fail(400, "Ongeldige map");
          const tags = z
            .array(z.string().min(1).max(80))
            .max(30)
            .parse(JSON.parse(req.body.tags || "[]"));
          const r = await query(
            "INSERT INTO documents(case_id,folder_id,title,tags) VALUES (?,?,?,?)",
            [
              caseId,
              folder.id,
              safeName(req.file.originalname),
              JSON.stringify(tags),
            ],
            c,
          );
          doc = { id: r.insertId, folder_id: folder.id };
        }
        const n = (
          await query(
            "SELECT COALESCE(MAX(version),0)+1 n FROM versions WHERE document_id=?",
            [doc.id],
            c,
          )
        )[0].n;
        const name = safeName(req.file.originalname),
          ext = path.extname(name),
          filename = name.slice(0, name.length - ext.length) + `.v${n}` + ext;
        const folderPath = (
          await query("SELECT path FROM folders WHERE id=?", [doc.folder_id], c)
        )[0].path.replace(/\/$/, "");
        const key = `${caseId}${folderPath}/${doc.id}/${filename}`;
        saved = safePath(root, key);
        await fs.mkdir(path.dirname(saved), { recursive: true });
        await fs.writeFile(saved, req.file.buffer, { flag: "wx", mode: 0o640 });
        const r = await query(
          "INSERT INTO versions(document_id,version,filename,storage_key,size,sha256,created_by) VALUES (?,?,?,?,?,?,?)",
          [
            doc.id,
            n,
            filename,
            key,
            req.file.size,
            hash(req.file.buffer),
            req.user.id,
          ],
          c,
        );
        return { id: r.insertId };
      });
      committed = true;
      await audit(req.user, "document.upload", result.id);
      res.status(201).json(result);
    } catch (e) {
      if (saved && !committed && e.code !== "EEXIST")
        await fs.unlink(saved).catch(() => {});
      throw e;
    }
  },
);
async function versionFor(user, id, permission) {
  const v = (
    await query(
      "SELECT v.*,d.case_id FROM versions v JOIN documents d ON d.id=v.document_id WHERE v.id=?",
      [id],
    )
  )[0];
  if (!v) throw fail(404, "Versie niet gevonden");
  await permit(user, permission, v.case_id);
  return v;
}
app.get("/api/versions/:id/download", async (req, res) => {
  const v = await versionFor(req.user, req.params.id, "document.read");
  await audit(req.user, "document.download", v.id);
  res.download(safePath(root, v.storage_key), v.filename);
});
const desktopClients = new Map(),
  tickets = new Map();
app.post("/api/desktop/ticket", async (req, res) => {
  const ticket = crypto.randomBytes(32).toString("hex");
  tickets.set(hash(ticket), {
    token: req.cookies.sid,
    expires: Date.now() + 60000,
  });
  res.json({ ticket });
});
setInterval(() => {
  for (const [k, v] of tickets) if (v.expires < Date.now()) tickets.delete(k);
}, 60000).unref();
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/desktop") throw Error();
    const key = hash(url.searchParams.get("ticket") || ""),
      t = tickets.get(key);
    tickets.delete(key);
    if (!t || t.expires < Date.now()) throw Error();
    const u = await session(t.token);
    if (!u) throw Error();
    wss.handleUpgrade(req, socket, head, (ws) => {
      desktopClients.get(u.id)?.ws.close();
      const item = { ws, token: t.token };
      desktopClients.set(u.id, item);
      ws.on("close", () => {
        if (desktopClients.get(u.id) === item) desktopClients.delete(u.id);
      });
      ws.on("error", () => ws.close());
    });
  } catch {
    socket.destroy();
  }
});
app.post("/api/versions/:id/open", async (req, res) => {
  const v = await versionFor(req.user, req.params.id, "document.open");
  await permit(req.user, "document.read", v.case_id);
  if (config.storage.mode !== "smb")
    throw fail(400, "Gebruik downloaden bij serveropslag");
  const client = desktopClients.get(req.user.id);
  if (
    !client ||
    client.ws.readyState !== WebSocket.OPEN ||
    !(await session(client.token))
  )
    throw fail(409, "Verbind eerst de Electron-client");
  client.ws.send(
    JSON.stringify({ type: "open", key: v.storage_key, filename: v.filename }),
  );
  await audit(req.user, "document.open", v.id);
  res.json({ ok: true });
});
mailRoutes(app, { upload, root });
app.use("/api/admin", (req, res, next) =>
  req.user.admin ? next() : next(fail(403, "Alleen beheerders")),
);
app.get("/api/admin", async (req, res) => {
  res.json({
    users: await query("SELECT id,username,admin,active FROM users"),
    roles: await query("SELECT * FROM roles"),
    memberships: await query("SELECT * FROM user_roles"),
    acl: await query("SELECT * FROM acl"),
    fields: await query("SELECT * FROM metadata_fields"),
    templates: await query("SELECT * FROM templates"),
    settings: await query("SELECT * FROM settings"),
    permissions,
    audit: await query("SELECT * FROM audit ORDER BY id DESC LIMIT 100"),
  });
});
app.post("/api/admin/users", async (req, res) => {
  const b = z
    .object({
      username: z.string().min(1).max(100),
      password: z.string().min(12).max(1000),
      admin: z.boolean().default(false),
    })
    .parse(req.body);
  const r = await query(
    "INSERT INTO users(username,password_hash,admin) VALUES (?,?,?)",
    [
      b.username,
      await argon2.hash(b.password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      }),
      b.admin,
    ],
  );
  res.status(201).json({ id: r.insertId });
});
app.put("/api/admin/users/:id", async (req, res) => {
  const b = z
    .object({
      active: z.boolean(),
      password: z.string().min(12).max(1000).optional(),
    })
    .parse(req.body);
  if (Number(req.params.id) === req.user.id && !b.active)
    throw fail(400, "Je kunt jezelf niet uitschakelen");
  await query("UPDATE users SET active=? WHERE id=?", [
    b.active,
    req.params.id,
  ]);
  if (b.password)
    await query("UPDATE users SET password_hash=? WHERE id=?", [
      await argon2.hash(b.password, { type: argon2.argon2id }),
      req.params.id,
    ]);
  await query("DELETE FROM sessions WHERE user_id=?", [req.params.id]);
  res.json({ ok: true });
});
app.post("/api/admin/roles", async (req, res) => {
  const name = z.string().min(1).max(100).parse(req.body.name);
  const r = await query("INSERT INTO roles(name) VALUES (?)", [name]);
  res.json({ id: r.insertId });
});
app.post("/api/admin/memberships", async (req, res) => {
  const b = z
    .object({
      user_id: z.number().int().positive(),
      role_id: z.number().int().positive(),
    })
    .parse(req.body);
  await query("INSERT IGNORE INTO user_roles VALUES (?,?)", [
    b.user_id,
    b.role_id,
  ]);
  res.json({ ok: true });
});
app.delete("/api/admin/memberships/:user/:role", async (req, res) => {
  await query("DELETE FROM user_roles WHERE user_id=? AND role_id=?", [
    req.params.user,
    req.params.role,
  ]);
  res.json({ ok: true });
});
app.post("/api/admin/acl", async (req, res) => {
  const b = z
    .object({
      role_id: z.number().int().positive(),
      case_id: z.number().int().positive().nullable(),
      permission: z.enum(permissions),
      effect: z.enum(["allow", "deny"]),
    })
    .parse(req.body);
  await query(
    "INSERT INTO acl(role_id,case_id,permission,effect) VALUES (?,?,?,?)",
    Object.values(b),
  );
  await audit(req.user, "acl.create", b.role_id);
  res.json({ ok: true });
});
app.delete("/api/admin/acl/:id", async (req, res) => {
  await query("DELETE FROM acl WHERE id=?", [req.params.id]);
  await audit(req.user, "acl.delete", req.params.id);
  res.json({ ok: true });
});
app.post("/api/admin/fields", async (req, res) => {
  const b = z
    .object({
      name: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .max(100),
      label: z.string().min(1).max(200),
      type: z.enum(["text", "number", "date", "boolean"]),
      required: z.boolean(),
    })
    .parse(req.body);
  await query(
    "INSERT INTO metadata_fields(name,label,type,required) VALUES (?,?,?,?)",
    Object.values(b),
  );
  res.json({ ok: true });
});
app.post("/api/admin/templates", async (req, res) => {
  const b = z
    .object({
      name: z.string().min(1).max(200),
      subject: z.string().min(1).max(255),
      body: z.string().min(1).max(50000),
    })
    .parse(req.body);
  await query(
    "INSERT INTO templates(name,subject,body) VALUES (?,?,?)",
    Object.values(b),
  );
  res.json({ ok: true });
});
app.put("/api/admin/settings", async (req, res) => {
  const b = z
    .object({
      default_view: z.enum(["manager", "explorer", "metadata"]),
      number_width: z.enum(["4", "5"]),
    })
    .parse(req.body);
  for (const [k, v] of Object.entries(b))
    await query("UPDATE settings SET value=? WHERE name=?", [v, k]);
  res.json({ ok: true });
});
app.use(express.static("public"));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    err.status ||
    (err instanceof z.ZodError
      ? 400
      : err.code === "ER_DUP_ENTRY"
        ? 409
        : err instanceof multer.MulterError
          ? 400
          : 500);
  if (status === 500) console.error(err);
  res.status(status).json({
    error:
      status === 500
        ? "Interne fout"
        : status === 409
          ? "Nummer of record bestaat al"
          : err instanceof z.ZodError
            ? "Ongeldige invoer"
            : err.message,
  });
});
let terminal;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  terminal?.close();
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
  await db.end();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    shutdown().catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    }),
  );
server.on("error", (error) => {
  console.error("Webserver kon niet starten: " + error.message);
  terminal?.close();
  process.exitCode = 1;
});
server.listen(config.port, config.host, () => {
  console.log(
    `DoMuS luistert op ${config.host}:${config.port}; browser-origin ${config.appOrigin}`,
  );
  if (
    process.stdin &&
    !process.stdin.destroyed &&
    process.stdin.readable !== false
  ) {
    terminal = new Terminal();
    const engine = new CommandConsole({
      config: new ConfigState(),
      ask: (...args) => terminal.ask(...args),
      write: (message) => terminal.write(message),
      shutdown,
      status: () =>
        `Actief: ${config.host}:${config.port}; origin ${config.appOrigin}`,
    });
    terminal.write("DoMuS console. Type help or enable.");
    terminal
      .run(engine)
      .then(() => {
        if (engine.dirty)
          terminal.write("Niet-opgeslagen wijzigingen zijn niet bewaard.");
      })
      .catch((e) => console.error(e.message));
  }
});
