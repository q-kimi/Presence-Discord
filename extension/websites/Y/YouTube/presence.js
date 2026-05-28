(function () {
  const YouTubeSPA = (() => {
    let currentVideoId = null;
    let onChangeCb = null;
    let debounceTimer = null;

    function getVideoId() {
      const v = new URLSearchParams(location.search).get("v");
      if (v) return v;
      const s = location.pathname.match(/^\/shorts\/([^/?]+)/);
      return s ? s[1] : null;
    }

    function notify(reason) {
      const newId = getVideoId();
      if (newId === currentVideoId) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const finalId = getVideoId();
        if (finalId === currentVideoId) return;
        currentVideoId = finalId;
        onChangeCb?.({ newId: finalId, reason });
      }, 150);
    }

    document.addEventListener("yt-navigate-finish", () => notify("yt-navigate-finish"));
    document.addEventListener("yt-page-data-updated", () => notify("yt-page-data-updated"));

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const r = origPush.apply(this, arguments);
      notify("pushState");
      return r;
    };
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      notify("replaceState");
      return r;
    };
    window.addEventListener("popstate", () => notify("popstate"));

    const titleEl = document.querySelector("title");
    if (titleEl) new MutationObserver(() => notify("title")).observe(titleEl, { childList: true });
    setInterval(() => { if (getVideoId()) notify("poll"); }, 1000);

    return {
      onChange(cb) { onChangeCb = cb; },
      init() { currentVideoId = getVideoId(); },
      getVideoId,
    };
  })();

  function getYouTubeInfo() {
    let title = null;
    for (const sel of [
      "h1.ytd-watch-metadata yt-formatted-string",
      "h1.style-scope.ytd-watch-metadata",
      "#title h1 yt-formatted-string",
      "ytd-watch-metadata #title yt-formatted-string",
      ".ytp-title-link.yt-uix-sessionlink"
    ]) {
      const t = document.querySelector(sel)?.textContent?.trim();
      if (t) { title = t; break; }
    }

    if (!title && navigator.mediaSession?.metadata?.title) title = navigator.mediaSession.metadata.title;
    if (!title) {
      title = document.title
        .replace(/^\(\d+\)\s*/, "")
        .replace(/\s*-\s*YouTube\s*$/i, "")
        .trim() || null;
    }

    let channel = null;
    for (const sel of [
      "#top-row ytd-channel-name #text a",
      "ytd-video-owner-renderer ytd-channel-name a",
      "#owner #channel-name a",
      "#upload-info ytd-channel-name a"
    ]) {
      const t = document.querySelector(sel)?.textContent?.trim();
      if (t) { channel = t; break; }
    }

    const videoId = new URLSearchParams(location.search).get("v");
    const playlist = document.querySelector("#playlist-name")?.textContent?.trim()
      || document.querySelector("ytd-playlist-panel-renderer #title")?.textContent?.trim()
      || null;
    const poster = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
    const isAd = !!document.querySelector(".ytp-ad-player-overlay, .video-ads .ytp-ad-module:not(:empty)");

    return { title, channel, videoId, playlist, poster, isAd };
  }

  PresenceDiscord.registerPresence({
    id: "youtube",
    type: "youtube_presence",

    setup(ctx) {
      YouTubeSPA.init();
      YouTubeSPA.onChange(({ newId }) => {
        ctx.resetSiteState();
        if (!newId) {
          ctx.clearPresence();
          return;
        }
        ctx.tickSoon(300, 800);
      });
    },

    shouldRun() {
      return !!new URLSearchParams(location.search).get("v") && !location.pathname.startsWith("/shorts/");
    },

    getVideo() {
      return document.querySelector("video.html5-main-video")
        || document.querySelector(".html5-video-player video")
        || null;
    },

    getEpisodeButtonSelector(dir) {
      return dir === "next" ? ".ytp-next-button, a.ytp-next-button" : null;
    },

    buildPayload(video, ctx) {
      const yt = getYouTubeInfo();

      if (yt.isAd) {
        if (ctx.lastPayload && !ctx.lastPayload.isAd) {
          return { ...ctx.lastPayload, isAd: true, isPlaying: false, timestamp: Date.now() };
        }
        return null;
      }

      if (ctx.lastPayload?.isAd) ctx.forgetLastPayload();

      const title = yt.title || "YouTube";
      const poster = ctx.cachePoster(title, yt.poster);
      const isPlaying = !video.paused && !video.ended;
      const isLive = video.duration === Infinity;

      return {
        type: "youtube_presence",
        title,
        videoTitle: title,
        channel: yt.channel || null,
        contentType: "video",
        poster,
        isPlaying,
        isLive,
        currentTime: Math.floor(video.currentTime || 0),
        duration: isLive ? 0 : Math.floor(video.duration || 0),
        url: location.href.split("&list=")[0],
        timestamp: Date.now()
      };
    }
  });
})();
