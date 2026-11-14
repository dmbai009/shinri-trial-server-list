const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function parseAddress(address) {
  if (typeof address !== "string")
    throw new Error("Server address must be a string");
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(address);
  if (
    !match ||
    match[1].split(".").some((n) => Number(n) > 255) ||
    +match[2] < 1 ||
    +match[2] > 65535
  ) {
    throw new Error(`Invalid IPv4:port address: ${address}`);
  }
  return { host: match[1], port: +match[2] };
}
export function validateConfig(config) {
  if (!config || config.schemaVersion !== 1)
    throw new Error("Unsupported config schemaVersion");
  if (!Array.isArray(config.categories) || !Array.isArray(config.servers))
    throw new Error("categories and servers must be arrays");
  const categories = new Set();
  for (const category of config.categories) {
    if (
      !idPattern.test(category.id) ||
      category.id === "all" ||
      categories.has(category.id)
    )
      throw new Error("Invalid or duplicate category ID");
    if (
      typeof category.label !== "string" ||
      !category.label.trim() ||
      category.label.length > 40
    )
      throw new Error("Invalid category label");
    categories.add(category.id);
  }
  const ids = new Set(),
    addresses = new Set();
  for (const server of config.servers) {
    if (!idPattern.test(server.id) || ids.has(server.id))
      throw new Error("Invalid or duplicate server ID");
    parseAddress(server.address);
    if (addresses.has(server.address))
      throw new Error("Duplicate server address");
    if (
      typeof server.name !== "string" ||
      !server.name.trim() ||
      server.name.length > 160
    )
      throw new Error("Invalid server name");
    if (
      !Array.isArray(server.categories) ||
      !server.categories.length ||
      server.categories.some((c) => !categories.has(c))
    )
      throw new Error(`Unknown or missing category for ${server.id}`);
    if (
      server.queryPort !== undefined &&
      (!Number.isInteger(server.queryPort) ||
        server.queryPort < 1 ||
        server.queryPort > 65535)
    )
      throw new Error("Invalid queryPort");
    ids.add(server.id);
    addresses.add(server.address);
  }
  if (
    !config.settings ||
    !Number.isInteger(config.settings.pollSeconds) ||
    config.settings.pollSeconds < 30 ||
    config.settings.pollSeconds > 3600
  )
    throw new Error("pollSeconds must be 30–3600");
  if (
    !Number.isInteger(config.settings.staleAfterMinutes) ||
    config.settings.staleAfterMinutes < 5 ||
    config.settings.staleAfterMinutes > 1440
  )
    throw new Error("staleAfterMinutes must be 5–1440");
  const token = config.settings.cloudflareToken;
  if (token && !/^[a-f0-9]{32}$/i.test(token))
    throw new Error("Invalid Cloudflare beacon token");
  return config;
}
