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
- Optional Cloudflare Web Analytics, without a custom visitor database.

## Technology and data flow

The browser is plain HTML, CSS and JavaScript, with **no frontend dependencies, build framework, backend or database**. Node.js 24 and GameDig are needed only for development and automated queries.

```text
servers.json (configuration on main)
       ↓ GitHub Actions + parallel GameDig queries
server-data branch (latest generated status.json only)
       ↓ static build and GitHub Pages deployment
data/status.json → browser, refreshed every 60 seconds
```

GitHub Pages serves the complete static site from an Actions artifact. The production workflow runs on pushes to `main`, manually, and approximately every five minutes. It restores the previous snapshot before querying, so individual failures can retain the last successful result. Configuration is never rewritten by the workflow.

Queries run in up to ten independent child processes. Each has a 2-second packet timeout, 7-second attempt timeout, no retries, and an enforced 11-second process deadline. A failed server does not abort other queries. Snapshot writes are atomic.

## Deploy your own copy

1. Create a **public** GitHub repository and push these files to its `main` branch (or fork this repository).
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Do not select branch deployment.
3. Allow GitHub Actions and the workflow's declared permissions: `contents: write` for the generated snapshot branch; `pages: write` and `id-token: write` for deployment. No personal access token or repository secret is required.
4. Open **Actions → Update servers and deploy Pages → Run workflow**. Forked repositories may need scheduled workflows explicitly enabled.
5. Open the URL in the completed deployment. Subsequent `servers.json` commits automatically trigger a query and deployment.

If your organization restricts Actions or branch writes, allow this workflow to update the dedicated `server-data` branch. Keep `main` as the default branch; otherwise update the two workflow branch references.

All URLs are relative, so project URLs such as `https://USERNAME.github.io/REPOSITORY/` work without a base-path setting. To use a custom domain, configure it in GitHub Pages and add a `CNAME` file to `dist/` in `scripts/build.mjs`.

### Free operation and scheduling limits

Use a public repository and the standard `ubuntu-latest` runner. [GitHub documents free standard runner usage for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The workflow retains the small Pages artifact for one day and does not upload diagnostic artifacts or cache every snapshot.

[Scheduled Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) have a minimum five-minute interval, can be delayed or dropped during high load, and can be disabled after 60 days of repository inactivity. This is **not realtime or a guaranteed five-minute service**. The schedule starts at minute 2 to avoid the top of the hour. If updates stop, re-enable the workflow and run it manually. The website warns when data is over 15 minutes old.

Publishing with a custom Actions workflow avoids the standard [Pages limit of ten branch builds per hour](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Normal Pages usage limits still apply. Keep the project within the free plan and normal service limits; no paid service is required.

## Edit servers and categories

Edit **`servers.json`** in GitHub's web editor or locally. No website-code changes are necessary.

```json
{
  "schemaVersion": 1,
  "settings": {
    "pollSeconds": 60,
    "staleAfterMinutes": 15,
    "cloudflareToken": ""
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

`pollSeconds` must be 30–3600 and controls only browser JSON checks, not game-server queries. `staleAfterMinutes` must be 5–1440. JSON does not support comments or trailing commas. `npm run validate` checks the configuration; the workflow fails safely on invalid input and leaves the previous deployment available. Tests use a separate roster fixture, so you can freely edit the live server list.

The initial roster contains 30 RU, 10 Global (`203.*`) and 10 Media servers. A server can appear in several tabs without being queried twice.

## Snapshot semantics

- `generatedAt`: completion time of the last collection, even if every query failed.
- `lastSuccessAt`: most recent successful response among the configured servers.
- `configUpdatedAt`: Git commit time of the most recent `servers.json` edit.
- Per server: `checkedAt`, `lastSuccessAt`, `status`, `address`, optional query port and last successful `data`.
- **Available:** latest query succeeded and its successful data has not expired.
- **Outdated:** a previous success is retained after a failure, or successful data has aged beyond the threshold.
- **No response:** no reusable success exists. This does not prove the game server is offline; UDP filtering can also prevent queries.
- **Not checked:** the current address or query port has not appeared in a matching snapshot.

Summary player counts include only fresh available lobbies. The exact check and success times appear in the details panel. The interface also ages the displayed results while the page remains open, keeps the last loaded snapshot when fetches fail, ignores older CDN snapshots, and checks again when the tab becomes active or connectivity returns.

Player names come from public A2S_PLAYER responses and can be incomplete, anonymized or unavailable. Missing names are never invented. An empty name list with nonzero population is shown as unavailable, not as an empty server. Score and connection duration are displayed only if supplied. Names are rendered as escaped text. No private API or authentication bypass is used.

The dedicated **`server-data` branch is generated and must not contain hand-edited files**. Each update replaces that branch with a parentless commit containing only the latest snapshot, using a force-with-lease guard. This avoids accumulating a permanent reachable history of player names and hundreds of daily source commits. Source configuration, documentation and code on `main` remain untouched. GitHub may retain unreachable objects according to its own retention policy.

## Cloudflare Web Analytics

The owner's beacon token is already configured. For your own fork, **replace or clear `settings.cloudflareToken`** to avoid attributing your visitors to the original analytics site.

1. In Cloudflare, open **Web Analytics → Add a site** and enter your Pages hostname.
2. Copy the 32-character public `token` from the provided snippet into `settings.cloudflareToken`.
3. Commit the change. The site loads Cloudflare's official beacon automatically after configuration loads. No additional snippet, DNS proxy, secret key or server is needed. Localhost previews do not load analytics.

The token is a public beacon identifier, not a private API credential. Leave it empty to disable analytics on subsequent page loads. See [Cloudflare setup instructions for sites not proxied through Cloudflare](https://developers.cloudflare.com/web-analytics/get-started/).

Cloudflare provides aggregate page-view and visitor metrics and supported geographic/referrer dimensions. The project does not store visitor IPs or use a visitor database. The only local preference is the chosen language. **Custom connection-click tracking is not included**; the project does not pretend Cloudflare Web Analytics supports an invented custom-event API.

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

- **No site:** select GitHub Actions in Pages settings and inspect the production workflow's deploy job.
- **Snapshot branch write rejected:** allow the job's `contents: write` permission and writes to `server-data`. Do not disable the lease check or overwrite `main`.
- **Old data:** inspect Actions, enable disabled schedules, and run the workflow manually. GitHub scheduling and CDN propagation are not immediate.
- **All servers stop responding:** runners may be filtered by the game host or the host may be unavailable. Old successful results remain explicitly outdated; Steam connections are still offered. The workflow logs how many servers replied.
- **Player list unavailable:** the server may disable/hide public names. Total population can still be available.
- **Clipboard blocked:** the manual-copy dialog contains the exact IP, console command or promo code.

No accounts, launcher, private APIs, paid hosting or persistent custom server are required.
