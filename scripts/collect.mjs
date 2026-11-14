import { fork, execFileSync } from "node:child_process";
import {
  readFile,
  mkdir,
  writeFile,
  rename,
  appendFile,
} from "node:fs/promises";
import { validateConfig } from "../src/config.js";
import { collectSnapshot, contentChanges } from "./collector-core.mjs";
import { snapshotIsValid } from "../src/model.js";
const started = Date.now();
const config = validateConfig(
  JSON.parse(await readFile("servers.json", "utf8")),
);
let previous;
try {
  previous = JSON.parse(await readFile("data/status.json", "utf8"));
  if (!snapshotIsValid(previous)) throw new Error("Invalid previous snapshot");
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
const successful = Object.values(snapshot.servers).filter(
  (row) => row.status === "online",
).length;
const gapSeconds = previous?.generatedAt
  ? Math.max(
      0,
      Math.round(
        (Date.parse(snapshot.generatedAt) - Date.parse(previous.generatedAt)) /
          1000,
      ),
    )
  : null;
snapshot.collection = {
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  successful,
  failed: config.servers.length - successful,
  previousGeneratedAt: previous?.generatedAt ?? null,
  gapSeconds,
  ...contentChanges(snapshot.servers, previous),
  runUrl: process.env.COLLECT_RUN_URL ?? null,
  trigger: process.env.COLLECT_TRIGGER ?? "local",
  revision: process.env.COLLECT_REVISION ?? null,
};
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
console.log(
  `Content changes: ${snapshot.collection.changedServers} servers; ${snapshot.collection.changedPlayerCounts} player counts; ${snapshot.collection.changedPlayerLists} player-name lists. SHA-256: ${snapshot.collection.contentHash}`,
);
if (gapSeconds > config.settings.staleAfterMinutes * 60)
  console.log(
    `::warning::Collection gap was ${Math.round(gapSeconds / 60)} minutes. Inspect scheduled workflow dispatches.`,
  );
if (!successful && config.servers.length)
  console.log(
    "::warning::All queries failed; retained successful data is explicitly stale. Check runner UDP connectivity.",
  );
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Server statistics collection",
      "",
      `- Trigger: ${snapshot.collection.trigger}`,
      `- Completed (UTC): ${snapshot.generatedAt}`,
      `- Previous snapshot (UTC): ${previous?.generatedAt ?? "none"}`,
      `- Gap: ${gapSeconds ?? "n/a"} seconds (target: about 300 seconds)`,
      `- Replied: ${successful}/${config.servers.length}; failed: ${snapshot.collection.failed}`,
      `- Changed server payloads: ${snapshot.collection.changedServers}`,
      `- Changed populations: ${snapshot.collection.changedPlayerCounts}`,
      `- Changed public player-name lists: ${snapshot.collection.changedPlayerLists}`,
      `- Content SHA-256 (timestamps excluded): ${snapshot.collection.contentHash}`,
      "",
      "An unchanged payload can be legitimate. Last-success times never advance on failed queries.",
      "",
    ].join("\n"),
  );
}
