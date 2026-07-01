/* MMM-MusicAssistant - MaState.js
 *
 * Pure, dependency-free logic for turning Music Assistant players/queues into a
 * normalized "now playing" payload. Shared by node_helper.js (runtime) and
 * scripts/test-connection.js (standalone test) so the same code path is exercised
 * in both. No MagicMirror or network dependencies here.
 */

// Fixed (small) size requested for the blurred background art. It is blurred
// heavily, so a tiny source looks identical while costing a fraction of the GPU
// texture / image-decode memory of the full-size foreground art.
const BG_IMAGE_SIZE = 128;

/**
 * Resolve which queue to display using pinned + auto-fallback rules.
 * @param {Array} players  result of `players/all`
 * @param {Array} queues   result of `player_queues/all`
 * @param {string} preferred  configured player id or display name (may be empty)
 */
function resolveQueue(players, queues, preferred) {
  const queueById = new Map(queues.map((q) => [q.queue_id, q]));
  const want = (preferred || "").trim().toLowerCase();

  const queueForPlayer = (player) => {
    if (!player) return null;
    const id = player.active_source || player.player_id;
    return queueById.get(id) || queueById.get(player.player_id) || null;
  };

  let pinnedPlayer = null;
  if (want) {
    pinnedPlayer =
      players.find((p) => (p.player_id || "").toLowerCase() === want) ||
      players.find((p) => (p.display_name || p.name || "").toLowerCase() === want) ||
      null;
  }

  // 1. pinned player actively playing
  const pinnedQueue = queueForPlayer(pinnedPlayer);
  if (pinnedQueue && pinnedQueue.state === "playing") return pinnedQueue;

  // 2. any queue that is playing
  const playing = queues.find((q) => q.state === "playing" && q.active !== false);
  if (playing) return playing;

  // 3. fall back to pinned player's queue (paused/idle), else nothing
  return pinnedQueue;
}

/** Extract title/artist/album from a queue item, handling radio stream titles. */
function extractMeta(item, media, isRadio) {
  let title = "";
  let artist = "";
  let album = "";

  if (media) {
    title = media.name || "";
    if (media.version) title = `${title} (${media.version})`;
    if (Array.isArray(media.artists) && media.artists.length) {
      artist = media.artists.map((a) => a.name).filter(Boolean).join(", ");
    }
    if (media.album && media.album.name) album = media.album.name;
  }

  const streamTitle = item && item.streamdetails ? item.streamdetails.stream_title : null;
  if ((isRadio || !title) && streamTitle) {
    if (streamTitle.includes(" - ")) {
      const [a, t] = streamTitle.split(" - ");
      if (!artist) artist = a.trim();
      title = t.trim();
    } else if (!title) {
      title = streamTitle;
    }
  }

  if (!title && item && item.name) title = item.name;
  return { title, artist, album };
}

/** Find the best MediaItemImage for a queue item / media item. */
function pickImage(item, media) {
  if (item && item.image) return item.image;
  if (media && media.image) return media.image;
  if (media && media.album && media.album.image) return media.album.image;
  return null;
}

/**
 * Resolve a MediaItemImage to a browser-loadable URL.
 * Mirrors the official client's get_image_url logic.
 * @param {object|null} image    MediaItemImage
 * @param {number} size          requested size in px
 * @param {object} serverInfo    { base_url, schema_version }
 * @param {string} preferredBase  base url to use for proxied images (the user's
 *                                configured serverUrl). Preferred over the
 *                                server-reported base_url, which may point at an
 *                                address the mirror's browser cannot reach.
 * @param {string} fit           how a remote image fills the box: "contain" (default,
 *                                whole image, transparent letterbox -- for the visible
 *                                art tile) or "cover" (fill and crop -- for the blurred
 *                                background, which needs an opaque color wash).
 */
function imageUrl(image, size, serverInfo, preferredBase, fit) {
  if (!image) return "";
  const info = serverInfo || {};
  const base = (preferredBase || info.base_url || "").replace(/\/+$/, "");
  const schema = info.schema_version || 0;

  if (image.remotely_accessible && !size) return image.path;

  if (schema >= 31 && image.proxy_id) {
    return `${base}/imageproxy/${image.proxy_id}?size=${size}`;
  }

  if (image.remotely_accessible) {
    // The visible art tile uses fit=contain so wide logos -- common for radio
    // stations, e.g. the NPR "npr" wordmark -- are shown whole instead of being
    // square-cropped to a single letter (no cbg, so the letterbox stays
    // transparent and blends into the card / black mirror). The blurred background
    // instead uses fit=cover&a=attention: it needs an opaque, filled color wash to
    // blur, not a mostly-transparent canvas. Square album art fills the box either
    // way, so this only changes non-square images.
    const fill =
      fit === "cover" ? "fit=cover&a=attention" : "fit=contain";
    return (
      `https://images.weserv.nl/?url=${encodeURIComponent(image.path)}` +
      `&w=${size}&h=${size}&${fill}`
    );
  }

  const encoded = encodeURIComponent(encodeURIComponent(image.path));
  return (
    `${base}/imageproxy?path=${encoded}` +
    `&provider=${encodeURIComponent(image.provider || "")}&size=${size}`
  );
}

/**
 * Build the normalized NOW_PLAYING payload from a resolved queue.
 * @param {object|null} queue
 * @param {object} opts  { showNextUp, maxNextUp, imageSize, serverInfo, fallbackBase }
 */
function buildPayload(queue, opts) {
  const o = opts || {};
  if (!queue || (queue.state !== "playing" && queue.state !== "paused")) {
    return { state: "idle" };
  }

  const item = queue.current_item || null;
  const media = item && item.media_item ? item.media_item : null;
  const isRadio =
    (media && media.media_type === "radio") ||
    (item && item.streamdetails && item.streamdetails.media_type === "radio");

  const { title, artist, album } = extractMeta(item, media, isRadio);
  const img = (it, md) =>
    imageUrl(pickImage(it, md), o.imageSize, o.serverInfo, o.preferredBase, "contain");
  // The blurred background is heavily blurred anyway, so it loads a small image
  // (a fraction of the GPU texture / decode memory of the full-size art). This is
  // the key guard against GPU-memory creep over repeated play/stop cycles. It uses
  // "cover" so it stays an opaque color wash worth blurring (see imageUrl).
  const bgImg = (it, md) =>
    imageUrl(pickImage(it, md), BG_IMAGE_SIZE, o.serverInfo, o.preferredBase, "cover");

  const nextUp = [];
  if (o.showNextUp && queue.next_item) {
    const it = queue.next_item;
    const md = it.media_item || null;
    const meta = extractMeta(it, md, false);
    nextUp.push({ title: meta.title, artist: meta.artist, imageUrl: img(it, md) });
  }

  return {
    state: queue.state,
    title,
    artist,
    album: isRadio ? "" : album,
    isRadio: !!isRadio,
    duration: item && item.duration ? item.duration : 0,
    elapsedTime: queue.elapsed_time || 0,
    elapsedAt: queue.elapsed_time_last_updated
      ? Math.round(queue.elapsed_time_last_updated * 1000)
      : Date.now(),
    imageUrl: img(item, media),
    bgImageUrl: bgImg(item, media),
    nextUp: nextUp.slice(0, o.maxNextUp || 3)
  };
}

module.exports = { resolveQueue, extractMeta, pickImage, imageUrl, buildPayload };
