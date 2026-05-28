(function () {
  const TWITCH_SKIP = new Set([
    "directory", "following", "search", "subscriptions", "wallet", "friends",
    "downloads", "settings", "store", "esports", "turbo", "prime", "bits", "p", "jobs"
  ]);

  const TwitchSPA = (() => {
    let currentChannel = null;
    let onChangeCb = null;

    function getChannel() {
      return location.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || null;
    }

    function notify() {
      const ch = getChannel();
      if (ch === currentChannel) return;
      currentChannel = ch;
      onChangeCb?.({ channel: ch });
    }

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () { const r = origPush.apply(this, arguments); setTimeout(notify, 100); return r; };
    history.replaceState = function () { const r = origReplace.apply(this, arguments); setTimeout(notify, 100); return r; };
    window.addEventListener("popstate", () => setTimeout(notify, 100));

    return {
      onChange(cb) { onChangeCb = cb; },
      init() { currentChannel = getChannel(); },
    };
  })();

  function normalizeTwitchAvatar(url) {
    return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, "-300x300$1");
  }

  function getTwitchAvatar() {
    const streamer = location.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    if (!streamer) return null;

    for (const img of document.querySelectorAll("img.tw-image-avatar, img[class*='avatar']")) {
      if (img.alt?.toLowerCase() === streamer && img.src?.includes("jtvnw.net")) {
        return normalizeTwitchAvatar(img.src);
      }
    }

    for (const img of document.querySelectorAll("img")) {
      if (img.src?.includes("static-cdn.jtvnw.net/jtv_user_pictures/")
          && img.alt?.toLowerCase() === streamer) {
        return normalizeTwitchAvatar(img.src);
      }
    }

    return null;
  }

  function getTwitchInfo() {
    const streamer = location.pathname.split("/").filter(Boolean)[0] || "Twitch";
    const streamTitle =
      document.querySelector('[data-a-target="stream-title"]')?.getAttribute("title")?.trim()
      || document.querySelector('[data-a-target="stream-title"]')?.textContent?.trim()
      || null;
    const category =
      document.querySelector('[data-a-target="stream-game-link"]')?.textContent?.trim()
      || document.querySelector('a[href*="/directory/game/"]')?.textContent?.trim()
      || null;
    return { streamer, streamTitle, category, avatar: getTwitchAvatar() };
  }

  PresenceDiscord.registerPresence({
    id: "twitch",
    type: "twitch_presence",
    keepPresenceWithoutVideo: true,
    clearOnEnded: false,

    setup(ctx) {
      TwitchSPA.init();
      TwitchSPA.onChange(({ channel }) => {
        ctx.resetSiteState();
        if (!channel || TWITCH_SKIP.has(channel)) {
          ctx.clearPresence();
          return;
        }
        ctx.tickSoon(300, 800);
      });
    },

    shouldRun() {
      const firstSeg = location.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
      return !!firstSeg && !TWITCH_SKIP.has(firstSeg);
    },

    buildPayload(video, ctx) {
      const tw = getTwitchInfo();
      const title = tw.streamer;
      ctx.cachePoster(title, null);
      if (!ctx.cachedPoster) ctx.setCachedPoster(tw.avatar);

      const segments = location.pathname.split("/").filter(Boolean);
      const isLive = segments.length === 1
        || (segments.length > 1 && !["videos", "v", "clip", "clips"].includes(segments[1]?.toLowerCase()));

      return {
        type: "twitch_presence",
        title,
        videoTitle: title,
        streamTitle: tw.streamTitle || null,
        channel: tw.category,
        contentType: "video",
        poster: ctx.cachedPoster,
        isPlaying: !video.paused && !video.ended,
        currentTime: Math.floor(video.currentTime || 0),
        duration: isLive ? 0 : Math.floor(video.duration || 0),
        isLive,
        url: location.href,
        timestamp: Date.now()
      };
    }
  });
})();
