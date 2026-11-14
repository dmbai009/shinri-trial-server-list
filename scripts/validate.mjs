import { readFile } from "node:fs/promises";
import { validateConfig } from "../src/config.js";
const config = validateConfig(
  JSON.parse(await readFile("servers.json", "utf8")),
);
console.log(
  `Configuration valid: ${config.servers.length} servers, ${config.categories.length} categories. Array order is display order.`,
);
