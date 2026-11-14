import { cp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
let repository = process.env.GITHUB_REPOSITORY;
if (!repository) {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    repository = remote.match(
      /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
    )?.[1];
  } catch {
    /* A source archive without Git uses the local preview descriptor. */
  }
}
if (repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid GITHUB_REPOSITORY");
  await writeFile(
    "dist/data/source.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        statusUrl: `https://raw.githubusercontent.com/${repository}/server-data/status.json`,
        diagnosticsUrl: `https://github.com/${repository}/actions/workflows/update-status.yml`,
      },
      null,
      2,
    ) + "\n",
  );
}
// The deployed site never contains an accidentally frozen statistics snapshot.
if (repository) await rm("dist/data/status.json", { force: true });
// Fingerprint frontend code so browsers do not mix files from different deployments.
// Snapshot-only deployments keep the same fingerprint and reuse cached code.
const modules = (await readdir("src"))
  .filter((name) => name.endsWith(".js"))
  .sort();
const inputs = [
  "index.html",
  "styles.css",
  ...modules.map((name) => `src/${name}`),
];
const hash = createHash("sha256");
for (const file of inputs) hash.update(await readFile(file));
const version = hash.digest("hex").slice(0, 12);
let html = await readFile("dist/index.html", "utf8");
html = html
  .replace('./styles.css"', `./styles.css?v=${version}"`)
  .replace('./src/app.js"', `./src/app.js?v=${version}"`);
await writeFile("dist/index.html", html);
for (const name of modules) {
  const file = `dist/src/${name}`;
  const source = await readFile(file, "utf8");
  await writeFile(
    file,
    source.replace(
      /from (["'])(\.\/[^"']+\.js)\1/g,
      (_, quote, path) => `from ${quote}${path}?v=${version}${quote}`,
    ),
  );
}
console.log("Static site ready in dist/");
