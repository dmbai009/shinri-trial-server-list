import test from "node:test";
import assert from "node:assert/strict";
import {
  SnapshotClient,
  snapshotURL,
  sourceIsValid,
} from "../src/snapshot-client.js";
import { contentChanges } from "../scripts/collector-core.mjs";
const source = {
  schemaVersion: 1,
  statusUrl:
    "https://raw.githubusercontent.com/owner/repo/server-data/status.json",
};
const at = Date.parse("2026-11-14T10:00:00Z");
const row = (population, names, timestamp = new Date(at).toISOString()) => ({
  address: "1.2.3.4:27015",
  queryPort: null,
  status: "online",
  checkedAt: timestamp,
  lastSuccessAt: timestamp,
  data: {
    name: "Lobby",
    map: "trial",
    numplayers: population,
    maxplayers: 100,
    password: false,
    players: names?.map((name) => ({ name, score: 0, time: 0 })) ?? null,
  },
});
const snapshot = (timestamp, population, names) => ({
  schemaVersion: 1,
  generatedAt: timestamp,
  lastSuccessAt: timestamp,
  configUpdatedAt: null,
  servers: { one: row(population, names, timestamp) },
});
const response = (data) => ({
  ok: true,
  json: async () => structuredClone(data),
});
test("default browser fetch keeps its Window receiver", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function () {
    assert.equal(this, globalThis);
    return Promise.resolve(response(snapshot(new Date(at).toISOString(), 1, ["Actual player"])));
  };
  try { await new SnapshotClient(undefined, () => at).read(source); }
  finally { globalThis.fetch = original; }
});
test("CDN source is validated and minute cache keys are shared between visitors", () => {
  assert.equal(sourceIsValid(source), true);
  assert.equal(
    sourceIsValid({ schemaVersion: 1, statusUrl: "javascript:alert(1)" }),
    false,
  );
  assert.equal(
    sourceIsValid({
      schemaVersion: 1,
      statusUrl: "https://evil.example/status.json",
    }),
    false,
  );
  assert.equal(snapshotURL(source, 60000), snapshotURL(source, 119999));
  assert.notEqual(snapshotURL(source, 119999), snapshotURL(source, 120000));
  assert.ok(!snapshotURL(source, at).includes("api.github.com"));
});
test("open-page polling updates names and population, and unchanged responses keep object identity", async () => {
  let clock = at,
    payload = snapshot(new Date(at).toISOString(), 1, ["Alice"]);
  const urls = [];
  const client = new SnapshotClient(
    async (url, options) => {
      urls.push(url);
      assert.equal(options.cache, "no-cache");
      return response(payload);
    },
    () => clock,
  );
  const first = await client.read(source);
  const same = await client.read(source);
  assert.equal(same.changed, false);
  assert.equal(same.snapshot, first.snapshot);
  clock += 300000;
  payload = snapshot(new Date(clock).toISOString(), 2, ["Bob", "Charlie"]);
  const second = await client.read(source);
  assert.equal(second.changed, true);
  assert.equal(second.snapshot.servers.one.data.numplayers, 2);
  assert.deepEqual(
    second.snapshot.servers.one.data.players.map((p) => p.name),
    ["Bob", "Charlie"],
  );
  assert.notEqual(urls[0], urls.at(-1));
});
test("older CDN responses cannot roll the UI back", async () => {
  let payload = snapshot(new Date(at).toISOString(), 2, ["Bob"]);
  const client = new SnapshotClient(
    async () => response(payload),
    () => at,
  );
  const first = await client.read(source);
  payload = snapshot(new Date(at - 300000).toISOString(), 1, ["Alice"]);
  const second = await client.read(source);
  assert.equal(second.olderResponse, true);
  assert.equal(second.snapshot, first.snapshot);
});
test("fetch errors, throttling and malformed data retain the last success and back off", async () => {
  let next = response(snapshot(new Date(at).toISOString(), 1, ["Alice"]));
  const client = new SnapshotClient(
    async () => next,
    () => at,
  );
  await client.read(source);
  const previous = client.snapshot;
  next = { ok: false, status: 429, headers: { get: () => "120" } };
  await assert.rejects(() => client.read(source), /429/);
  assert.equal(client.snapshot, previous);
  assert.equal(client.delay(60), 120000);
  next = response({ schemaVersion: 1, generatedAt: "bad", servers: {} });
  await assert.rejects(() => client.read(source), /Invalid/);
  assert.equal(client.snapshot, previous);
  next = response(snapshot(new Date(at + 120000).toISOString(), 3, ["Future"]));
  await assert.rejects(() => client.read(source), /future/);
  assert.equal(client.snapshot, previous);
  next = response(snapshot(new Date(at).toISOString(), 1, ["Alice"]));
  await client.read(source);
  assert.equal(client.failures, 0);
  assert.equal(client.retryAt, 0);
});
test("diagnostic content hashes exclude timestamps but detect real names and population changes", () => {
  const old = snapshot(new Date(at).toISOString(), 2, ["A", "B"]);
  const same = { one: row(2, ["B", "A"], new Date(at + 300000).toISOString()) };
  const baseline = contentChanges(old.servers, old);
  const unchanged = contentChanges(same, old);
  assert.equal(unchanged.contentHash, baseline.contentHash);
  assert.equal(unchanged.changedPlayerLists, 0);
  assert.equal(unchanged.changedServers, 0);
  const namesChanged = contentChanges({ one: row(2, ["A", "C"]) }, old);
  assert.equal(namesChanged.changedPlayerLists, 1);
  assert.equal(namesChanged.changedPlayerCounts, 0);
  assert.notEqual(namesChanged.contentHash, baseline.contentHash);
  const populationChanged = contentChanges({ one: row(3, ["A", "B"]) }, old);
  assert.equal(populationChanged.changedPlayerCounts, 1);
});
