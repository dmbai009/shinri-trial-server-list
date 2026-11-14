export const validDate = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
export function stateOf(server, snapshot, staleMinutes, now = Date.now()) {
  const row = snapshot?.servers?.[server.id];
  if (
    !row ||
    row.address !== server.address ||
    (row.queryPort ?? null) !== (server.queryPort ?? null)
  )
    return { kind: "unknown", row: null };
  const age = validDate(row.lastSuccessAt)
    ? now - Date.parse(row.lastSuccessAt)
    : Infinity;
  if (
    row.status === "online" &&
    row.data &&
    age <= staleMinutes * 60000 &&
    age >= -60000
  )
    return { kind: "online", row };
  return { kind: row.data ? "stale" : "unreachable", row };
}
export function snapshotIsValid(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.servers !== "object" ||
    value.servers === null ||
    Array.isArray(value.servers) ||
    !(value.generatedAt === null || validDate(value.generatedAt))
  )
    return false;
  for (const row of Object.values(value.servers)) {
    if (
      !row ||
      !["online", "unreachable"].includes(row.status) ||
      typeof row.address !== "string" ||
      !validDate(row.checkedAt) ||
      !(row.lastSuccessAt === null || validDate(row.lastSuccessAt))
    )
      return false;
    const data = row.data;
    if (
      data !== null &&
      (!data ||
        typeof data.name !== "string" ||
        typeof data.map !== "string" ||
        !["numplayers", "maxplayers"].every(
          (key) =>
            data[key] === null ||
            (Number.isFinite(data[key]) && data[key] >= 0),
        ) ||
        !(
          data.players === null ||
          (Array.isArray(data.players) &&
            data.players.every((p) => p && typeof p.name === "string"))
        ))
    )
      return false;
    if (row.status === "online" && (!data || !validDate(row.lastSuccessAt)))
      return false;
  }
  return true;
}
export function visibleServers(
  config,
  category,
  search,
  snapshot,
  onlyAvailable,
  now = Date.now(),
) {
  const term = search.trim().toLocaleLowerCase();
  return config.servers.filter((server) => {
    const state = stateOf(
      server,
      snapshot,
      config.settings.staleAfterMinutes,
      now,
    );
    const text =
      `${server.name} ${server.address} ${state.row?.data?.name || ""} ${state.row?.data?.map || ""}`.toLocaleLowerCase();
    return (
      (category === "all" || server.categories.includes(category)) &&
      (!term || text.includes(term)) &&
      (!onlyAvailable || state.kind === "online")
    );
  });
}
