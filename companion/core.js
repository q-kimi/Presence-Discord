const { WebSocketServer } = require("ws");
const net   = require("net");
const fs    = require("fs");
const path  = require("path");
const https = require("https");
const {
  PLATFORMS,
  PLATFORM_LABEL,
  PRESENCE_TYPES,
  NEEDS_TMDB_POSTER_TYPES,
  DEFAULT_LARGE_IMAGE_TYPES,
} = require("./platforms");

// ─── .env ─────────────────────────────────────────────────────────────────────
(function loadEnv() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

// ─── Logs ─────────────────────────────────────────────────────────────────────
const C = {
  r:  "\x1b[0m",  dim: "\x1b[90m", w:  "\x1b[97m",
  gr: "\x1b[92m", re:  "\x1b[91m", pu: "\x1b[38;5;99m",
  cy: "\x1b[96m", yl:  "\x1b[93m", pk: "\x1b[38;5;203m",
};
function tag(color, label) { return `  ${color}[${label}]${C.r}`; }
const L = {
  cfg:  (...a) => console.log(tag(C.dim, "config"      ), ...a),
  disc: (...a) => console.log(tag(C.pu,  "discord"     ), ...a),
  ws:   (...a) => console.log(tag(C.cy,  "ws"          ), ...a),
  yt:   (...a) => console.log(tag(C.pk,  "YouTube"     ), ...a),
  cp:   (...a) => console.log(tag(C.gr,  "Cinepulse"   ), ...a),
  nk:   (...a) => console.log(tag(C.cy,  "Nakastream"  ), ...a),
  tw:   (...a) => console.log(tag(C.pu,  "Twitch"      ), ...a),
  pv:   (...a) => console.log(tag(C.yl,  "Prime Video" ), ...a),
  tmdb: (...a) => console.log(tag(C.dim, "tmdb"        ), ...a),
  pre:  (...a) => console.log(tag(C.dim, "presence"    ), ...a),
  exit: (...a) => console.log(tag(C.dim, "exit"        ), ...a),
};

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(process.env.PRESENCE_CONFIG_DIR || __dirname, "config.json");
const DEFAULTS = {
  port:              47842,
  extensionId:       "",
  largeImageDefault: "cinepulse_logo",
  smallImagePlay:    "play",
  smallImagePause:   "pause",
  smallImagePlayUrl: "",
  smallImagePauseUrl:"",
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
    L.cfg(`Fichier créé : ${C.dim}${CONFIG_PATH}${C.r}`);
  }
  return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
}

const config = loadConfig();
config.clientId = process.env.DISCORD_CLIENT_ID || config.clientId || _dk("RkJTRVNWVlYZVlpGVl1LVkRG");

// ─── Discord IPC ──────────────────────────────────────────────────────────────
const OP_HANDSHAKE = 0;
const OP_FRAME     = 1;
const OP_PING      = 3;
const OP_PONG      = 4;

function pack(op, data) {
  const json    = JSON.stringify(data);
  const jsonLen = Buffer.byteLength(json, "utf8");
  const buf     = Buffer.alloc(8 + jsonLen);
  buf.writeUInt32LE(op, 0);
  buf.writeUInt32LE(jsonLen, 4);
  buf.write(json, 8, "utf8");
  return buf;
}

function pipePath(i) {
  if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${i}`;
  const tmp = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || "/tmp";
  return path.join(tmp, `discord-ipc-${i}`);
}

const RETRY_MIN = 2_000;
const RETRY_MAX = 10_000;

class DiscordIPC {
  constructor() {
    this.socket     = null;
    this.ready      = false;
    this.nonce      = 0;
    this._buf       = Buffer.alloc(0);
    this._retryMs   = RETRY_MIN;
  }

  async connect() {
    if (!config.clientId || config.clientId.startsWith("REMPLACE")) {
      L.disc(`${C.re}clientId manquant dans .env${C.r}`);
      L.disc(`${C.dim}→ https://discord.com/developers/applications${C.r}`);
      return;
    }

    let sock = null;
    for (let i = 0; i < 10; i++) {
      try {
        sock = await new Promise((resolve, reject) => {
          const s = net.createConnection(pipePath(i));
          const t = setTimeout(() => { s.destroy(); reject(new Error("timeout")); }, 1000);
          s.once("connect", () => { clearTimeout(t); resolve(s); });
          s.once("error",   e  => { clearTimeout(t); reject(e); });
        });
        break;
      } catch {}
    }

    if (!sock) {
      L.disc(`${C.re}Impossible de se connecter à Discord.${C.r}`);
      L.disc(`${C.dim}Assure-toi que Discord est ouvert — nouvel essai dans ${this._retryMs / 1000}s…${C.r}`);
      setTimeout(() => this.connect(), this._retryMs);
      this._retryMs = Math.min(this._retryMs * 2, RETRY_MAX);
      return;
    }

    this._retryMs = RETRY_MIN;
    this.socket   = sock;
    this._buf     = Buffer.alloc(0);

    sock.on("data",  chunk => this._onData(chunk));
    sock.on("close", ()    => {
      this.ready  = false;
      this.socket = null;
      L.disc(`${C.yl}Déconnecté — reconnexion dans ${this._retryMs / 1000}s…${C.r}`);
      setTimeout(() => this.connect(), this._retryMs);
      this._retryMs = Math.min(this._retryMs * 2, RETRY_MAX);
    });
    sock.on("error", () => {});

    sock.write(pack(OP_HANDSHAKE, { v: 1, client_id: config.clientId }));
    L.disc(`Handshake envoyé, attente de Discord…`);
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    while (this._buf.length >= 8) {
      const msgLen = this._buf.readUInt32LE(4);
      if (this._buf.length < 8 + msgLen) break;
      const op = this._buf.readUInt32LE(0);
      let msg;
      try { msg = JSON.parse(this._buf.slice(8, 8 + msgLen).toString("utf8")); } catch {}
      this._buf = this._buf.slice(8 + msgLen);
      if (msg) this._onMessage(op, msg);
    }
  }

  _onMessage(op, msg) {
    if (op === OP_PING) {
      this.socket?.write(pack(OP_PONG, msg));
      return;
    }
    if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
      this.ready = true;
      L.disc(`${C.gr}Connecté${C.r} en tant que ${C.w}${msg.data?.user?.username || "?"}${C.r}`);
      if (pendingActivity) applyActivity(pendingActivity);
    }
  }

  setActivity(activity) {
    if (!this.socket || !this.ready) return;
    this.socket.write(pack(OP_FRAME, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity },
      nonce: String(++this.nonce)
    }));
  }

  clearActivity() {
    if (!this.socket || !this.ready) return;
    this.socket.write(pack(OP_FRAME, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: null },
      nonce: String(++this.nonce)
    }));
  }

  destroy() {
    this.socket?.destroy();
    this.socket = null;
    this.ready  = false;
  }
}

const discord = new DiscordIPC();

// ─── Utilitaires ──────────────────────────────────────────────────────────────
function truncate(s, max) {
  if (!s) return s;
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join("") + "…";
}

function fmtTime(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "presence-discord/1.0" } }, res => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ─── Cache borné ──────────────────────────────────────────────────────────────
function boundedMap(max) {
  const m = new Map();
  return {
    has: k => m.has(k),
    get: k => m.get(k),
    set(k, v) { if (m.size >= max) m.delete(m.keys().next().value); m.set(k, v); },
  };
}

// ─── TMDB ─────────────────────────────────────────────────────────────────────
// Fallback de commodité — pas une vraie protection. Définis TMDB_API_KEY / DISCORD_CLIENT_ID dans .env.
function _dk(encoded) {
  const _s = "presence-discord";
  const _b = Buffer.from(encoded, "base64");
  return _b.map((b, i) => b ^ _s.charCodeAt(i % _s.length)).toString("utf8");
}
const TMDB_KEY     = process.env.TMDB_API_KEY     || _dk("QhBdFVJdBgQVUl8QV19BBxJFBhdXXwBSHgBeEFYNRFw=");
const episodeCache = boundedMap(200);

// Throttle : 1 requête toutes les 250 ms maximum
let _tmdbNextAt = 0;
async function tmdbThrottle() {
  const now   = Date.now();
  const delay = Math.max(0, _tmdbNextAt - now);
  _tmdbNextAt = Math.max(now, _tmdbNextAt) + 250;
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
}

async function fetchTMDBEpisodeTitle(seriesTitle, season, episode) {
  const key = `${seriesTitle}:s${season}e${episode}`;
  if (episodeCache.has(key)) return episodeCache.get(key);
  try {
    await tmdbThrottle();
    const search = await httpsGet(
      `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&language=fr-FR&query=${encodeURIComponent(seriesTitle)}`
    );
    const tvId = search?.results?.[0]?.id;
    if (!tvId) {
      L.tmdb(`${C.yl}TMDB : aucun résultat pour "${seriesTitle}"${C.r}`);
      episodeCache.set(key, null); return null;
    }
    const ep    = await httpsGet(
      `https://api.themoviedb.org/3/tv/${tvId}/season/${season}/episode/${episode}?api_key=${TMDB_KEY}&language=fr-FR`
    );
    const title = ep?.name || null;
    if (!title) L.tmdb(`${C.yl}TMDB S${season}E${episode} sans titre${C.r}`);
    episodeCache.set(key, title);
    return title;
  } catch (e) {
    L.tmdb(`${C.yl}TMDB erreur : ${e.message}${C.r}`);
    episodeCache.set(key, null);
    return null;
  }
}

const posterCache = boundedMap(200);

async function fetchTMDBPoster(title) {
  if (!title || !TMDB_KEY) return null;
  if (posterCache.has(title)) return posterCache.get(title);
  try {
    await tmdbThrottle();
    const data = await httpsGet(
      `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=fr-FR`
    );
    const r = data?.results?.find(r => r.poster_path && r.media_type !== "person");
    const url = r ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null;
    posterCache.set(title, url);
    return url;
  } catch (e) {
    L.tmdb(`${C.yl}TMDB poster erreur : ${e.message}${C.r}`);
    posterCache.set(title, null);
    return null;
  }
}

async function enrichPayload(p) {
  const enriched = { ...p };
  if (enriched.episodeTitle && /S\d+\s*:\s*E\d+/i.test(enriched.episodeTitle)) enriched.episodeTitle = null;
  if (enriched.contentType === "series" && !enriched.episodeTitle
      && enriched.seriesTitle && enriched.season != null && enriched.episodeNum != null) {
    enriched.episodeTitle = await fetchTMDBEpisodeTitle(enriched.seriesTitle, enriched.season, enriched.episodeNum);
  }
  const needsPoster = !enriched.poster && (
    NEEDS_TMDB_POSTER_TYPES.has(enriched.type)
  );
  if (needsPoster) {
    const searchTitle = enriched.seriesTitle || enriched.movieTitle || enriched.title;
    if (searchTitle) enriched.poster = await fetchTMDBPoster(searchTitle);
  }
  return enriched;
}

// ─── Assets Discord (CDN URLs pour play/pause) ────────────────────────────────
const assetUrls = { play: "", pause: "" };

async function fetchAssetUrls(retryMs = 5_000) {
  try {
    const assets = await httpsGet(
      `https://discord.com/api/v10/oauth2/applications/${config.clientId}/assets`
    );
    if (!Array.isArray(assets) || assets.length === 0) {
      L.cfg(`${C.yl}Assets non récupérés — vérifie le Developer Portal.${C.r}`);
      setTimeout(() => fetchAssetUrls(Math.min(retryMs * 2, 60_000)), retryMs);
      return;
    }
    for (const a of assets) {
      const url = `https://cdn.discordapp.com/app-assets/${config.clientId}/${a.id}.png`;
      if (a.name === "play")  { assetUrls.play  = url; }
      if (a.name === "pause") { assetUrls.pause = url; }
    }
    if (!assetUrls.play || !assetUrls.pause) {
      L.cfg(`${C.yl}Assets "play"/"pause" introuvables — vérifie les noms dans le portail.${C.r}`);
      setTimeout(() => fetchAssetUrls(Math.min(retryMs * 2, 60_000)), retryMs);
    }
  } catch (e) {
    L.cfg(`${C.yl}Impossible de récupérer les assets Discord : ${e.message}${C.r}`);
    setTimeout(() => fetchAssetUrls(Math.min(retryMs * 2, 60_000)), retryMs);
  }
}

// ─── Présence ─────────────────────────────────────────────────────────────────
const PLATFORM_LOG = Object.fromEntries(PLATFORMS.map(platform => [platform.type, L[platform.log] || L.pre]));

function buildDetailsAndState(p) {
  const isTwitch = p.type === "twitch_presence";
  const fallback = PLATFORM_LABEL[p.type] || "Cinepulse";

  let details, state;
  switch (p.contentType) {
    case "series":
      details = p.episodeTitle || p.seriesTitle || fallback;
      state   = p.season != null && p.episodeNum != null
        ? `Saison ${p.season} · Épisode ${p.episodeNum}` : null;
      break;
    case "movie":
      details = p.movieTitle || p.title || fallback;
      state   = null;
      break;
    case "video":
      if (isTwitch) {
        // details = titre du stream (ce qui est diffusé), state = streamer · jeu
        details = p.streamTitle || p.videoTitle || p.title || fallback;
        const streamerPart  = p.videoTitle || p.title || "";
        const categoryPart  = p.channel || "";
        state = streamerPart && categoryPart
          ? `${streamerPart} · ${categoryPart}`
          : streamerPart || categoryPart || null;
      } else {
        details = p.videoTitle || p.title || fallback;
        state   = p.channel || null;
      }
      break;
    default:
      details = p.episodeTitle || p.title || fallback;
      state   = null;
  }
  return { details: truncate(details, 128), state: state ? truncate(state, 128) : null };
}

function buildActivity(p) {
  const now       = Math.floor(Date.now() / 1000);
  const isPlaying = p.isPlaying;
  const isYT      = p.type === "youtube_presence";
  const isTwitch  = p.type === "twitch_presence";

  const poster = p.poster?.startsWith("https://")
    ? (isYT && p.poster.includes("maxresdefault")
        ? p.poster.replace("maxresdefault", "mqdefault")
        : p.poster)
    : (DEFAULT_LARGE_IMAGE_TYPES.has(p.type) ? config.largeImageDefault : null);

  const { details, state } = buildDetailsAndState(p);
  const mainTitle = truncate(p.seriesTitle || p.movieTitle || p.videoTitle || p.title || "", 128);

  const largeIsUrl = poster?.startsWith("https://");
  let smallImage;
  if (largeIsUrl) {
    const cfgUrl = isPlaying ? config.smallImagePlayUrl : config.smallImagePauseUrl;
    const cdnUrl = isPlaying ? assetUrls.play : assetUrls.pause;
    smallImage = (cfgUrl?.startsWith("https://") ? cfgUrl : cdnUrl) || undefined;
  } else if (poster) {
    smallImage = (isPlaying ? config.smallImagePlay : config.smallImagePause) || undefined;
  }

  // Tooltip sur l'avatar (large_text)
  let largeText = mainTitle || undefined;
  if (isTwitch) {
    const streamer = p.videoTitle || p.title || "";
    const cat      = p.channel ? ` · ${p.channel}` : "";
    largeText = streamer ? `${streamer}${cat}` : undefined;
  }

  const activity = {
    type: 3,
    name: isYT ? "YouTube" : isTwitch ? "Twitch" : (mainTitle || details),
    details,
    assets: {
      large_image: poster || undefined,
      large_text:  largeText,
      small_image: smallImage,
      small_text:  smallImage
        ? (p.isAd ? "Publicité" : isPlaying ? "En lecture" : "En pause")
        : undefined,
    },
  };
  if (state) activity.state = state;
  const btnLabel = p.isLive ? "Regarder en direct" : "Regarder";
  if (p.url) activity.buttons = [{ label: btnLabel, url: p.url }];

  if (p.isAd) {
    activity.timestamps = {};
  } else if (p.isLive) {
    activity.timestamps = p.liveStartAt ? { start: Math.floor(p.liveStartAt / 1000) } : {};
  } else if (isPlaying && p.duration > 0 && p.currentTime != null) {
    activity.timestamps = {
      start: now - Math.floor(p.currentTime),
      end:   now + Math.max(1, Math.floor(p.duration - p.currentTime)),
    };
  } else {
    activity.timestamps = {};
  }

  return activity;
}

let pendingActivity   = null;
let lastSentPayload   = null;
let lastSentAt        = 0;
let activeWsClient    = null;
let currentMediaState = null;
let lastLoggedKey     = "";
let liveStartAt       = null;
let liveTitle         = null;

function hasChanged(a, b) {
  if (!b) return true;
  if ((a.seriesTitle || a.title) !== (b.seriesTitle || b.title)) return true;
  if (a.streamTitle  !== b.streamTitle)  return true;
  if (a.isPlaying    !== b.isPlaying)    return true;
  if (a.season       !== b.season)       return true;
  if (a.episodeNum   !== b.episodeNum)   return true;
  if (a.episodeTitle !== b.episodeTitle) return true;
  if (a.isLive !== b.isLive)            return true;
  if (a.isLive && b.isLive)            return false;
  return Math.abs((a.currentTime || 0) - (b.currentTime || 0)) >= 5;
}

async function applyActivity(payload) {
  if (!discord.ready) { pendingActivity = payload; return; }
  if (!payload || payload.type === "presence_clear") {
    if (lastSentPayload !== null) {
      discord.clearActivity();
      L.pre(`${C.dim}Présence effacée${C.r}`);
    }
    lastSentPayload = null; currentMediaState = null; lastLoggedKey = "";
    liveStartAt = null; liveTitle = null;
    return;
  }
  if (payload.isLive) {
    if (payload.title !== liveTitle) { liveTitle = payload.title; liveStartAt = Date.now(); }
    payload = { ...payload, liveStartAt };
  }
  const now = Date.now();
  if (!hasChanged(payload, lastSentPayload) && now - lastSentAt <= 30000) return;

  let enriched;
  try {
    enriched = await enrichPayload(payload);
  } catch (e) {
    L.pre(`${C.yl}Enrichissement échoué, payload brut utilisé : ${e.message}${C.r}`);
    enriched = payload;
  }
  const activity = buildActivity(enriched);
  discord.setActivity(activity);
  lastSentPayload = enriched; lastSentAt = now;
  pendingActivity = null; currentMediaState = enriched;
  if (activeWsClient?.readyState === 1) {
    try { activeWsClient.send(JSON.stringify({ type: "enriched_update", payload: enriched })); } catch (e) { L.ws(`${C.yl}enriched_update non livré : ${e.message}${C.r}`); }
  }

  const isTwitch = enriched.type === "twitch_presence";
  const log      = PLATFORM_LOG[enriched.type] || L.cp;

  const mainTitle = enriched.seriesTitle || enriched.movieTitle || enriched.videoTitle || enriched.title || "?";
  const epInfo    = enriched.season != null && enriched.episodeNum != null
    ? `  ${C.dim}S${enriched.season}E${enriched.episodeNum}${C.r}` : "";
  const epTitle   = enriched.episodeTitle ? `  ${C.cy}"${enriched.episodeTitle}"${C.r}` : "";
  const streamTitleStr = enriched.streamTitle ? `  ${C.cy}"${enriched.streamTitle}"${C.r}` : "";
  const channel   = enriched.channel ? `  ${C.dim}· ${enriched.channel}${C.r}` : "";
  const stateStr  = enriched.isPlaying ? `${C.gr}▶${C.r}` : `${C.yl}⏸${C.r}`;
  const time      = enriched.isLive
    ? `${C.re}🔴 direct${C.r}`
    : `${C.dim}${fmtTime(enriched.currentTime)} / ${fmtTime(enriched.duration)}${C.r}`;

  const logKey = `${enriched.type}|${enriched.seriesTitle||enriched.title}|${enriched.streamTitle}|${enriched.episodeNum}|${enriched.isPlaying}`;
  if (logKey !== lastLoggedKey) {
    lastLoggedKey = logKey;
    const extra = isTwitch ? streamTitleStr + channel : epInfo + epTitle + channel;
    log(`${C.w}${mainTitle}${C.r}${extra}  ${stateStr}  ${time}`);
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ host: "127.0.0.1", port: config.port });

wss.on("listening", () => {
  L.ws(`En écoute sur ${C.dim}ws://127.0.0.1:${config.port}${C.r}`);
});

wss.on("connection", (sock, request) => {
  const origin = request.headers.origin || "";
  if (origin && !origin.startsWith("chrome-extension://")) {
    L.ws(`${C.re}Connexion refusée — origin suspecte : ${origin}${C.r}`);
    sock.close(1008, "Forbidden");
    return;
  }
  if (config.extensionId && origin !== `chrome-extension://${config.extensionId}`) {
    L.ws(`${C.re}Connexion refusée — extension ID non autorisé : ${origin}${C.r}`);
    sock.close(1008, "Forbidden");
    return;
  }
  activeWsClient = sock;
  L.ws(`${C.gr}Extension connectée${C.r}`);
  sock.on("message", data => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (PRESENCE_TYPES.has(msg.type)) {
      applyActivity(msg);
    } else if (msg.type === "presence_clear") {
      applyActivity(msg);
    }
  });
  sock.on("close", () => { activeWsClient = null; L.ws(`${C.dim}Extension déconnectée${C.r}`); });
});


wss.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    L.ws(`${C.re}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}`);
    L.ws(`${C.re}⚠  PORT ${config.port} DÉJÀ UTILISÉ${C.r}`);
    L.ws(`${C.re}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}`);
    L.ws(`${C.yl}Un autre programme occupe ce port. Solutions :${C.r}`);
    L.ws(`${C.dim}  1. Ferme l'autre instance de Presence-Discord si elle tourne${C.r}`);
    L.ws(`${C.dim}  2. Change le port dans companion/config.json${C.r}`);
    L.ws(`${C.dim}  3. Trouve qui utilise le port :${C.r}`);
    L.ws(`${C.dim}     netstat -ano | findstr :${config.port}${C.r}`);
    L.ws(`${C.re}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.r}`);
  } else {
    L.ws(`${C.re}Erreur : ${e.message}${C.r}`);
  }
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
fetchAssetUrls();
discord.connect();

process.on("SIGINT", () => {
  L.exit(`${C.dim}Arrêt…${C.r}`);
  shutdown();
  wss.close(() => process.exit(0));
});

// ─── Exports (Electron) ───────────────────────────────────────────────────────
function getState() {
  return {
    payload:       currentMediaState,
    wsConnected:   wss.clients.size > 0,
    discConnected: discord.ready,
    platforms:     PLATFORMS.map(({ id, name, type }) => ({ id, name, type })),
  };
}

function shutdown() {
  try { discord.clearActivity(); } catch {}
  try { discord.destroy();       } catch {}
}

module.exports = { getState, shutdown };
