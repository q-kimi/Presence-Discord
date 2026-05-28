// popup.js
const $ = id => document.getElementById(id);

let platforms = [];
let platformByType = {};
let siteState = {};
let prefsLoaded = false;
let inactiveTicks = 0;
let syncedPayload = null;
let syncedAt = 0;
let lastSec = -1;

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = n => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

function liveTime() {
  if (!syncedPayload) return 0;
  const base = syncedPayload.currentTime || 0;
  if (!syncedPayload.isPlaying) return base;
  if (syncedPayload.isLive) return base + (Date.now() - syncedAt) / 1000;
  return Math.min(base + (Date.now() - syncedAt) / 1000, syncedPayload.duration || base);
}

(function loop() {
  const p = syncedPayload;
  if (p?.isPlaying) {
    const cur = liveTime(), sec = Math.floor(cur);
    if (sec !== lastSec) {
      lastSec = sec;
      if (p.isLive) {
        const elapsed = p.liveStartAt ? Math.floor((Date.now() - p.liveStartAt) / 1000) : sec;
        $("npCurrent").textContent = fmtTime(elapsed);
      } else {
        $("npCurrent").textContent = fmtTime(cur);
        const dur = p.duration || 0;
        $("npBar").style.width = dur ? Math.min(100, cur / dur * 100) + "%" : "0%";
      }
    }
  }
  requestAnimationFrame(loop);
})();

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    const view = document.getElementById(`view-${btn.dataset.tab}`);
    if (!view) return;
    view.classList.add("active");
    view.querySelectorAll(".a").forEach(el => {
      el.classList.remove("a");
      void el.offsetHeight;
      el.classList.add("a");
    });
  });
});

function setPlatforms(nextPlatforms) {
  if (!Array.isArray(nextPlatforms) || nextPlatforms.length === 0 || platforms.length > 0) return;

  platforms = nextPlatforms;
  platformByType = Object.fromEntries(platforms.map(p => [p.type, p]));
  siteState = Object.fromEntries(platforms.map(p => [p.id, p.enabledByDefault !== false]));
  renderSiteToggles();
}

function renderSiteToggles() {
  const wrap = $("siteToggles");
  if (!wrap) return;
  wrap.textContent = "";

  for (const platform of platforms) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    row.dataset.site = platform.id;

    const name = document.createElement("span");
    name.className = "toggle-name";
    name.textContent = platform.name;

    const sw = document.createElement("div");
    sw.className = "switch on";
    sw.id = `sw-${platform.id}`;

    row.append(name, sw);
    row.addEventListener("click", () => setSwitch(platform.id, !siteState[platform.id]));
    wrap.append(row);
  }
}

function setSwitch(key, val) {
  siteState[key] = val;
  const el = $(`sw-${key}`);
  if (!el) return;
  el.classList.toggle("on", val);
}

async function loadPrefs(state) {
  setPlatforms(state.platforms);
  const savedSites = state.prefs?.enabledSites || {};
  for (const platform of platforms) {
    setSwitch(platform.id, savedSites[platform.id] !== false);
  }
  prefsLoaded = true;
}

async function refresh() {
  let state;
  try { state = await chrome.runtime.sendMessage({ kind: "get_state" }); }
  catch { return; }
  if (!state) return;

  setPlatforms(state.platforms);
  const ok = !!state.status?.connected;
  $("conn-dot").style.display = ok ? "flex" : "none";

  if (!prefsLoaded) await loadPrefs(state);

  const p = state.lastPayload;
  const active = !!platformByType[p?.type] && !!(p.title || p.seriesTitle || p.movieTitle || p.videoTitle);

  if (active) inactiveTicks = 0;
  else inactiveTicks++;

  const shouldHide = !active && inactiveTicks >= 2;

  $("npIdle").style.display = shouldHide ? "flex" : (active ? "none" : $("npIdle").style.display);
  $("npActive").style.display = shouldHide ? "none" : (active ? "flex" : $("npActive").style.display);

  if (!active) {
    if (shouldHide) {
      syncedPayload = null;
      const bd = $("npBackdrop");
      bd.style.backgroundImage = "none";
      bd.classList.remove("on");
    }
    return;
  }

  syncedPayload = p;
  syncedAt = p.timestamp || Date.now();
  lastSec = -1;

  const isLive = !!p.isLive;
  const playing = !!p.isPlaying;

  $("npPlatform").textContent = platformByType[p.type]?.name || "Presence";

  const bd = $("npBackdrop");
  if (p.poster) {
    bd.style.backgroundImage = `url("${p.poster}")`;
    bd.classList.add("on");
  } else {
    bd.style.backgroundImage = "none";
    bd.classList.remove("on");
  }

  $("npState").className = "np-state " + (playing ? "playing" : "paused");

  const badge = $("npBadge");
  badge.className = "np-badge " + (isLive ? "live" : playing ? "playing" : "paused");
  badge.textContent = isLive ? "En direct" : playing ? "En lecture" : "En pause";

  const poster = $("npPoster");
  if (p.poster) {
    poster.src = p.poster;
    poster.style.display = "block";
    poster.className = "np-poster";
  } else {
    poster.style.display = "none";
  }

  $("npTitle").textContent = p.seriesTitle || p.movieTitle || p.videoTitle || p.title || "";

  const epTitleEl = $("npEpTitle");
  const epTitleText = p.streamTitle || (p.contentType === "series" ? p.episodeTitle : null);
  if (epTitleText) {
    epTitleEl.textContent = epTitleText;
    epTitleEl.style.display = "";
  } else {
    epTitleEl.style.display = "none";
  }

  const epEl = $("npEpisode");
  if (p.contentType === "series" && p.season != null && p.episodeNum != null) {
    epEl.textContent = `Saison ${p.season} - Episode ${p.episodeNum}`;
    epEl.style.display = "";
  } else if (p.channel) {
    epEl.textContent = p.channel;
    epEl.style.display = "";
  } else {
    epEl.style.display = "none";
  }

  $("npBar").className = "prog-fill " + (playing ? "playing" : "paused");

  if (isLive) {
    const elapsed = p.liveStartAt ? Math.floor((Date.now() - p.liveStartAt) / 1000) : 0;
    $("npCurrent").textContent = fmtTime(elapsed);
    $("npDuration").textContent = "En direct";
    $("npBar").style.width = "0%";
  } else if (!playing) {
    const cur = p.currentTime || 0, dur = p.duration || 0;
    $("npCurrent").textContent = fmtTime(cur);
    $("npDuration").textContent = fmtTime(dur);
    $("npBar").style.width = dur ? Math.min(100, cur / dur * 100) + "%" : "0%";
  } else {
    $("npDuration").textContent = fmtTime(p.duration || 0);
  }

  const controls = $("mediaControls");
  const btnPP = $("btnPlayPause");
  if (active && !isLive) {
    controls.classList.add("visible");
    const nextState = playing ? "playing" : "paused";
    if (btnPP.dataset.state !== nextState) {
      btnPP.dataset.state = nextState;
      btnPP.innerHTML = playing
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;
    }
  } else {
    controls.classList.remove("visible");
  }
}

$("btnPlayPause").addEventListener("click", () => {
  chrome.runtime.sendMessage({ kind: "media_control" }).catch(() => {});
});
$("btnPrev").addEventListener("click", () => {
  chrome.runtime.sendMessage({ kind: "media_prev" }).catch(() => {});
});
$("btnNext").addEventListener("click", () => {
  chrome.runtime.sendMessage({ kind: "media_next" }).catch(() => {});
});

const SAVE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;

$("savePrefs").addEventListener("click", async () => {
  const enabledSites = Object.fromEntries(platforms.map(platform => [platform.id, siteState[platform.id]]));
  await chrome.storage.local.set({ enabledSites });
  await chrome.runtime.sendMessage({ kind: "prefs_updated" });

  const btn = $("savePrefs");
  const origHTML = btn.innerHTML;
  btn.innerHTML = `${CHECK_ICON} Enregistre`;
  setTimeout(() => { btn.innerHTML = origHTML || SAVE_ICON; }, 1500);
});

refresh();
setInterval(refresh, 1500);
