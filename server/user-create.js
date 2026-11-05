import mysql from "mysql2/promise";
import argon2 from "argon2";

export function validateUsername(username) {
  if (
    typeof username !== "string" ||
    !username.trim() ||
    username !== username.trim() ||
    username.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(username)
  )
    throw Error(
      "Gebruikersnaam moet 1–100 tekens bevatten, zonder randspaties of controletekens.",
    );
  return username;
}
export async function createUser(
  sql,
  { username, password, admin = false },
  { connect = mysql.createConnection } = {},
) {
  validateUsername(username);
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1000
  )
    throw Error("Wachtwoord moet 12–1000 tekens bevatten.");
  if (typeof admin !== "boolean") throw Error("Ongeldig gebruikerstype.");
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const connection = await connect({
    host: sql.host,
    port: sql.port,
    user: sql.username,
    password: sql.password,
    database: sql.database,
    connectTimeout: 10000,
  });
  try {
    const [result] = await connection.execute(
      "INSERT INTO users(username,password_hash,admin) VALUES (?,?,?)",
      [username, passwordHash, admin],
    );
    return { id: result.insertId, username, admin };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      throw Error(
        "Gebruikersnaam bestaat al; het bestaande account is niet gewijzigd.",
      );
    if (error.code === "ER_NO_SUCH_TABLE")
      throw Error("Gebruikerstabel ontbreekt. Voer eerst db init uit.");
    throw error;
  } finally {
    await connection.end();
  }
}
