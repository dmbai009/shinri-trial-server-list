import { GameDig } from "gamedig";
process.on("message", async (options) => {
  try {
    const data = await GameDig.query({
      type: "garrysmod",
      ...options,
      givenPortOnly: true,
      maxRetries: 0,
      socketTimeout: 2000,
      attemptTimeout: 7000,
      requestPlayers: true,
      requestPlayersRequired: false,
      requestRules: false,
    });
    process.send({ ok: true, data }, () => process.exit(0));
  } catch {
    process.send({ ok: false }, () => process.exit(0));
  }
});
