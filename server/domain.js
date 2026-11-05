import path from "node:path";
export const permissions = [
  "crm.read",
  "crm.write",
  "case.read",
  "case.write",
  "document.read",
  "document.write",
  "document.open",
  "email.read",
  "email.import",
  "email.send",
  "metadata.write",
];
export function allowed(rules, permission, caseId, parentId) {
  const matches = rules.filter(
    (r) =>
      r.permission === permission &&
      (r.case_id == null || r.case_id === caseId || r.case_id === parentId),
  );
  return (
    matches.some((r) => r.effect === "allow") &&
    !matches.some((r) => r.effect === "deny")
  );
}
export function numbered(period, sequence, width) {
  if (sequence >= 10 ** width)
    throw new Error("Maandelijkse nummerreeks is vol");
  return `${period}${String(sequence).padStart(width, "0")}.00`;
}
export function childNumber(number, sub) {
  if (!Number.isInteger(sub) || sub < 1 || sub > 99)
    throw new Error("Maximaal 99 subdossiers");
  return number.replace(/\.00$/, "") + "." + String(sub).padStart(2, "0");
}
export function safePath(root, key) {
  if (
    !key ||
    key.includes("\\") ||
    key.split("/").some((s) => s === ".." || s === ".") ||
    path.isAbsolute(key)
  )
    throw new Error("Ongeldig bestandspad");
  const target = path.resolve(root, key);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw new Error("Ongeldig bestandspad");
  return target;
}
export function safeName(name) {
  return (
    path
      .basename(name.replaceAll("\\", "/"))
      .replace(/[^\p{L}\p{N}._ -]/gu, "_")
      .slice(-180) || "document"
  );
}
export function render(template, data) {
  return template.replace(
    /\{\{\s*(client|number|title)\s*\}\}/g,
    (_, key) => data[key] ?? "",
  );
}
