import { ConfigState, configArguments } from "../server/config.js";
import { CommandConsole } from "../server/console.js";
import { Terminal } from "../server/terminal.js";
try {
  const { file, rest } = configArguments();
  if (rest.length) throw Error("Gebruik: npm run cli -- [--config <bestand>]");
  const config = new ConfigState(file),
    terminal = new Terminal();
  const engine = new CommandConsole({
    config,
    closeSession: async () => {},
    ask: (...args) => terminal.ask(...args),
    write: (message) => terminal.write(message),
    status: () => "Configuratieconsole; webserver draait in een apart proces.",
  });
  terminal.write("DoMuS console. Type help or enable.");
  await terminal.run(engine);
  if (config.dirty())
    terminal.write("Niet-opgeslagen wijzigingen zijn niet bewaard.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
