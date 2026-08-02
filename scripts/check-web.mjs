import { access, readFile } from "node:fs/promises";

const files = ["apps/web/index.html", "apps/web/styles.css", "apps/web/app.js"];
for (const file of files) await access(file);
const html = await readFile("apps/web/index.html", "utf8");
const js = await readFile("apps/web/app.js", "utf8");
for (const marker of [
  'id="main"',
  'aria-label="Primary navigation"',
  'id="connect-dialog"',
]) {
  if (!html.includes(marker))
    throw new Error(`Web contract missing: ${marker}`);
}
for (const marker of [
  "/v1/operations/summary",
  "/v1/operations/audit",
  "localStorage",
]) {
  if (!js.includes(marker))
    throw new Error(`Web data contract missing: ${marker}`);
}
console.log(`Web UI contract passed (${files.length} source files).`);
