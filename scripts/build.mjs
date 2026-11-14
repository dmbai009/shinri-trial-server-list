import { cp, mkdir, rm } from "node:fs/promises";
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
console.log("Static site ready in dist/");
