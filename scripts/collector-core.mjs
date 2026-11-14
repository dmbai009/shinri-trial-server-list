import { parseAddress } from "../src/config.js";
import { validDate } from "../src/model.js";
const text = (value, length = 200) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, length)
    : "";
const number = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
export function normalizeData(state) {
  const players = Array.isArray(state.players)
    ? state.players
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .slice(0, 256)
        .map((p) => ({
          name: text(p.name, 100),
          score: Number.isFinite(p.score ?? p.raw?.score)
            ? (p.score ?? p.raw.score)
            : null,
          time: number(p.time ?? p.raw?.time),
        }))
    : [];
  return {
    name: text(state.name),
    map: text(state.map, 120),
    numplayers: number(state.numplayers),
    maxplayers: number(state.maxplayers),
    password: state.password === true,
    // Empty/anonymous lists cannot prove that A2S_PLAYER succeeded. Never infer names or fake an empty server.
    players: players.length ? players : null,
  };
}
export async function collectSnapshot(
  config,
  previous,
  query,
  {
    now = () => new Date().toISOString(),
    concurrency = 10,
    configUpdatedAt = null,
  } = {},
) {
  const rows = new Array(config.servers.length);
  let cursor = 0;
  async function worker() {
    while (cursor < config.servers.length) {
      const index = cursor++,
        server = config.servers[index],
        address = parseAddress(server.address);
      const old = previous?.servers?.[server.id];
      const reusable =
        old?.address === server.address &&
        (old.queryPort ?? null) === (server.queryPort ?? null) &&
        old.data &&
        validDate(old.lastSuccessAt);
      const base = {
        address: server.address,
        queryPort: server.queryPort ?? null,
      };
      try {
        const result = await query({
          ...address,
          port: server.queryPort ?? address.port,
        });
        const timestamp = now();
        rows[index] = [
          server.id,
          {
            ...base,
            status: "online",
            checkedAt: timestamp,
            lastSuccessAt: timestamp,
            data: normalizeData(result),
          },
        ];
      } catch {
        rows[index] = [
          server.id,
          {
            ...base,
            status: "unreachable",
            checkedAt: now(),
            lastSuccessAt: reusable ? old.lastSuccessAt : null,
            data: reusable ? old.data : null,
          },
        ];
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, config.servers.length) },
      worker,
    ),
  );
  const timestamps = rows
    .map(([, row]) => row.lastSuccessAt)
    .filter(validDate)
    .sort();
  return {
    schemaVersion: 1,
    generatedAt: now(),
    lastSuccessAt: timestamps.at(-1) ?? null,
    configUpdatedAt,
    servers: Object.fromEntries(rows),
  };
}
