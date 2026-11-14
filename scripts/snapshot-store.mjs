import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { snapshotIsValid } from "../src/model.js";
const branch = "refs/heads/server-data";
const git = (args, options = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
if (process.argv[2] === "restore") {
  const result = spawnSync(
    "git",
    ["ls-remote", "--exit-code", "origin", branch],
    { encoding: "utf8", timeout: 30000 },
  );
  if (![0, 2].includes(result.status))
    throw new Error(`Cannot read snapshot branch: ${result.stderr}`);
  let sha = result.status === 0 ? result.stdout.trim().split(/\s+/)[0] : "";
  await mkdir(".cache", { recursive: true });
  if (sha) {
    git(["fetch", "--no-tags", "--depth=1", "origin", branch]);
    // Read the fetched ref, not a potentially outdated ls-remote result.
    sha = git(["rev-parse", "FETCH_HEAD"]).trim();
    const previous = git(["show", `${sha}:status.json`]);
    if (!snapshotIsValid(JSON.parse(previous)))
      throw new Error(
        "Stored snapshot is invalid; refusing to erase last known successes",
      );
    await writeFile("data/status.json", previous);
    console.log("Restored previous snapshot.");
  } else console.log("First run: no previous snapshot branch.");
  await writeFile(".cache/snapshot-ref", sha);
} else if (process.argv[2] === "save") {
  if (!snapshotIsValid(JSON.parse(await readFile("data/status.json", "utf8"))))
    throw new Error("Refusing to publish an invalid snapshot");
  const expected = (await readFile(".cache/snapshot-ref", "utf8")).trim();
  const blob = git(["hash-object", "-w", "data/status.json"]).trim();
  const tree = git(["mktree"], {
    input: `100644 blob ${blob}\tstatus.json\n`,
  }).trim();
  const commit = git(
    [
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit-tree",
      tree,
    ],
    { input: "Update server snapshot\n" },
  ).trim();
  // Only this generated branch is replaced. A parentless commit keeps player snapshots out of permanent history.
  git([
    "push",
    "origin",
    `${commit}:${branch}`,
    `--force-with-lease=${branch}:${expected}`,
  ]);
  console.log("Saved the latest snapshot to server-data.");
} else throw new Error("Use restore or save");
