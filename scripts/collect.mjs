import { fork, execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { validateConfig } from "../src/config.js";
import { collectSnapshot } from "./collector-core.mjs";
const config = validateConfig(
  JSON.parse(await readFile("servers.json", "utf8")),
);
let previous;
try {
  previous = JSON.parse(await readFile("data/status.json", "utf8"));
} catch {
  /* First run. */
}
let configUpdatedAt = null;
try {
  configUpdatedAt =
    execFileSync("git", ["log", "-1", "--format=%cI", "--", "servers.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
} catch {
  /* An uncommitted local checkout has no history. */
}
function query(options) {
  return new Promise((resolve, reject) => {
    // Each query owns its sockets. Killing the child enforces a real deadline, including stuck dependencies.
    const child = fork(new URL("./query-worker.mjs", import.meta.url), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve(data);
    };
    const timer = setTimeout(
      () => finish(new Error("Query deadline exceeded")),
      11000,
    );
    child.once("error", finish);
    child.once("exit", () => finish(new Error("Query process exited")));
    child.once("message", (result) =>
      finish(result.ok ? null : new Error("No response"), result.data),
    );
    child.send(options);
  });
}
const snapshot = await collectSnapshot(config, previous, query, {
  configUpdatedAt,
});
await mkdir("data", { recursive: true });
await writeFile(
  "data/status.json.tmp",
  JSON.stringify(snapshot, null, 2) + "\n",
);
await rename("data/status.json.tmp", "data/status.json");
const online = Object.values(snapshot.servers).filter(
  (s) => s.status === "online",
).length;
console.log(
  `Checked ${config.servers.length} servers: ${online} replied, ${config.servers.length - online} unreachable. Snapshot: ${snapshot.generatedAt}`,
);
