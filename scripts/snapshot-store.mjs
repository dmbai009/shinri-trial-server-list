import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const branch = "refs/heads/server-data";
const git = (args, options = {}) =>
  execFileSync("git", args, { encoding: "utf8", ...options });
if (process.argv[2] === "restore") {
  const result = spawnSync(
    "git",
    ["ls-remote", "--exit-code", "origin", branch],
    { encoding: "utf8" },
  );
  if (![0, 2].includes(result.status))
    throw new Error(`Cannot read snapshot branch: ${result.stderr}`);
  const sha = result.status === 0 ? result.stdout.trim().split(/\s+/)[0] : "";
  await mkdir(".cache", { recursive: true });
  await writeFile(".cache/snapshot-ref", sha);
  if (sha) {
    git(["fetch", "--no-tags", "--depth=1", "origin", branch]);
    const previous = git(["show", `${sha}:status.json`]);
    JSON.parse(previous);
    await writeFile("data/status.json", previous);
    console.log("Restored previous snapshot.");
  } else console.log("First run: no previous snapshot branch.");
} else if (process.argv[2] === "save") {
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
