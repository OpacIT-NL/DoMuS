import { config } from "../server/runtime-config.js";
import { initializeDatabase } from "../server/database-init.js";
try {
  await initializeDatabase(config.sql);
  console.log("Schema gereed");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
