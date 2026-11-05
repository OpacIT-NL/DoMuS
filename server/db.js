import mysql from "mysql2/promise";
import { config } from "./runtime-config.js";
export const db = mysql.createPool({
  host: config.sql.host,
  port: config.sql.port,
  user: config.sql.username,
  password: config.sql.password,
  database: config.sql.database,
});
export async function query(sql, args = [], connection = db) {
  const [rows] = await connection.execute(sql, args);
  return rows;
}
export async function transaction(fn) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export const audit = (user, action, entity) =>
  query("INSERT INTO audit(user_id,action,entity) VALUES (?,?,?)", [
    user.id,
    action,
    String(entity),
  ]);
