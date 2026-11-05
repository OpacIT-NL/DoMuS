import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Uses an independent connection so CLI edits do not depend on the webserver's pool.
// The existing schema uses CREATE TABLE IF NOT EXISTS and INSERT IGNORE: rerunning
// initialization preserves existing accounts, documents and settings.
export async function initializeDatabase(
  sql,
  { connect = mysql.createConnection } = {},
) {
  const statements = (
    await readFile(new URL("./schema.sql", import.meta.url), "utf8")
  )
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const connection = await connect({
    host: sql.host,
    port: sql.port,
    user: sql.username,
    password: sql.password,
    database: sql.database,
    connectTimeout: 10000,
  });
  const lock =
    "domus:init:" +
    createHash("sha256").update(sql.database).digest("hex").slice(0, 40);
  let locked = false;
  try {
    const [rows] = await connection.execute(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [lock],
    );
    if (Number(rows[0]?.acquired) !== 1)
      throw Error("Database-initialisatie is al bezig; probeer opnieuw.");
    locked = true;
    for (const statement of statements) await connection.execute(statement);
    return { statements: statements.length };
  } finally {
    try {
      if (locked) await connection.execute("SELECT RELEASE_LOCK(?)", [lock]);
    } finally {
      await connection.end();
    }
  }
}
