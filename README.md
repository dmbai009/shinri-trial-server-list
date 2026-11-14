# Shinri Trial Server List

An independent, unofficial server browser for **Shinri Trial in Garry's Mod**. It is not affiliated with the management or developers of Shinri Trial.

**[Open the website](https://dmbai009.github.io/shinri-trial-server-list/)**

## Features

- Responsive dark brown interface, one server per row, with an integrated details panel and vertical public player list.
- Russian, English and Ukrainian interfaces, automatic browser-language selection and a saved preference.
- Configurable categories and multiple categories per server. The `servers` array is the only display-order authority: no runtime sorting by population, name or response time.
- Actual server names, maps, player counts, capacity and password indicators from GameDig.
- Steam connection links, copyable IP addresses and `connect IP:PORT` commands, with a manual-copy fallback.
- A compact, copyable `dmbai` promo code. New players must activate it **before reaching level 5**.
- Honest snapshot timestamps, individual last-success times, automatic refresh and outdated-data warnings. No displayed or stored ping.

## Technology and data flow

The browser is plain HTML, CSS and JavaScript, with **no frontend dependencies, build framework, backend or database**. Node.js 24 and GameDig are needed only for development and automated queries.

```text
main: servers.json + collector → Update server statistics → server-data/status.json
main: frontend source         → Deploy website           → GitHub Pages
browser                       → Raw GitHub CDN           → server-data/status.json
```

These are **independent workflows with separate concurrency groups and permissions**:

- **Update server statistics** (`update-status.yml`) collects server statistics when triggered, on relevant collector/configuration changes, or manually. The published site normally receives a new snapshot about every five minutes. It restores the last snapshot and writes **only** to `server-data`. It does not build, upload artifacts, deploy Pages, or commit to `main`.
- **Deploy website** (`deploy.yml`) builds and deploys only on frontend/configuration/build changes in `main`, or manually. It never queries game servers and does not need permission to modify repository contents. README-only edits and statistics updates do not redeploy the site.
- The existing pull-request workflow only checks changes; it cannot publish data or the site.

At build time, `GITHUB_REPOSITORY` supplies the owner/repository for `dist/data/source.json`. A local GitHub remote is also supported. This works with forks, project subpaths and custom domains without modifying `servers.json`. The production site does **not** package `data/status.json`: there is no frozen Pages copy to accidentally read. Local source previews use `data/source.json` and a locally collected `data/status.json`.

Each visible page requests the public Raw GitHub CDN about once a minute. No GitHub REST API calls, visitor credentials or GitHub API tokens are used. Raw responses support CORS (`Access-Control-Allow-Origin: *`); the observed cache lifetime is 300 seconds. Shared minute query keys and browser revalidation avoid indefinitely reusing a browser-cached response, but **cannot remove GitHub's internal branch/ref cache**: a newly pushed snapshot can take up to roughly five additional minutes to propagate. Never equate a successful HTTP fetch with fresh game data. The UI uses the embedded collection and last-success timestamps, rejects older snapshots and warns about outdated results.

The page pauses automatic network polling while hidden or offline and checks again when active/online. Failed requests retain the last loaded snapshot and use bounded exponential backoff; HTTP `Retry-After` is honored. Unchanged responses keep the same snapshot object. Server rows update only when their visible contents change; the selected player list is preserved unless its contents change, including when relative-time labels refresh.

Queries run in up to ten independent child processes. Each has a 2-second packet timeout, 7-second attempt timeout, no retries, and an enforced 11-second process deadline. One failed server cannot abort the other queries. Snapshot writes are atomic; remote operations have deadlines. The store validates snapshots before restore/publication, reads the actually fetched branch SHA and uses a force-with-lease guard against concurrent writers.

## Deploy your own copy

1. Create a **public** GitHub repository and push these files to its `main` branch (or fork this repository).
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Do not select branch deployment.
3. Allow GitHub Actions and the workflow's declared permissions: `contents: write` for the generated snapshot branch; `pages: write` and `id-token: write` for deployment. No personal access token or repository secret is required. The statistics job alone has `contents: write`; the deploy job has `pages: write` and `id-token: write`.
4. Open **Actions → Update server statistics → Run workflow**, then **Deploy website → Run workflow**.
5. Open the URL in the completed deployment. Subsequent `servers.json` commits trigger statistics collection and publication of the updated configuration. Subsequent statistics checks update only the data branch. Forks need their own periodic trigger for the statistics workflow.

If your organization restricts Actions or branch writes, allow this workflow to update the dedicated `server-data` branch. Keep `main` as the default branch; otherwise update the workflow branch references.

All URLs are relative, so project URLs such as `https://USERNAME.github.io/REPOSITORY/` work without a base-path setting. To use a custom domain, configure it in GitHub Pages and add a `CNAME` file to `dist/` in `scripts/build.mjs`.

The static build fingerprints CSS, JavaScript and module imports to prevent browsers from mixing frontend files from different deployments. Snapshot-only updates reuse the same code fingerprint.

### Free operation and data freshness

Use a public repository and the standard `ubuntu-latest` runner. [GitHub documents free standard runner usage for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The workflow retains the small Pages artifact for one day and does not upload diagnostic artifacts or cache every snapshot.

Statistics are periodic snapshots, not realtime data. Collection timing, workflow queues and CDN propagation can add delays. The website warns when data is over 15 minutes old and links to collection diagnostics. If updates stop, inspect the workflow history and run **Update server statistics** manually.

Publishing with a custom Actions workflow avoids the standard [Pages limit of ten branch builds per hour](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Normal Pages usage limits still apply. Keep the project within the free plan and normal service limits; no paid service is required.

## Edit servers and categories

Edit **`servers.json`** in GitHub's web editor or locally. No website-code changes are necessary.

```json
{
  "schemaVersion": 1,
  "settings": {
    "pollSeconds": 60,
    "staleAfterMinutes": 15
  },
  "categories": [
    { "id": "ru", "label": "RU" },
    { "id": "global", "label": "Global" },
    { "id": "media", "label": "Media" },
    { "id": "events", "label": "Events" }
  ],
  "servers": [
    {
      "id": "ru-lobby-1",
      "address": "185.71.66.223:28015",
      "name": "My fallback server name",
      "categories": ["ru", "events"]
    }
  ]
}
```

- **Add:** append a server with a unique stable `id`, IPv4 address and port, fallback `name`, and one or more category IDs.
- **Remove:** delete its object from the array.
- **Reorder:** move objects up or down in `servers`. Category tabs preserve that exact relative order. The supplied configuration was initially arranged by the actual lobby numbers, at the owner's request; there is no automatic numeric sorting.
- **Change address:** edit `address`. Old statistics for a different address are automatically ignored. Keep the ID if it is still logically the same lobby.
- **Custom query port:** add an optional integer `queryPort` if its UDP query port differs from the connection port. Steam always uses `address`.
- **Add a category:** add an object to `categories`, then include its ID in the appropriate servers. Category labels are independent of interface language; category array order determines tab order. `all` is reserved.
- **Rename:** edit `name`. It is a fallback used before a successful query; the actual game-server name takes priority.

`pollSeconds` must be 30–3600 and controls only browser JSON checks, not game-server queries. The configuration itself is rechecked every five minutes. `staleAfterMinutes` must be 5–1440. JSON does not support comments or trailing commas. `npm run validate` checks the configuration; the workflows fail safely on invalid input and leave previously published data and the previous deployment available. Tests use a separate roster fixture, so you can freely edit the live server list.

The initial roster contains 30 RU, 10 Global (`203.*`) and 10 Media servers. A server can appear in several tabs without being queried twice.

## Snapshot semantics

- `generatedAt`: completion time of the last collection, even if every query failed.
- `lastSuccessAt`: most recent successful response among the configured servers.
- `configUpdatedAt`: Git commit time of the most recent `servers.json` edit.
- `collection`: run URL, trigger, revision, duration, success/failure counts, gap since the previous snapshot, changed payload/population/name-list counts and a SHA-256 of normalized game data with collection timestamps excluded.
- Per server: `checkedAt`, `lastSuccessAt`, `status`, `address`, optional query port and last successful `data`.
- **Available:** latest query succeeded and its successful data has not expired.
- **Outdated:** a previous success is retained after a failure, or successful data has aged beyond the threshold.
- **No response:** no reusable success exists. This does not prove the game server is offline; UDP filtering can also prevent queries.
- **Not checked:** the current address or query port has not appeared in a matching snapshot.

Summary player counts include only fresh available lobbies. The exact check and success times appear in the details panel. Retained stale player lists have their own explicit outdated-data notice. The interface also ages the displayed results while the page remains open, keeps the last loaded snapshot when fetches fail, ignores older CDN snapshots, and checks again when the tab becomes active or connectivity returns.

Player names come from public A2S_PLAYER responses and can be incomplete, anonymized or unavailable. Missing names are never invented. An empty name list with nonzero population is shown as unavailable, not as an empty server. Score and connection duration are displayed only if supplied. Names are rendered as escaped text. No private API or authentication bypass is used.

The dedicated **`server-data` branch is generated and must not contain hand-edited files**. Each update replaces that branch with a parentless commit containing only the latest snapshot, using a force-with-lease guard. This avoids accumulating a permanent reachable history of player names and hundreds of daily source commits. Source configuration, documentation and code on `main` remain untouched. GitHub may retain unreachable objects according to its own retention policy.

## Local development and checks

Requires Node.js 24 and npm. Players need neither.

```sh
npm ci
npm run dev
# Open http://127.0.0.1:4173

npm run validate
npm test
npm run collect   # Real UDP queries; requires network access
npm run build     # Self-contained static output in dist/
```

Serve the folder over HTTP; browsers cannot load module scripts and JSON correctly from a `file://` URL. To preview the output, use `node scripts/serve.mjs dist` after stopping the development server.

Tests cover configuration validation, multi-category filtering, stable order under out-of-order parallel completions, query failures and stale fallbacks, changed addresses/query ports, aging, unknown player lists, malformed snapshots, search, and translation completeness. Pull requests run checks without deployment or write permissions.

`fast-xml-parser` is overridden to a patched release because GameDig's dependency range includes an advisory affecting unrelated XML-based protocols. The browser downloads none of GameDig's dependencies.

## Connection and API notes

Steam links use `steam://connect/IP:PORT`. The browser/OS may ask permission to open Steam. Steam and Garry's Mod must already be installed. Mobile devices can browse/copy addresses but normally cannot launch the PC game.

The public `https://api.shinri.red/games/servers/2/connect` endpoint was checked during development: it returned HTTP 302 to a Steam connection URL. It is not used as a statistics API. The project relies exclusively on the configured addresses and public GameDig queries, so it does not depend on undocumented Shinri Hub methods.

## Troubleshooting

- **No site:** select GitHub Actions in Pages settings and inspect the **Deploy website** workflow's deploy job.
- **Snapshot branch write rejected:** allow the job's `contents: write` permission and writes to `server-data`. Do not disable the lease check or overwrite `main`.
- **Old data:** inspect Actions and run **Update server statistics** manually. Check its `collection` summary: trigger, previous snapshot, interval, actual payload/name/count changes, and content hash. Missing expected runs indicate a trigger problem; failed jobs identify a collector/store problem; a fresh branch but an older CDN response indicates propagation delay. GitHub scheduling and CDN propagation are not immediate.
- **All servers stop responding:** runners may be filtered by the game host or the host may be unavailable. Old successful results remain explicitly outdated; Steam connections are still offered. The workflow logs how many servers replied.
- **Player list unavailable:** the server may disable/hide public names. Total population can still be available.
- **Clipboard blocked:** the manual-copy dialog contains the exact IP, console command or promo code.

No accounts, launcher, private APIs, paid hosting or persistent custom server are required.

