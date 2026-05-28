(function () {
  function hostIsPlex() {
    const host = location.hostname.toLowerCase();
    return host === "app.plex.tv" || host.endsWith(".plex.tv") || location.port === "32400";
  }

  function hasPlexSignals() {
    if (/plex/i.test(document.title)) return true;
    if (document.querySelector('meta[name="application-name"][content*="Plex" i]')) return true;
    if (document.querySelector('meta[property="og:site_name"][content*="Plex" i]')) return true;
    if (document.querySelector('link[href*="plex" i], script[src*="plex" i], img[src*="plex" i]')) return true;

    try {
      return Object.keys(localStorage).some(key => /plex/i.test(key));
    } catch {
      return false;
    }
  }

  function isPlexCandidate() {
    if (hostIsPlex()) return true;
    return location.pathname.startsWith("/web") && hasPlexSignals();
  }

  if (!isPlexCandidate()) return;

  function cleanText(value) {
    return value?.replace(/\s+/g, " ").trim() || null;
  }

  function cleanTitle(value) {
    const title = cleanText(value)
      ?.replace(/\s*[-|\u2013\u2014]\s*Plex\s*$/i, "")
      ?.replace(/^Plex\s*[-|\u2013\u2014]\s*/i, "")
      ?.trim();
    if (!title || /^plex$/i.test(title)) return null;
    return title;
  }

  function elementText(element) {
    if (!element) return null;
    if (!document.createTreeWalker) return cleanText(element.textContent);

    const walker = document.createTreeWalker(element, 4);
    const parts = [];
    while (walker.nextNode()) {
      const text = cleanText(walker.currentNode.nodeValue);
      if (text) parts.push(text);
    }

    return cleanText(parts.join(" "));
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const text = elementText(document.querySelector(selector));
      if (text) return text;
    }
    return null;
  }

  function firstAttribute(selectors, attribute) {
    for (const selector of selectors) {
      const value = cleanText(document.querySelector(selector)?.getAttribute(attribute));
      if (value) return value;
    }
    return null;
  }

  function parseEpisodeInfo(...values) {
    const text = values.filter(Boolean).join(" ");
    if (!text) return {};

    const patterns = [
      /\bS(?:eason|aison)?\s*(\d+)\s*(?:[:.\- ]|[\u00b7\u2022]\s*)\s*E(?:pisode)?\s*(\d+)\b/i,
      /\b(?:Season|Saison)\s*(\d+)\D+(?:Episode|Ep\.?|E)\s*(\d+)\b/i,
      /\b(\d+)\s*x\s*(\d+)\b/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return { season: Number(match[1]), episodeNum: Number(match[2]) };
    }

    const season = text.match(/\b(?:Season|Saison)\s*(\d+)\b/i)?.[1];
    const episode = text.match(/\b(?:Episode|Ep\.?|E)\s*(\d+)\b/i)?.[1];
    return {
      season: season ? Number(season) : null,
      episodeNum: episode ? Number(episode) : null
    };
  }

  function getEpisodeTitleFromText(value) {
    const text = cleanText(value);
    if (!text) return null;

    const match = text.match(/\b(?:S(?:eason|aison)?\s*\d+|(?:Season|Saison)\s*\d+)\s*(?:[\u00b7\u2022|:.\-]|\s)+\s*(?:E(?:pisode)?|Episode|Ep\.?)\s*\d+\s*(?:[\u00b7\u2022|\u2013\u2014-]+\s*)?(.*)$/i);
    const title = cleanTitle(match?.[1]?.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*\/.*$/i, ""));
    if (!title || /^\d+\s*min(?:ute)?s?(?:\s+restantes?)?$/i.test(title)) return null;
    return title;
  }

  function getPlayerMetadataText() {
    const metadata = firstText([
      '[data-testid="playerControlsContainer"] [class*="PlayerControlsMetadata-container"]'
    ]);
    if (metadata) return metadata;

    const duration = document.querySelector('[data-testid="mediaDuration"]');
    return cleanText(duration?.parentElement?.textContent);
  }

  function getMediaSessionInfo() {
    const metadata = navigator.mediaSession?.metadata;
    if (!metadata) return {};

    const artwork = Array.isArray(metadata.artwork)
      ? [...metadata.artwork].reverse().find(item => item.src?.startsWith("https://"))?.src
      : null;

    return {
      title: cleanTitle(metadata.title),
      artist: cleanTitle(metadata.artist),
      album: cleanTitle(metadata.album),
      poster: artwork || null
    };
  }

  function getDomInfo() {
    const playerMetadata = getPlayerMetadataText();

    const title = firstText([
      '[data-testid="metadata-title"]',
      '[data-testid="playerControlsContainer"] a[data-testid="metadataTitleLink"]',
      'a[data-testid="metadataTitleLink"]',
      '[data-qa-id*="title" i]',
      ".metadata-title",
      ".PlayerControls-title",
      "h1"
    ]);

    const subtitle = firstText([
      '[data-testid="metadata-subtitle"]',
      '[data-qa-id*="subtitle" i]',
      ".metadata-subtitle",
      ".PlayerControls-subtitle",
      "h2"
    ]);

    const metadataLine1 = firstText(['[data-testid="metadata-line1"]']);
    const titleAttribute = firstAttribute([
      '[data-testid="playerControlsContainer"] a[data-testid="metadataTitleLink"][title]',
      'a[data-testid="metadataTitleLink"][title]',
      '[data-testid="metadata-title"] [title]',
      '[data-testid="metadata-subtitle"][title]'
    ], "title");

    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const playerImage = document.querySelector('[data-testid="playerControlsContainer"] img[src^="https://"]')?.getAttribute("src");
    const poster = [ogImage, playerImage].find(src => src?.startsWith("https://")) || null;

    return {
      title: cleanTitle(title) || cleanTitle(titleAttribute),
      subtitle: cleanTitle(subtitle),
      documentTitle: cleanTitle(document.title),
      metadataLine1,
      playerMetadata,
      episodeTitleFromPlayer: getEpisodeTitleFromText(playerMetadata),
      episodeTitleFromLine: getEpisodeTitleFromText(metadataLine1),
      poster
    };
  }

  function getPlexInfo(ctx) {
    const media = getMediaSessionInfo();
    const dom = getDomInfo();
    const episode = parseEpisodeInfo(
      media.title,
      media.album,
      media.artist,
      dom.metadataLine1,
      dom.playerMetadata,
      dom.subtitle,
      dom.documentTitle
    );
    const hasEpisode = episode.season != null || episode.episodeNum != null;

    const likelySeriesTitle = hasEpisode
      ? (dom.title || (media.artist && media.artist !== media.title ? media.artist : null))
      : null;
    const likelyEpisodeTitle = hasEpisode
      ? (dom.subtitle || dom.episodeTitleFromPlayer || dom.episodeTitleFromLine || (media.title !== likelySeriesTitle ? media.title : null))
      : null;
    const fallbackTitle = dom.title || media.title || dom.documentTitle || "Plex";
    const contentType = hasEpisode || likelySeriesTitle ? "series" : "movie";
    const title = contentType === "series"
      ? (likelySeriesTitle || fallbackTitle)
      : fallbackTitle;

    const poster = ctx.cachePoster(title, media.poster || dom.poster || null);

    return {
      title,
      seriesTitle: contentType === "series" ? title : null,
      movieTitle: contentType === "movie" ? title : null,
      episodeTitle: contentType === "series" && likelyEpisodeTitle !== title ? likelyEpisodeTitle : null,
      contentType,
      season: episode.season ?? null,
      episodeNum: episode.episodeNum ?? null,
      poster
    };
  }

  function findVideoIn(root) {
    if (!root) return null;

    const videos = root.querySelectorAll?.("video") || [];
    for (const video of videos) if (!video.paused && !video.ended && video.readyState >= 2) return video;
    for (const video of videos) if (video.duration > 0 && !Number.isNaN(video.duration)) return video;
    if (videos[0]) return videos[0];

    const elements = root.querySelectorAll?.("*") || [];
    for (const element of elements) {
      const shadowVideo = findVideoIn(element.shadowRoot);
      if (shadowVideo) return shadowVideo;
    }

    return null;
  }

  function getPlexVideo() {
    const video = findVideoIn(document);
    if (video) return video;

    for (const frame of document.querySelectorAll("iframe")) {
      try {
        const frameVideo = findVideoIn(frame.contentDocument);
        if (frameVideo) return frameVideo;
      } catch {}
    }

    return null;
  }

  PresenceDiscord.registerPresence({
    id: "plex",
    type: "plex_presence",

    shouldRun() {
      return isPlexCandidate();
    },

    getVideo() {
      return getPlexVideo();
    },

    getEpisodeButtonSelector(dir) {
      return dir === "next"
        ? 'button[aria-label*="next" i], button[title*="next" i], [data-testid*="next" i]'
        : 'button[aria-label*="previous" i], button[title*="previous" i], [data-testid*="previous" i]';
    },

    buildPayload(video, ctx) {
      const plex = getPlexInfo(ctx);

      return {
        type: "plex_presence",
        ...plex,
        isPlaying: !video.paused && !video.ended,
        currentTime: Math.floor(video.currentTime || 0),
        duration: Math.floor(video.duration || 0),
        isLive: false,
        url: location.href,
        timestamp: Date.now()
      };
    }
  });
})();
