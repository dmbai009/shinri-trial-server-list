import { cp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import "./validate.mjs";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const name of [
  "index.html",
  "styles.css",
  "src",
  "servers.json",
  "data",
]) {
  await cp(name, `dist/${name}`, { recursive: true });
}
await cp(".nojekyll", "dist/.nojekyll");
// Fingerprint frontend code so browsers do not mix files from different deployments.
// Snapshot-only deployments keep the same fingerprint and reuse cached code.
const modules = (await readdir("src")).filter(name => name.endsWith(".js")).sort();
const inputs = ["index.html", "styles.css", ...modules.map(name => `src/${name}`)];
const hash = createHash("sha256");
for (const file of inputs) hash.update(await readFile(file));
const version = hash.digest("hex").slice(0, 12);
let html = await readFile("dist/index.html", "utf8");
html = html.replace('./styles.css"', `./styles.css?v=${version}"`).replace('./src/app.js"', `./src/app.js?v=${version}"`);
await writeFile("dist/index.html", html);
for (const name of modules) {
  const file = `dist/src/${name}`;
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace(/from (["'])(\.\/[^"']+\.js)\1/g, (_, quote, path) => `from ${quote}${path}?v=${version}${quote}`));
}
console.log("Static site ready in dist/");
