import crypto from "node:crypto";
import { query } from "./db.js";
import { allowed } from "./domain.js";
export const hash = (text) =>
  crypto.createHash("sha256").update(text).digest("hex");
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
export async function session(token) {
  if (!token) return null;
  return (
    await query(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.active=1",
      [hash(token)],
    )
  )[0];
}
export async function authenticate(req, res, next) {
  try {
    req.user = await session(req.cookies.sid);
    if (!req.user) throw fail(401, "Log eerst in");
    next();
  } catch (e) {
    next(e);
  }
}
export async function can(user, permission, caseId = null) {
  if (user.admin) return true;
  const c = caseId
    ? (await query("SELECT parent_id FROM cases WHERE id=?", [caseId]))[0]
    : null;
  const rules = await query(
    "SELECT a.* FROM acl a JOIN user_roles ur ON ur.role_id=a.role_id WHERE ur.user_id=?",
    [user.id],
  );
  return allowed(rules, permission, caseId, c?.parent_id);
}
export async function requirePermission(user, permission, caseId = null) {
  if (!(await can(user, permission, caseId)))
    throw fail(403, "Onvoldoende rechten");
}
