import { configArguments } from "../server/config.js";
import { config } from "../server/runtime-config.js";
import { createUser } from "../server/user-create.js";
const { rest } = configArguments();
let password = "";
for await (const chunk of process.stdin) password += chunk;
// Strip only the terminal newline, not intentional password spaces.
password = password.replace(/\r?\n$/, "");
try {
  if (rest.length !== 1)
    throw Error(
      "Gebruik: npm run admin -- gebruikersnaam < wachtwoordbestand (min. 12 tekens)",
    );
  await createUser(config.sql, { username: rest[0], password, admin: true });
  console.log("Beheerder aangemaakt");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
