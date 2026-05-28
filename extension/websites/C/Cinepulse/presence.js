(function () {
  let ariaLabel = null;
  let ariaInfo = null;

  const GENERIC_TITLES = [
    "plateforme multimedia en ligne",
    "cinepulse", "streaming", "accueil", "home", "watch", "player", "video player"
  ];

  function getEpisodeTitleFromPage(seriesTitle) {
    for (const sel of [
      ".episode-title", ".ep-title", ".title-episode",
      "[class*='episode'] h2", "[class*='episode'] h3",
      "[class*='episode-name']", "[class*='episodeName']",
      "h2.title", ".player-title h2", ".video-title h2",
      "[data-episode-title]"
    ]) {
      const el = document.querySelector(sel);
      const t = (el?.getAttribute("data-episode-title") || el?.textContent)?.trim();
      if (t && t.length > 1 && t.toLowerCase() !== seriesTitle?.toLowerCase()) return t;
    }

    const ms = navigator.mediaSession?.metadata;
    if (ms?.title && ms.title !== seriesTitle && !/S\d+\s*:\s*E\d+/i.test(ms.title)) return ms.title;

    const raw = document.title
      .replace(/\s*[-|\u2013\u2014]\s*Cinepulse\s*$/i, "")
      .replace(/^Cinepulse\s*[-|\u2013\u2014]\s*/i, "")
      .trim();
    const withoutSeries = seriesTitle
      ? raw.replace(new RegExp(`^${seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-|\\u2013\\u2014]\\s*`, "i"), "")
      : raw;

    if (withoutSeries && withoutSeries !== raw && !/^S\d+.*E\d+/i.test(withoutSeries)
        && withoutSeries.toLowerCase() !== seriesTitle?.toLowerCase()) {
      return withoutSeries.split(/\s*[-|\u2013\u2014]\s*/)[0]?.trim() || null;
    }

    return null;
  }

  function getPlayerAriaInfo() {
    const el = document.querySelector('[role="region"][aria-label^="Video Player"]');
    if (!el) {
      ariaLabel = null;
      ariaInfo = null;
      return null;
    }
    const label = el.getAttribute("aria-label");
    if (label === ariaLabel) return ariaInfo;
    ariaLabel = label;

    const cleaned = label.replace(/^Video Player\s*-\s*/i, "");
    const parts = cleaned.split(/\s*-\s*/);
    const title = parts[0]?.trim() || null;
    const epMatch = cleaned.match(/S(\d+):E(\d+)/i);
    const seasonNum = epMatch ? Number(epMatch[1]) : null;
    const episodeNum = epMatch ? Number(epMatch[2]) : null;
    const quotedMatch = cleaned.match(/S\d+\s*:\s*E\d+\s*"([^"]*)"/i);
    const episodeTitle = quotedMatch?.[1]?.trim().length > 0 ? quotedMatch[1].trim() : null;
    ariaInfo = title ? { title, seasonNum, episodeNum, episodeTitle } : null;
    return ariaInfo;
  }

  function isGenericTitle(t) {
    if (!t || t.length < 2 || t.length > 150) return true;
    const l = t.toLowerCase();
    return GENERIC_TITLES.some(g => l === g || l.startsWith(g));
  }

  function cleanTitle(t) {
    if (!t) return null;
    return t.replace(/\s*[-|\u2013\u2014]\s*Cinepulse.*/i, "").replace(/Cinepulse\s*[-|\u2013\u2014]\s*/i, "").trim() || null;
  }

  function isHashId(s) {
    return s.length > 15 && !/[-_]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);
  }

  function titleFromUrl() {
    const skip = new Set([
      "film", "serie", "series", "movie", "watch", "voir", "streaming",
      "saison", "season", "episode", "play", "player", "players", "embed", "vf", "vostfr", "vo"
    ]);
    for (const part of decodeURIComponent(location.pathname).split("/").filter(Boolean)) {
      if (!skip.has(part.toLowerCase()) && !/^\d+$/.test(part) && part.length > 2 && !isHashId(part)) {
        return part.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      }
    }
    return null;
  }

  function getTitle(info) {
    if (info?.title && !isGenericTitle(info.title)) return info.title;
    const span = document.querySelector("span.text-pantone-400");
    if (span) {
      const t = span.textContent.trim();
      if (!isGenericTitle(t) && !t.toLowerCase().includes("cinepulse")) return t;
    }
    const fromDoc = cleanTitle(document.title);
    if (!isGenericTitle(fromDoc)) return fromDoc;
    return titleFromUrl();
  }

  function getPosterFromDom() {
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og?.startsWith("https://") && !og.includes("logo") && !og.includes("icon")) return og;
    for (const img of document.querySelectorAll("img")) {
      const src = img.src || img.dataset?.src;
      if (!src?.startsWith("https://")) continue;
      if (src.includes("logo") || src.includes("icon") || src.includes("avatar")) continue;
      const r = img.getBoundingClientRect();
      if (r.width > 80 && r.height > 100) return src;
    }
    return null;
  }

  PresenceDiscord.registerPresence({
    id: "cinepulse",
    type: "cinepulse_presence",

    getEpisodeButtonSelector(dir) {
      return dir === "next"
        ? "button[aria-label*='next' i], button[aria-label*='suivant' i], button[title*='next' i], button[title*='suivant' i]"
        : "button[aria-label*='previous' i], button[aria-label*='pr\\0000e9 c\\0000e9 dent' i], button[aria-label*='precedent' i], button[title*='previous' i], button[title*='precedent' i]";
    },

    buildPayload(video, ctx) {
      const info = getPlayerAriaInfo();
      const title = getTitle(info) || "Cinepulse";
      const episodeTitle = info?.episodeTitle || getEpisodeTitleFromPage(title) || null;
      const isSeries = info?.seasonNum != null || info?.episodeNum != null;
      const poster = ctx.cachePoster(title, () => getPosterFromDom());

      return {
        type: "cinepulse_presence",
        title,
        seriesTitle: isSeries ? title : null,
        movieTitle: isSeries ? null : title,
        episodeTitle,
        contentType: isSeries ? "series" : "movie",
        season: info?.seasonNum ?? null,
        episodeNum: info?.episodeNum ?? null,
        poster,
        isPlaying: !video.paused && !video.ended,
        currentTime: Math.floor(video.currentTime || 0),
        duration: Math.floor(video.duration || 0),
        url: location.href,
        timestamp: Date.now()
      };
    }
  });
})();
