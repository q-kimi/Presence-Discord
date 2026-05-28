(function () {
  function getNakastreamInfo() {
    const params = new URLSearchParams(location.search);
    const title = params.get("title")
      || document.querySelector("span.nk-title")?.textContent?.trim()
      || null;
    const posterPath = params.get("poster");
    const poster = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
    const type = params.get("type");
    const season = params.get("season") || params.get("s");
    const ep = params.get("episode") || params.get("ep") || params.get("e");
    const episodeTitle = params.get("ep_title") || params.get("episode_title") || params.get("etitle") || null;
    const contentType = type === "movie" ? "movie" : "series";
    return { title, poster, contentType, seasonNum: season ? Number(season) : null, episodeNum: ep ? Number(ep) : null, episodeTitle };
  }

  PresenceDiscord.registerPresence({
    id: "nakastream",
    type: "nakastream_presence",

    shouldRun() {
      return location.pathname.startsWith("/player");
    },

    getEpisodeButtonSelector(dir) {
      return dir === "next"
        ? "[data-testid='next-episode'], .next-episode, button[aria-label*='suivant' i], button[aria-label*='next' i], .player-next"
        : "[data-testid='prev-episode'], .prev-episode, button[aria-label*='pr\\0000e9 c\\0000e9 dent' i], button[aria-label*='precedent' i], button[aria-label*='previous' i], .player-prev";
    },

    buildPayload(video, ctx) {
      const nk = getNakastreamInfo();
      const title = nk.title || "Nakastream";
      const poster = ctx.cachePoster(title, nk.poster);

      return {
        type: "nakastream_presence",
        title,
        seriesTitle: nk.contentType === "series" ? title : null,
        movieTitle: nk.contentType === "movie" ? title : null,
        episodeTitle: nk.episodeTitle || null,
        contentType: nk.contentType,
        season: nk.seasonNum,
        episodeNum: nk.episodeNum,
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
