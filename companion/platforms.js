const PLATFORMS = [
  {
    id: "cinepulse",
    name: "Cinepulse",
    type: "cinepulse_presence",
    log: "cp",
    needsTmdbPoster: true,
    usesDefaultLargeImage: true,
  },
  {
    id: "nakastream",
    name: "Nakastream",
    type: "nakastream_presence",
    log: "nk",
    needsTmdbPoster: true,
  },
  {
    id: "primevideo",
    name: "Prime Video",
    type: "primevideo_presence",
    log: "pv",
    needsTmdbPoster: true,
  },
  {
    id: "plex",
    name: "Plex",
    type: "plex_presence",
    log: "pl",
    needsTmdbPoster: true,
  },
  {
    id: "twitch",
    name: "Twitch",
    type: "twitch_presence",
    log: "tw",
  },
  {
    id: "youtube",
    name: "YouTube",
    type: "youtube_presence",
    log: "yt",
  },
];

const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map(platform => [platform.type, platform.name]));
const PRESENCE_TYPES = new Set(PLATFORMS.map(platform => platform.type));
const NEEDS_TMDB_POSTER_TYPES = new Set(PLATFORMS.filter(platform => platform.needsTmdbPoster).map(platform => platform.type));
const DEFAULT_LARGE_IMAGE_TYPES = new Set(PLATFORMS.filter(platform => platform.usesDefaultLargeImage).map(platform => platform.type));

module.exports = {
  PLATFORMS,
  PLATFORM_LABEL,
  PRESENCE_TYPES,
  NEEDS_TMDB_POSTER_TYPES,
  DEFAULT_LARGE_IMAGE_TYPES,
};
