// background.js

const DEFAULT_WS_URL  = "ws://127.0.0.1:47842";
const RECONNECT_DELAY = 3000;

let ws                  = null;
let wsReady             = false;
let queue               = [];
let reconnTimer         = null;
let lastPayload         = null;
let lastEnrichedPayload = null;
let lastPayloadTabId    = null;
let currentStatus       = { connected: false, error: null };

async function getWsUrl() {
  const { wsUrl } = await chrome.storage.local.get("wsUrl");
  return wsUrl || DEFAULT_WS_URL;
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = await getWsUrl();
  try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }

  ws.onopen = () => {
    wsReady = true;
    setStatus({ connected: true, error: null });
    const q = queue.splice(0);
    for (const m of q) trySend(m);
    if (lastPayload && !q.includes(lastPayload)) trySend(lastPayload);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg?.type === "enriched_update" && msg.payload) {
        lastEnrichedPayload = msg.payload;
      }
    } catch {}
  };

  ws.onerror = () => {
    wsReady = false;
    setStatus({ connected: false, error: "Erreur WebSocket" });
  };

  ws.onclose = () => {
    wsReady = false;
    lastEnrichedPayload = null;
    if (currentStatus.error !== "Erreur WebSocket") {
      setStatus({ connected: false, error: "Compagnon déconnecté" });
    }
    scheduleReconnect();
  };
}

function trySend(msg) {
  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); return true; } catch {}
  }
  return false;
}

function scheduleReconnect() {
  if (reconnTimer) return;
  reconnTimer = setTimeout(() => { reconnTimer = null; connect(); }, RECONNECT_DELAY);
}

function setStatus(status) {
  currentStatus = status;
  chrome.storage.local.set({ status });
}

function send(payload) {
  if (!trySend(payload)) {
    queue = [payload];
    connect();
  }
}

// ─── Filtrage par site ────────────────────────────────────────────────────────
const TYPE_TO_SITE = {
  cinepulse_presence:   "cinepulse",
  youtube_presence:     "youtube",
  nakastream_presence:  "nakastream",
  twitch_presence:      "twitch",
  primevideo_presence:  "primevideo",
};
const SITE_DEFAULTS = { cinepulse: true, youtube: true, nakastream: true, twitch: true, primevideo: true };

let cachedSites = null;

async function isSiteEnabled(payload) {
  if (!cachedSites) {
    const { enabledSites = {} } = await chrome.storage.local.get("enabledSites");
    cachedSites = { ...SITE_DEFAULTS, ...enabledSites };
  }
  const key = TYPE_TO_SITE[payload.type];
  return key ? cachedSites[key] !== false : true;
}

// ─── Handler présence ─────────────────────────────────────────────────────────
async function handlePresenceUpdate(payload) {
  const isClear = !payload || payload.type === "presence_clear";
  if (!isClear && !(await isSiteEnabled(payload))) return;

  // Anti-clignotement multi-onglets
  if (!isClear && lastPayload && lastPayload.type !== "presence_clear") {
    const incomingTs = payload.timestamp || 0;
    const lastTs     = lastPayload.timestamp || 0;
    const sameTab    = payload.url === lastPayload.url;
    if (!sameTab) {
      // Un onglet en lecture bat toujours un onglet en pause
      if (lastPayload.isPlaying && !payload.isPlaying) return;
      // Même état (tous deux en lecture ou tous deux en pause) → le plus récent gagne
      if (lastPayload.isPlaying === payload.isPlaying && incomingTs < lastTs) return;
    }
  }

  lastPayload = payload;
  lastEnrichedPayload = null;
  send(payload);
}

// ─── Messages ─────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.kind === "presence_update") {
    if (_sender.tab?.id != null) lastPayloadTabId = _sender.tab.id;
    handlePresenceUpdate(msg.payload).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.kind === "media_control" || msg.kind === "media_prev" || msg.kind === "media_next") {
    if (lastPayloadTabId != null) {
      chrome.tabs.sendMessage(lastPayloadTabId, { kind: msg.kind }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.kind === "reconnect") {
    if (ws) try { ws.close(); } catch {}
    ws = null; wsReady = false;
    connect().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.kind === "get_state") {
    chrome.storage.local.get(["wsUrl", "enabledSites"]).then((s) => {
      sendResponse({
        status:      currentStatus,
        wsUrl:       s.wsUrl || DEFAULT_WS_URL,
        lastPayload: lastEnrichedPayload || lastPayload,
        prefs: {
          enabledSites: s.enabledSites || {},
        },
      });
    });
    return true;
  }

  if (msg.kind === "prefs_updated") {
    cachedSites = null;
    chrome.storage.local.get(["enabledSites"]).then(({ enabledSites = {} }) => {
      const sites = { ...SITE_DEFAULTS, ...enabledSites };
      cachedSites = sites;
      if (lastPayload && lastPayload.type !== "presence_clear") {
        const platform = TYPE_TO_SITE[lastPayload.type];
        if (platform && !sites[platform]) {
          lastPayload = null;
          send({ type: "presence_clear" });
        }
      }
      chrome.tabs.query({}).then(tabs => {
        for (const tab of tabs) {
          if (tab.id != null) {
            chrome.tabs.sendMessage(tab.id, { kind: "prefs_updated" }).catch(() => {});
          }
        }
      });
    });
    sendResponse({ ok: true });
  }
});

// Heartbeat — ping le compagnon toutes les 15s dès qu'une présence est active (lecture ou pause).
// Empêche le watchdog du compagnon (45s) de couper la connexion quand le contenu est mis en pause.
setInterval(() => {
  if (!lastPayload || lastPayload.type === "presence_clear") return;
  trySend({ type: "heartbeat" });
}, 15_000);

chrome.alarms.create("keep-alive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keep-alive") connect();
});

// Garder le SW en vie via les ports ouverts par les content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keepalive") return;
  port.onDisconnect.addListener(() => {});
});

connect();
