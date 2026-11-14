import { validateConfig } from "./config.js";
import { stateOf, validDate, visibleServers } from "./model.js";
import { initialLanguage, messages, translate } from "./i18n.js";
import { SnapshotClient, sourceIsValid } from "./snapshot-client.js";
const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
let storage;
try {
  storage = localStorage;
} catch {
  /* Private/restricted browser. */
}
let language = initialLanguage(
  storage,
  navigator.languages || [navigator.language],
);
let config,
  snapshot,
  category = "all",
  loading = true,
  busy = false,
  failed = false,
  configFailed = false;
let pollTimer, toastTimer;
let source,
  configFetchedAt = 0;
const snapshotClient = new SnapshotClient();
const cards = new Map();
const t = (key, values) => translate(language, key, values);
const locale = () => ({ en: "en-GB", ru: "ru-RU", uk: "uk-UA" })[language];
function relative(value) {
  if (!validDate(value)) return t("timeUnknown");
  const seconds = Math.min(
    0,
    Math.round((Date.parse(value) - Date.now()) / 1000),
  );
  const formatter = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  if (seconds > -60) return formatter.format(seconds, "second");
  if (seconds > -3600)
    return formatter.format(Math.round(seconds / 60), "minute");
  if (seconds > -86400)
    return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}
function exact(value) {
  return validDate(value)
    ? new Intl.DateTimeFormat(locale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : t("timeUnknown");
}
function setText(selector, text) {
  if ($(selector).textContent !== String(text)) $(selector).textContent = text;
}
function showToast(text) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 4500);
}
async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(t(message));
  } catch {
    $("#copy-value").value = text;
    $("#copy-dialog").showModal();
    $("#copy-value").select();
  }
}
function translatePage() {
  document.documentElement.lang = language;
  document.title = `Shinri Trial Server List — ${t("serversTitle")}`;
  document
    .querySelectorAll("[data-i18n]")
    .forEach((element) => (element.textContent = t(element.dataset.i18n)));
  $("#language").value = language;
  $("#search").placeholder = t("search");
  $("#search").ariaLabel = t("search");
  $("#categories").ariaLabel = t("categories");
  $("#refresh").ariaLabel = t("refresh");
  $("#refresh").title = t("refresh");
  $(".overview").ariaLabel = t("directory");
  $("#copy-value").ariaLabel = t("manualCopy");
  $(".dialog-close").ariaLabel = t("close");
  $("#close-server").ariaLabel = t("close");
  $("#copy-starter-code").title = `${t("supportAuthor")}. ${t("promoText")}`;
  renderTabs();
  render();
}
function renderTabs() {
  if (!config) return;
  const definitions = [{ id: "all", label: t("all") }, ...config.categories];
  if (!definitions.some((c) => c.id === category)) category = "all";
  $("#categories").replaceChildren(
    ...definitions.map((definition) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tab${category === definition.id ? " active" : ""}`;
      button.dataset.category = definition.id;
      button.setAttribute("aria-pressed", String(category === definition.id));
      const count = config.servers.filter(
        (s) => definition.id === "all" || s.categories.includes(definition.id),
      ).length;
      button.append(document.createTextNode(definition.label));
      const badge = document.createElement("span");
      badge.className = "count";
      badge.textContent = count;
      button.append(badge);
      return button;
    }),
  );
}
function cardHTML(server, index, state) {
  const { row, kind } = state,
    data = row?.data;
  const status = loading ? "loading" : kind;
  const count = data?.numplayers,
    max = data?.maxplayers;
  const percent =
    Number.isFinite(count) && max > 0 ? Math.min(100, (100 * count) / max) : 0;
  const categories = server.categories
    .map((id) => config.categories.find((c) => c.id === id)?.label ?? id)
    .join(" · ");
  return `<div class="server-row">
    <span class="row-number">${String(index + 1).padStart(2, "0")}</span>
    <div class="row-identity"><h2 class="server-title"><button type="button" class="server-open-button" data-action="details" title="${escape(t("viewDetails"))}">${escape(data?.name || server.name)}</button></h2><div class="row-subtitle"><span class="category-tag">${escape(categories)}</span><span class="server-address">${escape(server.address)}</span><button class="address-copy" data-action="ip" title="${escape(t("copyIP"))}" aria-label="${escape(t("copyIP"))}">⧉</button><span class="server-status ${status}"><span class="status-dot ${status}"></span>${escape(t(status))}</span>${data?.password ? `<span title="${escape(t("password"))}" aria-label="${escape(t("password"))}">⌑</span>` : ""}</div><div class="identity-map"><span>${escape(t("map"))}</span><span class="map-name">${loading ? '<span class="skeleton"></span>' : escape(data?.map || "—")}</span></div></div>
    <div class="row-map"><span class="stat-label">${escape(t("map"))}</span><span class="map-name" title="${escape(data?.map || "—")}">${loading ? '<span class="skeleton"></span>' : escape(data?.map || "—")}</span></div>
    <div class="row-players"><span class="stat-label">${escape(t("players"))}</span><span class="players-count">${loading ? '<span class="skeleton short"></span>' : escape(count ?? "—")} <small>/ ${escape(max ?? "—")}</small></span><div class="player-bar" aria-hidden="true"><span style="width:${percent}%"></span></div></div>
    <div class="row-actions"><a class="connect-button" data-action="connect" href="steam://connect/${escape(server.address)}"><span aria-hidden="true">↗</span>${escape(t("connect"))}</a><button class="console-button" data-action="command" title="${escape(t("copyCommand"))}" aria-label="${escape(t("copyCommand"))}">&gt;_</button></div>
    <button class="row-detail-button" data-action="details" aria-label="${escape(t("viewDetails"))}">›</button></div>`;
}
let selectedServer = null;
function duration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 3600)
    .toString()
    .padStart(
      2,
      "0",
    )}:${Math.floor(total / 60) % 60 < 10 ? "0" : ""}${Math.floor(total / 60) % 60}:${(total % 60).toString().padStart(2, "0")}`;
}
function renderDrawer() {
  if (!selectedServer || !config) return;
  const server = config.servers.find((s) => s.id === selectedServer);
  if (!server) {
    closeServer();
    return;
  }
  const { row, kind } = stateOf(
      server,
      snapshot,
      config.settings.staleAfterMinutes,
    ),
    data = row?.data;
  const names = Array.isArray(data?.players) ? data.players : null;
  let players = `<p class="player-unavailable">${escape(data?.numplayers === 0 ? t("noPlayers") : t("playerUnavailable"))}</p>`;
  if (names?.length)
    players = `<p class="player-note">${escape(t("partialPlayers", { count: names.length }))}</p><div class="player-table"><div class="player-table-header"><span>${escape(t("players"))}</span><span>${escape(t("score"))}</span><span>${escape(t("playerTime"))}</span></div>${names.map((player) => `<div class="player-row"><span>${escape(player.name)}</span><span>${Number.isFinite(player.score) ? escape(player.score) : "—"}</span><span>${duration(player.time)}</span></div>`).join("")}</div>`;
  const content = $("#server-detail-content");
  content.dataset.id = server.id;
  const html = `<div class="drawer-body"><div class="detail-status"><span class="server-status ${kind}"><span class="status-dot ${kind}"></span>${escape(t(kind))}</span><span class="category-tag">${escape(server.categories.map((id) => config.categories.find((c) => c.id === id)?.label).join(" · "))}</span></div>
    <h2 id="detail-name">${escape(data?.name || server.name)}</h2><div class="detail-address"><code>${escape(server.address)}</code><button class="address-copy" data-action="ip" aria-label="${escape(t("copyIP"))}">⧉</button></div>
    <div class="detail-actions"><a class="connect-button" data-action="connect" href="steam://connect/${escape(server.address)}">↗ ${escape(t("connect"))}</a><button class="console-button" data-action="command" title="${escape(t("copyCommand"))}" aria-label="${escape(t("copyCommand"))}">&gt;_</button></div>
    ${kind === "stale" ? `<p class="notice">${escape(t("stale"))} · ${escape(t("lastGood", { time: exact(row.lastSuccessAt) }))}</p>` : ""}
    <dl class="detail-facts"><div><dt>${escape(t("map"))}</dt><dd>${escape(data?.map || "—")}</dd></div><div><dt>${escape(t("players"))}</dt><dd>${escape(data?.numplayers ?? "—")} / ${escape(data?.maxplayers ?? "—")}</dd></div><div><dt>${escape(t("lastChecked"))}</dt><dd>${escape(exact(row?.checkedAt))}<small data-relative-time="${escape(row?.checkedAt)}"></small></dd></div><div><dt>${escape(t("lastSuccessful"))}</dt><dd>${escape(exact(row?.lastSuccessAt))}<small data-relative-time="${escape(row?.lastSuccessAt)}"></small></dd></div>${data?.password ? `<div><dt>${escape(t("password"))}</dt><dd>⌑</dd></div>` : ""}</dl>
    <h3 class="players-heading">${escape(t("playerList"))}</h3><p class="player-note">${escape(t(kind === "stale" ? "stalePlayers" : "playersSnapshot"))}</p><div id="detail-players"></div></div>`;
  if (content._html !== html) {
    const scroll = $("#server-panel").scrollTop;
    const previousPlayers = content.querySelector("#detail-players");
    content.innerHTML = html;
    if (previousPlayers)
      content.querySelector("#detail-players").replaceWith(previousPlayers);
    content._html = html;
    $("#server-panel").scrollTop = scroll;
  }
  const playerContainer = content.querySelector("#detail-players");
  if (playerContainer._html !== players) {
    playerContainer.innerHTML = players;
    playerContainer._html = players;
  }
  content.querySelectorAll("[data-relative-time]").forEach((element) => {
    const text = relative(element.dataset.relativeTime);
    if (element.textContent !== text) element.textContent = text;
  });
  positionPanel();
}
function openServer(id) {
  selectedServer = id;
  renderDrawer();
  $("#server-panel").hidden = false;
  $(".catalog-content").classList.add("with-details");
  positionPanel();
  render();
}
function render() {
  if (!config) {
    renderNotice();
    return;
  }
  const current = visibleServers(
    config,
    category,
    $("#search").value,
    snapshot,
    $("#only-available").checked,
  );
  const visible = new Set(current.map((s) => s.id)),
    allIds = new Set(config.servers.map((s) => s.id));
  if (selectedServer && !visible.has(selectedServer)) closeServer();
  const grid = $("#server-grid");
  for (const [id, card] of cards)
    if (!allIds.has(id)) {
      card.remove();
      cards.delete(id);
    }
  config.servers.forEach((server, index) => {
    let card = cards.get(server.id);
    if (!card) {
      card = document.createElement("article");
      card.className = "server-card";
      card.dataset.id = server.id;
      cards.set(server.id, card);
    }
    const state = stateOf(server, snapshot, config.settings.staleAfterMinutes);
    const html = cardHTML(server, index, state);
    if (card._html !== html) {
      const focusAction = card.contains(document.activeElement)
        ? document.activeElement.dataset.action
        : null;
      card.innerHTML = html;
      card._html = html;
      if (focusAction)
        card
          .querySelector(`[data-action="${focusAction}"]`)
          ?.focus({ preventScroll: true });
    }
    card.classList.toggle("loading", loading);
    card.classList.toggle("selected", selectedServer === server.id);
    card.hidden = !visible.has(server.id);
    const position = grid.querySelectorAll(":scope > .server-card")[index];
    if (position !== card) grid.insertBefore(card, position || null);
  });
  grid.setAttribute("aria-busy", String(loading));
  $("#empty").hidden = current.length > 0;
  setText(
    "#result-count",
    t("shown", { shown: current.length, total: config.servers.length }),
  );
  setText("#total-servers", config.servers.length);
  const available = config.servers
    .map((s) => stateOf(s, snapshot, config.settings.staleAfterMinutes))
    .filter((s) => s.kind === "online");
  setText("#available-servers", loading ? "—" : available.length);
  const knownPlayers = available.filter((s) =>
    Number.isFinite(s.row.data.numplayers),
  );
  setText(
    "#total-players",
    !loading && knownPlayers.length
      ? knownPlayers
          .reduce((sum, s) => sum + s.row.data.numplayers, 0)
          .toLocaleString(locale())
      : "—",
  );
  const fresh =
    validDate(snapshot?.generatedAt) &&
    Date.now() - Date.parse(snapshot.generatedAt) <=
      config.settings.staleAfterMinutes * 60000;
  $("#freshness-dot").className =
    `status-dot ${fresh && !failed ? "online" : "stale"}`;
  setText(
    "#updated-at",
    validDate(snapshot?.generatedAt)
      ? t("updated", { time: relative(snapshot.generatedAt) })
      : t("awaitingSnapshot"),
  );
  $("#updated-at").title = exact(snapshot?.generatedAt);
  setText(
    "#last-success",
    snapshot?.lastSuccessAt
      ? t("lastSuccess", { time: relative(snapshot.lastSuccessAt) })
      : t("snapshotNote"),
  );
  $("#last-success").title = exact(snapshot?.lastSuccessAt);
  setText(
    "#config-updated",
    t("configUpdated", { time: exact(snapshot?.configUpdatedAt) }),
  );
  renderNotice();
  renderDrawer();
}
function renderNotice() {
  const notice = $("#notice");
  let key = "";
  if (!navigator.onLine) key = "offline";
  else if (configFailed) key = "configError";
  else if (failed) key = "fetchError";
  else if (!loading && !snapshot?.generatedAt) key = "firstRun";
  else if (
    snapshot?.generatedAt &&
    Date.now() - Date.parse(snapshot.generatedAt) >
      config.settings.staleAfterMinutes * 60000
  )
    key = "staleNotice";
  else if (
    !loading &&
    snapshot?.generatedAt &&
    config.servers.length &&
    !config.servers.some(
      (s) =>
        stateOf(s, snapshot, config.settings.staleAfterMinutes).kind ===
        "online",
    )
  )
    key = "noResponses";
  const isStale =
    snapshot?.generatedAt &&
    Date.now() - Date.parse(snapshot.generatedAt) >
      (config?.settings.staleAfterMinutes ?? 15) * 60000;
  const signature = JSON.stringify([
    key,
    language,
    isStale,
    failed,
    configFailed,
    source?.diagnosticsUrl,
  ]);
  if (notice._signature === signature) return;
  notice._signature = signature;
  notice.replaceChildren();
  notice.hidden = !key;
  if (key) {
    notice.append(
      document.createTextNode(
        t(key, { minutes: config?.settings.staleAfterMinutes }),
      ),
    );
    if (isStale && key !== "staleNotice")
      notice.append(
        document.createTextNode(
          " " +
            t("staleNotice", { minutes: config?.settings.staleAfterMinutes }),
        ),
      );
    if (
      source?.diagnosticsUrl &&
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/workflows\/update-status\.yml$/.test(
        source.diagnosticsUrl,
      )
    ) {
      const link = document.createElement("a");
      link.href = source.diagnosticsUrl;
      link.textContent = t("diagnostics");
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "diagnostics-link";
      notice.append(document.createTextNode(" "), link);
    }
    if (failed || configFailed) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("retry");
      button.addEventListener("click", refresh);
      notice.append(button);
    }
  }
}
async function getJSON(path) {
  const response = await fetch(
    `./${path}?v=${Math.floor(Date.now() / 15000)}`,
    { cache: "no-store", signal: AbortSignal.timeout(12000) },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function enableAnalytics() {
  const token = config?.settings.cloudflareToken;
  if (
    !token ||
    ["localhost", "127.0.0.1", "::1"].includes(location.hostname) ||
    document.getElementById("cloudflare-beacon")
  )
    return;
  const script = document.createElement("script");
  script.id = "cloudflare-beacon";
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.body.append(script);
}
function scheduleRefresh() {
  clearTimeout(pollTimer);
  if (document.hidden || !navigator.onLine) return;
  pollTimer = setTimeout(
    refresh,
    snapshotClient.delay(config?.settings.pollSeconds ?? 60),
  );
}
async function refresh() {
  if (busy) return;
  if (!navigator.onLine) {
    render();
    return;
  }
  if (Date.now() < snapshotClient.retryAt) {
    scheduleRefresh();
    return;
  }
  busy = true;
  $("#refresh").disabled = true;
  clearTimeout(pollTimer);
  try {
    const configPromise =
      !config || Date.now() - configFetchedAt >= 300000
        ? getJSON("servers.json")
            .then(validateConfig)
            .then((next) => {
              const changed = JSON.stringify(config) !== JSON.stringify(next);
              config = next;
              configFailed = false;
              configFetchedAt = Date.now();
              if (changed) {
                renderTabs();
                render();
                enableAnalytics();
              }
            })
            .catch(() => {
              configFailed = true;
            })
        : Promise.resolve();
    const snapshotPromise = (async () => {
      if (!source) {
        const descriptor = await getJSON("data/source.json");
        if (!sourceIsValid(descriptor))
          throw new Error("Invalid statistics source");
        source = descriptor;
      }
      const result = await snapshotClient.read(source);
      snapshot = result.snapshot;
      failed = false;
    })().catch((error) => {
      console.warn("Statistics refresh failed:", error.message);
      failed = true;
    });
    await Promise.all([configPromise, snapshotPromise]);
  } finally {
    loading = false;
    busy = false;
    $("#refresh").disabled = false;
    render();
    scheduleRefresh();
  }
}
$("#language").addEventListener("change", (event) => {
  if (!messages[event.target.value]) return;
  language = event.target.value;
  try {
    storage?.setItem("shinri-language", language);
  } catch {}
  translatePage();
});
$("#categories").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  category = button.dataset.category;
  renderTabs();
  render();
  $("#categories")
    .querySelector(`[data-category="${category}"]`)
    ?.focus({ preventScroll: true });
});
$("#search").addEventListener("input", render);
$("#only-available").addEventListener("change", render);
$("#clear-filters").addEventListener("click", () => {
  category = "all";
  $("#search").value = "";
  $("#only-available").checked = false;
  renderTabs();
  render();
  $("#search").focus();
});
$("#refresh").addEventListener("click", refresh);
$("#copy-starter-code").addEventListener("click", () => copy("dmbai", "copiedPromo"));
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !config) return;
  const container = button.closest("[data-id]");
  const server = config.servers.find((s) => s.id === container?.dataset.id);
  if (!server) return;
  if (button.dataset.action === "details") openServer(server.id);
  if (button.dataset.action === "ip") copy(server.address, "copiedIP");
  if (button.dataset.action === "command")
    copy(`connect ${server.address}`, "copiedCommand");
  if (button.dataset.action === "connect") showToast(t("steamOpened"));
});
$("#server-grid").addEventListener("click", (event) => {
  const card = event.target.closest(".server-card");
  if (card && !event.target.closest("a,button")) openServer(card.dataset.id);
});
function closeServer() {
  const id = selectedServer;
  selectedServer = null;
  $("#server-panel").hidden = true;
  $(".catalog-content").classList.remove("with-details");
  $(".catalog-content").append($("#server-panel"));
  cards.get(id)?.classList.remove("selected");
  cards
    .get(id)
    ?.querySelector(".server-open-button")
    ?.focus({ preventScroll: true });
}
function positionPanel() {
  const panel = $("#server-panel");
  if (!selectedServer) return;
  if (matchMedia("(max-width: 1000px)").matches) {
    const card = cards.get(selectedServer);
    if (card && card.nextElementSibling !== panel) card.after(panel);
  } else if (panel.parentElement !== $(".catalog-content"))
    $(".catalog-content").append(panel);
}
$("#close-server").addEventListener("click", closeServer);
window.addEventListener("resize", positionPanel);

window.addEventListener("online", refresh);
window.addEventListener("offline", render);
document.addEventListener("visibilitychange", () => {
  clearTimeout(pollTimer);
  if (!document.hidden) refresh();
});
setInterval(() => {
  if (!document.hidden) render();
}, 30000);
translatePage();
refresh();
