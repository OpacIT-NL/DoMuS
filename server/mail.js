import { config } from "./runtime-config.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { simpleParser } from "mailparser";
import MsgReaderModule from "@kenjiuno/msgreader";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { z } from "zod";
import { query, audit } from "./db.js";
import { requirePermission as permit, hash, fail } from "./security.js";
import { safePath, render } from "./domain.js";
const MsgReader = MsgReaderModule.default || MsgReaderModule;
export function mailRoutes(app, { upload, root }) {
  async function ingest(caseId, buffer, extension) {
    const digest = hash(buffer);
    if (
      (
        await query("SELECT id FROM emails WHERE case_id=? AND source_hash=?", [
          caseId,
          digest,
        ])
      ).length
    )
      return false;
    let mail;
    if (extension === "msg") {
      const parsed = new MsgReader(buffer).getFileData();
      if (parsed.error) throw fail(400, "Ongeldig MSG-bestand");
      mail = {
        subject: parsed.subject || "",
        from: { text: parsed.senderEmail || parsed.senderName || "" },
        to: {
          text: (parsed.recipients || [])
            .map((r) => r.email || r.name || "")
            .join(", "),
        },
        text: parsed.body || "",
      };
    } else {
      mail = await simpleParser(buffer);
    }
    const key = `${caseId}/email/${crypto.randomUUID()}.${extension}`,
      file = safePath(root, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer, { flag: "wx", mode: 0o640 });
    try {
      await query(
        "INSERT INTO emails(case_id,direction,subject,sender,recipients,body,source_hash,original_key,status) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          caseId,
          "in",
          mail.subject || "",
          mail.from?.text || "",
          mail.to?.text || "",
          mail.text || "",
          digest,
          key,
          "received",
        ],
      );
    } catch (e) {
      await fs.unlink(file);
      if (e.code === "ER_DUP_ENTRY") return false;
      throw e;
    }
    return true;
  }
  app.get("/api/cases/:id/emails", async (req, res) => {
    await permit(req.user, "email.read", Number(req.params.id));
    res.json(
      await query(
        "SELECT id,direction,subject,sender,recipients,body,status,created_at FROM emails WHERE case_id=? ORDER BY id DESC",
        [req.params.id],
      ),
    );
  });
  app.get("/api/emails/:id/original", async (req, res) => {
    const m = (
      await query("SELECT * FROM emails WHERE id=?", [req.params.id])
    )[0];
    if (!m?.original_key) throw fail(404, "Geen origineel");
    await permit(req.user, "email.read", m.case_id);
    res.download(
      safePath(root, m.original_key),
      "email" + path.extname(m.original_key),
    );
  });
  app.post(
    "/api/cases/:id/emails/import",
    async (req, res, next) => {
      try {
        await permit(req.user, "email.import", Number(req.params.id));
        next();
      } catch (e) {
        next(e);
      }
    },
    upload.single("file"),
    async (req, res) => {
      const ext = path
        .extname(req.file?.originalname || "")
        .slice(1)
        .toLowerCase();
      if (!["msg", "eml"].includes(ext))
        throw fail(400, "Upload een .msg of .eml");
      const imported = await ingest(
        Number(req.params.id),
        req.file.buffer,
        ext,
      );
      await audit(req.user, "email.import", req.params.id);
      res.json({ imported });
    },
  );
  const running = new Set();
  app.post("/api/cases/:id/emails/imap", async (req, res) => {
    const id = Number(req.params.id);
    await permit(req.user, "email.import", id);
    if (!config.imap.host) throw fail(400, "IMAP is nog niet geconfigureerd");
    if (running.has(id)) throw fail(409, "Import loopt al");
    running.add(id);
    const client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port,
      secure: config.imap.secure,
      doSTARTTLS: !config.imap.secure,
      auth: { user: config.imap.username, pass: config.imap.password },
      logger: false,
    });
    let imported = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.imap.mailbox);
      try {
        const count = client.mailbox.exists;
        if (count) {
          const uids = [];
          for await (const m of client.fetch(`${Math.max(1, count - 99)}:*`, {
            uid: true,
            size: true,
          })) {
            if (m.size <= 25 * 1024 * 1024) uids.push(m.uid);
          }
          for (const uid of uids) {
            const m = await client.fetchOne(
              uid,
              { source: true },
              { uid: true },
            );
            if (m && (await ingest(id, m.source, "eml"))) imported++;
          }
        }
      } finally {
        lock.release();
      }
      await audit(req.user, "email.imap", id);
      res.json({ imported });
    } finally {
      running.delete(id);
      await client.logout().catch(() => {});
    }
  });
  app.get("/api/templates", async (req, res) => {
    res.json(await query("SELECT id,name FROM templates"));
  });
  app.post("/api/cases/:id/emails/send", async (req, res) => {
    const id = Number(req.params.id);
    await permit(req.user, "email.send", id);
    if (!config.smtp.host) throw fail(400, "SMTP is nog niet geconfigureerd");
    const b = z
      .object({
        template_id: z.number().int().positive(),
        to: z.string().email(),
      })
      .parse(req.body);
    const t = (
        await query("SELECT * FROM templates WHERE id=?", [b.template_id])
      )[0],
      c = (
        await query(
          "SELECT c.*,cl.name client FROM cases c JOIN clients cl ON cl.id=c.client_id WHERE c.id=?",
          [id],
        )
      )[0];
    if (!t || !c) throw fail(404, "Template of dossier niet gevonden");
    const subject = render(t.subject, c),
      body = render(t.body, c);
    const r = await query(
      "INSERT INTO emails(case_id,direction,subject,sender,recipients,body,status) VALUES (?,?,?,?,?,?,?)",
      [id, "out", subject, config.smtp.from, b.to, body, "sending"],
    );
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: !config.smtp.secure,
      auth: config.smtp.username
        ? { user: config.smtp.username, pass: config.smtp.password }
        : undefined,
    });
    try {
      await transport.sendMail({
        from: config.smtp.from,
        to: b.to,
        subject,
        text: body,
      });
      await query("UPDATE emails SET status='sent' WHERE id=?", [r.insertId]);
    } catch (e) {
      await query("UPDATE emails SET status='failed' WHERE id=?", [r.insertId]);
      throw fail(
        502,
        "Verzending mislukt; controleer SMTP en de verzendstatus",
      );
    } finally {
      transport.close();
    }
    await audit(req.user, "email.send", r.insertId);
    res.json({ id: r.insertId });
  });
}
