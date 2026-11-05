const path = require("node:path");
const fs = require("node:fs/promises");
async function resolveDocument(root, key) {
  if (
    typeof key !== "string" ||
    !key ||
    key.includes("\\") ||
    key.includes(":") ||
    key.split("/").some((s) => !s || s === "." || s === "..") ||
    path.isAbsolute(key)
  )
    throw Error("Ongeldig documentpad");
  const base = await fs.realpath(root),
    candidate = await fs.realpath(path.resolve(base, ...key.split("/"))),
    relative = path.relative(base, candidate);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw Error("Document ligt buiten de ingestelde share");
  if (!(await fs.stat(candidate)).isFile()) throw Error("Geen bestand");
  const allowed = new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".odt",
    ".xls",
    ".xlsx",
    ".ods",
    ".ppt",
    ".pptx",
    ".odp",
    ".txt",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".eml",
    ".msg",
  ]);
  if (!allowed.has(path.extname(candidate).toLowerCase()))
    throw Error("Dit bestandstype mag niet automatisch worden geopend");
  return candidate;
}
module.exports = { resolveDocument };
