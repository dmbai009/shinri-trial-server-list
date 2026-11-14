import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateConfig, parseAddress } from "../src/config.js";
import { stateOf, visibleServers, snapshotIsValid } from "../src/model.js";
import { collectSnapshot, normalizeData } from "../scripts/collector-core.mjs";
import { initialLanguage, messages } from "../src/i18n.js";
const shippedConfig = JSON.parse(
  await readFile(new URL("../servers.json", import.meta.url), "utf8"),
);
const config = {
  schemaVersion: 1,
  settings: { pollSeconds: 60, staleAfterMinutes: 15, cloudflareToken: "" },
  categories: [
    { id: "ru", label: "RU" },
    { id: "global", label: "Global" },
    { id: "media", label: "Media" },
  ],
  servers: [
    {
      id: "ru-1",
      name: "RU #1",
      address: "185.71.66.223:28015",
      categories: ["ru"],
    },
    {
      id: "ru-2",
      name: "RU #2",
      address: "185.71.66.87:28015",
      categories: ["ru"],
    },
    {
      id: "ru-3",
      name: "RU #3",
      address: "185.71.66.223:28017",
      categories: ["ru"],
    },
    {
      id: "global-1",
      name: "Global #1",
      address: "203.23.179.220:27015",
      categories: ["global"],
    },
    {
      id: "media-1",
      name: "Media 1",
      address: "185.71.66.223:28128",
      categories: ["media"],
    },
  ],
};
const at = "2026-11-14T00:00:00.000Z";
const now = Date.parse(at);
const sample = {
  name: "Real name",
  map: "trial_map",
  numplayers: 3,
  maxplayers: 32,
  ping: 21,
  players: [{ name: "A", score: 1 }],
};
const smaller = () => ({ ...config, servers: config.servers.slice(0, 3) });
test("repository configuration is valid; editing the roster does not require changing tests", () => {
  validateConfig(shippedConfig);
});
test("configuration rejects unsafe addresses, duplicate IDs and unknown categories", () => {
  for (const address of [
    "256.1.1.1:12",
    "127.0.0.1:0",
    "1.2.3.4:65536",
    'evil/"onclick:80',
    "1.2.3.4:2/",
  ])
    assert.throws(() => parseAddress(address));
  const c = smaller();
  c.servers = [c.servers[0], c.servers[0]];
  assert.throws(() => validateConfig(c));
  const other = structuredClone(smaller());
  other.servers[0].categories = ["missing"];
  assert.throws(() => validateConfig(other));
});
test("custom categories and multiple memberships work without sorting", () => {
  const c = structuredClone(smaller());
  c.categories.push({ id: "events", label: "Events" });
  c.servers[1].categories.push("events");
  validateConfig(c);
  assert.equal(
    visibleServers(c, "events", "", null, false)[0].id,
    c.servers[1].id,
  );
  assert.deepEqual(
    visibleServers(c, "ru", "", null, false).map((s) => s.id),
    c.servers.map((s) => s.id),
  );
});
test("parallel query completion never changes order; individual failures preserve old success", async () => {
  const c = smaller();
  let active = 0,
    peak = 0;
  const previous = {
    servers: {
      [c.servers[1].id]: {
        address: c.servers[1].address,
        queryPort: null,
        lastSuccessAt: at,
        data: normalizeData(sample),
      },
    },
  };
  const snapshot = await collectSnapshot(
    c,
    previous,
    async ({ host, port }) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) =>
        setTimeout(resolve, port === 28015 ? 30 : 2),
      );
      active--;
      if (host === "185.71.66.87") throw new Error("timeout");
      return sample;
    },
    { now: () => at, concurrency: 3 },
  );
  assert.equal(peak, 3);
  assert.deepEqual(
    Object.keys(snapshot.servers),
    c.servers.map((s) => s.id),
  );
  const stale = snapshot.servers[c.servers[1].id];
  assert.equal(stale.status, "unreachable");
  assert.equal(stale.lastSuccessAt, at);
  assert.equal(stale.data.name, "Real name");
  assert.equal(stateOf(c.servers[1], snapshot, 15, now).kind, "stale");
});
test("changing an address or query port invalidates previous data", async () => {
  const c = smaller(),
    s = c.servers[0];
  const previous = {
    servers: {
      [s.id]: {
        address: "1.2.3.4:12",
        queryPort: null,
        lastSuccessAt: at,
        data: sample,
      },
    },
  };
  const snapshot = await collectSnapshot(
    c,
    previous,
    async () => {
      throw new Error("down");
    },
    { now: () => at },
  );
  assert.equal(snapshot.servers[s.id].data, null);
  assert.equal(stateOf(s, previous, 15, now).kind, "unknown");
  previous.servers[s.id].address = s.address;
  previous.servers[s.id].queryPort = 12;
  assert.equal(stateOf(s, previous, 15, now).kind, "unknown");
});
test("old online results age into stale; no successful response stays unknown/unreachable", async () => {
  const c = smaller();
  const snapshot = await collectSnapshot(c, null, async () => sample, {
    now: () => at,
  });
  assert.equal(stateOf(c.servers[0], snapshot, 15, now).kind, "online");
  assert.equal(
    stateOf(c.servers[0], snapshot, 15, now + 16 * 60000).kind,
    "stale",
  );
  assert.equal(
    visibleServers(c, "all", "", snapshot, true, now + 16 * 60000).length,
    0,
  );
  const failed = await collectSnapshot(
    c,
    null,
    async () => {
      throw new Error("down");
    },
    { now: () => at },
  );
  assert.equal(failed.lastSuccessAt, null);
  assert.equal(stateOf(c.servers[0], failed, 15, now).kind, "unreachable");
});
test("player names are never synthesized; unknown player lists are null", () => {
  assert.equal(
    normalizeData({ ...sample, players: [{}, { name: "" }, { name: " " }] })
      .players,
    null,
  );
  assert.equal(normalizeData({ ...sample, players: undefined }).players, null);
  assert.equal(
    normalizeData({ ...sample, numplayers: 0, maxplayers: 0 }).numplayers,
    0,
  );
  assert.equal("ping" in normalizeData(sample), false);
  assert.deepEqual(
    normalizeData({
      ...sample,
      players: [{ name: "Actual name", raw: { score: 0, time: 123 } }],
    }).players,
    [{ name: "Actual name", score: 0, time: 123 }],
  );
  assert.equal(normalizeData({ ...sample, numplayers: NaN }).numplayers, null);
});
test("search uses actual server names, maps and IPs", async () => {
  const c = smaller(),
    snapshot = await collectSnapshot(c, null, async () => sample, {
      now: () => at,
    });
  assert.equal(
    visibleServers(c, "all", "REAL NAME", snapshot, false).length,
    3,
  );
  assert.equal(
    visibleServers(c, "all", "trial_map", snapshot, false).length,
    3,
  );
  assert.equal(visibleServers(c, "all", "28017", snapshot, false).length, 1);
});
test("all translation keys and placeholders are present in every language", () => {
  for (const language of ["ru", "uk"]) {
    assert.deepEqual(
      Object.keys(messages[language]).sort(),
      Object.keys(messages.en).sort(),
    );
    for (const key of Object.keys(messages.en))
      assert.deepEqual(
        messages[language][key].match(/\{\w+\}/g),
        messages.en[key].match(/\{\w+\}/g),
        `${language}: ${key}`,
      );
  }
  assert.equal(
    initialLanguage(
      {
        getItem: () => {
          throw new Error();
        },
      },
      ["uk-UA"],
    ),
    "uk",
  );
  assert.equal(initialLanguage(null, ["fr-FR"]), "en");
  assert.equal(initialLanguage({ getItem: () => "ru" }, ["en-US"]), "ru");
});
test("malformed snapshots are rejected", () => {
  assert.equal(
    snapshotIsValid({ schemaVersion: 1, servers: {}, generatedAt: null }),
    true,
  );
  assert.equal(
    snapshotIsValid({ schemaVersion: 1, servers: [], generatedAt: at }),
    false,
  );
  assert.equal(
    snapshotIsValid({ schemaVersion: 1, servers: {}, generatedAt: "invalid" }),
    false,
  );
  assert.equal(
    snapshotIsValid({
      schemaVersion: 1,
      servers: {
        bad: {
          address: "a",
          status: "online",
          checkedAt: at,
          lastSuccessAt: at,
          data: { players: {} },
        },
      },
      generatedAt: at,
    }),
    false,
  );
});
