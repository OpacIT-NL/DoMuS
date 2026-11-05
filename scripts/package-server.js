import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export function releaseVersion(value) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      value,
    )
  )
    throw Error(
      "Ongeldige versie; gebruik bijvoorbeeld 0.1.0 of 0.2.0-beta.1.",
    );
  return value;
}
// Deliberate allowlist: never archive a checkout or a deployment directory wholesale.
const files = [
  "README.md",
  "SERVER-INSTALL.md",
  "THIRD_PARTY_NOTICES.md",
  "licenses/Phidias-GPL-3.0.txt",
  "scripts/admin.js",
  "scripts/cli.js",
  "scripts/migrate.js",
];
const trees = {
  server: new Set([".js", ".sql"]),
  public: new Set([".html", ".css", ".js"]),
};
export async function packageServer({
  root = projectRoot,
  output = path.join(root, "dist"),
  version,
} = {}) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  version = releaseVersion(version ?? manifest.version);
  const lock = JSON.parse(
    await fs.readFile(path.join(root, "package-lock.json"), "utf8"),
  );
  const archive = {};
  async function add(name) {
    const full = path.join(root, name),
      stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error(`Geen regulier pakketbestand: ${name}`);
    archive[name] = new Uint8Array(await fs.readFile(full));
  }
  for (const name of files) await add(name);
  async function walk(relative, extensions) {
    if ((await fs.lstat(path.join(root, relative))).isSymbolicLink())
      throw Error(`Symlink niet toegestaan: ${relative}`);
    for (const entry of await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (
        entry.name.startsWith(".") ||
        ["node_modules", "data", "dist"].includes(entry.name)
      )
        continue;
      const name = relative + "/" + entry.name;
      if (entry.isSymbolicLink())
        throw Error(`Symlink niet toegestaan: ${name}`);
      if (entry.isDirectory()) await walk(name, extensions);
      else if (extensions.has(path.extname(entry.name))) await add(name);
    }
  }
  for (const [tree, extensions] of Object.entries(trees))
    await walk(tree, extensions);
  manifest.version = version;
  // The server release exposes only commands whose files are included.
  manifest.scripts = Object.fromEntries(
    ["start", "cli", "migrate", "admin"].map((key) => [
      key,
      manifest.scripts[key],
    ]),
  );
  delete manifest.devDependencies;
  lock.version = version;
  lock.packages[""].version = version;
  delete lock.packages[""].devDependencies;
  // Build-only dependencies do not belong in the installed server package.
  for (const [key, value] of Object.entries(lock.packages))
    if (value.dev === true) delete lock.packages[key];
  for (const [name, value] of [
    ["package.json", manifest],
    ["package-lock.json", lock],
  ])
    archive[name] = new TextEncoder().encode(
      JSON.stringify(value, null, 2) + "\n",
    );
  await fs.mkdir(output, { recursive: true });
  const target = path.resolve(output, `domus-server-${version}.zip`);
  await fs.writeFile(target, zipSync(archive, { level: 9 }));
  return { file: target, entries: Object.keys(archive).sort() };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2),
      options = {};
    for (let i = 0; i < args.length; i++) {
      if (!["--version", "--output"].includes(args[i]) || !args[i + 1])
        throw Error(
          "Gebruik: npm run package:server -- [--version 0.1.0] [--output dist]",
        );
      const key = args[i].slice(2);
      options[key] = args[++i];
    }
    const result = await packageServer(options);
    console.log(
      `Serverpakket: ${result.file} (${result.entries.length} bestanden; geen bovenliggende map)`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
