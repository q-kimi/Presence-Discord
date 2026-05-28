// Shared runtime loaded before each website presence module.
(function () {
  function isInvalidatedError(e) {
    return e?.message === "Extension context invalidated.";
  }

  window.addEventListener("unhandledrejection", (ev) => {
    if (isInvalidatedError(ev.reason)) {
      ev.preventDefault();
      pauseForContextRecovery();
    }
  });
  window.addEventListener("error", (ev) => {
    if (isInvalidatedError(ev.error)) {
      ev.preventDefault();
      pauseForContextRecovery();
    }
  });

  let presence = null;
  let lastPayload = null;
  let lastTitle = null;
  let cachedPoster = null;
  let currentVideo = null;
  let pollHandle = null;
  let isTabHidden = document.visibilityState === "hidden";
  let noVideoCount = 0;
  let contextRetryTimer = null;
  let keepalivePort = null;
  let setupDone = false;

  const ctx = {
    get lastPayload() { return lastPayload; },
    get cachedPoster() { return cachedPoster; },

    cachePoster(title, poster) {
      if (title !== lastTitle) {
        lastTitle = title;
        cachedPoster = typeof poster === "function" ? poster() : poster;
      }
      return cachedPoster;
    },

    setCachedPoster(poster) {
      cachedPoster = poster || null;
      return cachedPoster;
    },

    forgetLastPayload() {
      lastPayload = null;
    },

    resetSiteState,
    clearPresence,
    tickSoon,
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (!isContextValid()) return;

    if (msg?.kind === "prefs_updated") {
      lastPayload = null;
      tick();
      return;
    }

    if (msg?.kind === "media_control") {
      if (!currentVideo) return;
      if (currentVideo.paused) currentVideo.play().catch(() => {});
      else currentVideo.pause();
      return;
    }

    if (msg?.kind === "media_prev" || msg?.kind === "media_next") {
      clickEpisodeBtn(msg.kind === "media_next" ? "next" : "prev");
    }
  });

  function payloadEquals(a, b) {
    if (!a || !b) return a === b;
    return a.title === b.title
      && a.isPlaying === b.isPlaying
      && a.episodeTitle === b.episodeTitle
      && a.streamTitle === b.streamTitle
      && a.isLive === b.isLive
      && a.duration === b.duration
      && a.poster === b.poster
      && ((a.isLive && b.isLive) || Math.abs((a.currentTime || 0) - (b.currentTime || 0)) < 5);
  }

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  function sendUpdate(payload) {
    if (!isContextValid()) {
      pauseForContextRecovery();
      return;
    }

    chrome.runtime.sendMessage({ kind: "presence_update", payload }, () => {
      if (!chrome.runtime.lastError) return;
      if (!isContextValid()) {
        pauseForContextRecovery();
        return;
      }
      setTimeout(() => {
        if (!isContextValid()) {
          pauseForContextRecovery();
          return;
        }
        chrome.runtime.sendMessage({ kind: "presence_update", payload }, () => void chrome.runtime.lastError);
      }, 300);
    });
  }

  function clearPresence() {
    if (currentVideo) detachVideo();
    if (lastPayload) {
      lastPayload = null;
      sendUpdate({ type: "presence_clear" });
    }
  }

  function pauseForContextRecovery() {
    clearInterval(pollHandle);
    pollHandle = null;
    if (contextRetryTimer) return;

    let attempts = 0;
    contextRetryTimer = setInterval(() => {
      attempts++;
      if (isContextValid()) {
        clearInterval(contextRetryTimer);
        contextRetryTimer = null;
        start();
        connectKeepalive();
      } else if (attempts >= 30) {
        clearInterval(contextRetryTimer);
        contextRetryTimer = null;
        detachVideo();
      }
    }, 2000);
  }

  function teardown() {
    clearInterval(pollHandle);
    pollHandle = null;
    clearInterval(contextRetryTimer);
    contextRetryTimer = null;
    detachVideo();
  }

  function resetSiteState() {
    detachVideo();
    lastPayload = null;
    lastTitle = null;
    cachedPoster = null;
  }

  function tickSoon(...delays) {
    for (const delay of delays) setTimeout(tick, delay);
  }

  function getActiveVideo() {
    const customVideo = presence?.getVideo?.();
    if (customVideo?.duration && !Number.isNaN(customVideo.duration)) return customVideo;
    if (customVideo) return customVideo;

    const videos = document.querySelectorAll("video");
    for (const v of videos) if (!v.paused && !v.ended && v.readyState >= 2) return v;
    for (const v of videos) if (v.duration > 0 && !Number.isNaN(v.duration)) return v;
    return videos[0] || null;
  }

  async function tick() {
    try {
      if (!isContextValid()) {
        teardown();
        return;
      }
      if (!presence || isTabHidden) return;

      if (presence.shouldRun && !presence.shouldRun()) {
        clearPresence();
        return;
      }

      const video = getActiveVideo();
      if (!video) {
        if (currentVideo) detachVideo();
        if (lastPayload && !presence.keepPresenceWithoutVideo) {
          noVideoCount++;
          if (noVideoCount >= 2) {
            noVideoCount = 0;
            clearPresence();
          }
        }
        return;
      }
      noVideoCount = 0;

      attachVideo(video);
      const payload = await presence.buildPayload(video, ctx);
      if (!payload) return;

      if (!payloadEquals(payload, lastPayload)) {
        lastPayload = payload;
        sendUpdate(payload);
      }
    } catch (e) {
      if (!isContextValid()) pauseForContextRecovery();
      else console.debug("[Presence Discord] tick failed", e);
    }
  }

  function attachVideo(video) {
    if (currentVideo === video) return;
    detachVideo();
    currentVideo = video;
    video.addEventListener("play", onVideoPlay);
    video.addEventListener("pause", onVideoPause);
    video.addEventListener("seeked", onVideoSeeked);
    video.addEventListener("ended", onVideoEnded);
  }

  function detachVideo() {
    if (!currentVideo) return;
    currentVideo.removeEventListener("play", onVideoPlay);
    currentVideo.removeEventListener("pause", onVideoPause);
    currentVideo.removeEventListener("seeked", onVideoSeeked);
    currentVideo.removeEventListener("ended", onVideoEnded);
    currentVideo = null;
  }

  function clickEpisodeBtn(dir) {
    const selector = presence?.getEpisodeButtonSelector?.(dir)
      || (dir === "next"
        ? "button[aria-label*='next' i], button[aria-label*='suivant' i], button[title*='next' i], button[title*='suivant' i]"
        : "button[aria-label*='previous' i], button[aria-label*='precedent' i], button[title*='previous' i], button[title*='precedent' i]");
    if (!selector) return;

    const btn = document.querySelector(selector);
    if (btn) btn.click();
  }

  function onVideoPlay() { tick(); }
  function onVideoPause() { tick(); }
  function onVideoSeeked() { tick(); }
  function onVideoEnded() {
    detachVideo();
    if (presence?.clearOnEnded === false) return;
    lastPayload = null;
    sendUpdate({ type: "presence_clear" });
  }

  function start() {
    if (!presence || pollHandle) return;

    connectKeepalive();

    if (!setupDone) {
      setupDone = true;
      presence.setup?.(ctx);
    }

    pollHandle = setInterval(tick, 2000);
    tick();
  }

  function updateTabHidden() {
    const wasHidden = isTabHidden;
    isTabHidden = document.visibilityState === "hidden";
    if (wasHidden && !isTabHidden) tick();
  }

  function connectKeepalive() {
    if (!isContextValid()) return;
    try {
      if (keepalivePort) {
        try { keepalivePort.disconnect(); } catch {}
      }
      keepalivePort = chrome.runtime.connect({ name: "keepalive" });
      keepalivePort.onDisconnect.addListener(() => {
        keepalivePort = null;
        setTimeout(() => { if (isContextValid()) connectKeepalive(); }, 1000);
      });
    } catch {}
  }

  window.PresenceDiscord = {
    registerPresence(definition) {
      if (!definition?.id || typeof definition.buildPayload !== "function") {
        throw new Error("Invalid presence definition");
      }
      presence = definition;
      start();
    }
  };

  document.addEventListener("visibilitychange", updateTabHidden);
  window.addEventListener("beforeunload", () => {
    if (presence && lastPayload) sendUpdate({ type: "presence_clear" });
  });
})();
