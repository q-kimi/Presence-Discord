(function () {
  const PrimeVideoSPA = (() => {
    let currentPath = location.pathname;
    let onChangeCb = null;

    function notify() {
      const newPath = location.pathname;
      if (newPath === currentPath) return;
      currentPath = newPath;
      onChangeCb?.({ path: newPath });
    }

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () { const r = origPush.apply(this, arguments); setTimeout(notify, 150); return r; };
    history.replaceState = function () { const r = origReplace.apply(this, arguments); setTimeout(notify, 150); return r; };
    window.addEventListener("popstate", () => setTimeout(notify, 150));

    return {
      onChange(cb) { onChangeCb = cb; },
      init() { currentPath = location.pathname; },
    };
  })();

  function getPrimeVideoInfo() {
    let title = null;
    for (const el of document.querySelectorAll(".atvwebplayersdk-title-text")) {
      const t = el.textContent?.trim();
      if (t && t.length > 1) { title = t; break; }
    }

    let subtitle = null;
    for (const el of document.querySelectorAll(".atvwebplayersdk-subtitle-text")) {
      const t = el.textContent?.trim();
      if (t && t.length > 1) { subtitle = t; break; }
    }

    let seasonNum = null;
    let episodeNum = null;
    let episodeTitle = null;
    if (subtitle) {
      const m = subtitle.match(/[Ss]a?ison\s+(\d+)\D+(\d+)\s*[\u00b7\u2022|\u2013\u2014-]?\s*(.*)/);
      if (m) {
        seasonNum = Number(m[1]);
        episodeNum = Number(m[2]);
        const rawTitle = m[3]?.trim();
        if (rawTitle && rawTitle.length > 1) episodeTitle = rawTitle;
      }
    }

    const contentType = seasonNum != null ? "series" : "movie";
    if (!title) {
      title = document.title
        .replace(/^Prime\s*Video\s*:\s*/i, "")
        .replace(/\s*[\u2013\u2014-]\s*(Saison|Season)\s*\d+.*$/i, "")
        .replace(/\s*[-|\u2013\u2014]\s*Amazon Prime Video\s*$/i, "")
        .replace(/\s*[-|\u2013\u2014]\s*Prime Video\s*$/i, "")
        .trim() || null;
    }

    return { title, contentType, seasonNum, episodeNum, episodeTitle, poster: null };
  }

  PresenceDiscord.registerPresence({
    id: "primevideo",
    type: "primevideo_presence",

    setup(ctx) {
      PrimeVideoSPA.init();
      PrimeVideoSPA.onChange(() => {
        ctx.resetSiteState();
        ctx.tickSoon(300, 800);
      });
    },

    shouldRun() {
      return /\/(detail|watch)\//.test(location.pathname);
    },

    getEpisodeButtonSelector(dir) {
      return dir === "next"
        ? "[data-testid='nextButton'], .nextButton, button[aria-label*='Next' i]"
        : "[data-testid='prevButton'], .prevButton, button[aria-label*='Previous' i]";
    },

    buildPayload(video, ctx) {
      const pv = getPrimeVideoInfo();
      const title = pv.title || "Prime Video";
      ctx.cachePoster(title, null);

      return {
        type: "primevideo_presence",
        title,
        seriesTitle: pv.contentType === "series" ? title : null,
        movieTitle: pv.contentType === "movie" ? title : null,
        episodeTitle: pv.episodeTitle || null,
        contentType: pv.contentType,
        season: pv.seasonNum,
        episodeNum: pv.episodeNum,
        poster: null,
        isPlaying: !video.paused && !video.ended,
        currentTime: Math.floor(video.currentTime || 0),
        duration: Math.floor(video.duration || 0),
        isLive: false,
        url: location.origin + location.pathname,
        timestamp: Date.now()
      };
    }
  });
})();
