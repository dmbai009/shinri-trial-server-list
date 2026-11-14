import { snapshotIsValid } from "./model.js";

export function sourceIsValid(source) {
  if (source?.schemaVersion !== 1 || typeof source.statusUrl !== "string")
    return false;
  return (
    source.statusUrl === "./data/status.json" ||
    /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/server-data\/status\.json$/.test(
      source.statusUrl,
    )
  );
}

export function snapshotURL(source, now = Date.now()) {
  // All visitors share one CDN key per minute. Do not consume the REST API's
  // unauthenticated per-IP quota or send a credential to visitors.
  return `${source.statusUrl}?v=${Math.floor(now / 60000)}`;
}

export class SnapshotClient {
  constructor(fetcher = (...args) => globalThis.fetch(...args), now = Date.now) {
    this.fetcher = fetcher;
    this.now = now;
    this.snapshot = null;
    this.signature = null;
    this.failures = 0;
    this.retryAt = 0;
    this.lastFetchedAt = null;
  }
  async read(source) {
    try {
      const response = await this.fetcher(snapshotURL(source, this.now()), {
        cache: "no-cache",
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        const retry = response.headers.get("retry-after");
        const seconds = Number(retry);
        if (retry)
          error.retryAfter = Number.isFinite(seconds)
            ? seconds * 1000
            : Math.max(0, Date.parse(retry) - this.now());
        throw error;
      }
      const next = await response.json();
      if (!snapshotIsValid(next) || !next.generatedAt)
        throw new Error("Invalid or empty snapshot");
      if (Date.parse(next.generatedAt) > this.now() + 60000)
        throw new Error("Snapshot timestamp is in the future");
      this.lastFetchedAt = new Date(this.now()).toISOString();
      this.failures = 0;
      this.retryAt = 0;
      if (
        this.snapshot &&
        Date.parse(next.generatedAt) < Date.parse(this.snapshot.generatedAt)
      ) {
        return { changed: false, snapshot: this.snapshot, olderResponse: true };
      }
      const signature = JSON.stringify(next);
      const changed = signature !== this.signature;
      if (changed) {
        this.snapshot = next;
        this.signature = signature;
      }
      return { changed, snapshot: this.snapshot, olderResponse: false };
    } catch (error) {
      this.failures++;
      const delay = Math.max(
        Math.min(300000, 30000 * 2 ** Math.min(this.failures - 1, 4)),
        Math.min(3600000, error.retryAfter || 0),
      );
      this.retryAt = this.now() + delay;
      throw error;
    }
  }
  delay(pollSeconds) {
    return Math.max(pollSeconds * 1000, this.retryAt - this.now());
  }
}
