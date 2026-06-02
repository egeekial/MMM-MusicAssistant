/* MMM-MusicAssistant - node_helper.js
 *
 * Owns the WebSocket connection to the Music Assistant server, resolves which
 * player to display (pinned + auto-fallback), and pushes a normalized
 * "NOW_PLAYING" payload to the frontend whenever state changes.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const MaSocket = require("./MaSocket.js");
const MaState = require("./MaState.js");

// Events we care about for now-playing updates.
const RELEVANT_EVENTS = new Set([
  "queue_updated",
  "queue_time_updated",
  "queue_items_updated",
  "player_updated",
  "player_added",
  "player_removed"
]);

const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 60000;

module.exports = NodeHelper.create({
  start() {
    this.config = null;
    this.socket = null;
    this.started = false;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.reconnectTimer = null;
    this.lastPayloadJson = null;
    Log.log(`Starting node_helper for: ${this.name}`);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "START") {
      // Only honor the first START (multiple instances would each START once).
      this.config = payload;
      if (!this.started) {
        this.started = true;
        this.connect();
      }
    }
  },

  log(msg, level = "log") {
    const fn = Log[level] || Log.log;
    fn(`[${this.name}] ${msg}`);
  },

  // ---------------------------------------------------------------- connection

  connect() {
    this.clearReconnect();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    const socket = new MaSocket({
      serverUrl: this.config.serverUrl,
      token: this.config.token,
      log: (m, lvl) => this.log(m, lvl)
    });
    this.socket = socket;

    socket.on("ready", () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.refresh();
    });
    socket.on("event", (evt) => {
      if (RELEVANT_EVENTS.has(evt.event)) this.refresh();
    });
    socket.on("close", () => this.scheduleReconnect());
    socket.on("error", () => {
      /* close handler will schedule the reconnect */
    });

    socket.connect().catch((err) => {
      this.log(`connect failed: ${err.message || err}`, "error");
      this.scheduleReconnect();
    });
  },

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.log(`reconnecting in ${Math.round(delay / 1000)}s`, "warn");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  },

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  },

  // ---------------------------------------------------------- state resolution

  async refresh() {
    if (!this.socket || !this.socket.connected) return;
    try {
      const [players, queues] = await Promise.all([
        this.socket.sendCommand("players/all"),
        this.socket.sendCommand("player_queues/all")
      ]);
      const queue = MaState.resolveQueue(players || [], queues || [], this.config.player);
      this.sendNowPlaying(
        MaState.buildPayload(queue, {
          showNextUp: this.config.showNextUp,
          maxNextUp: this.config.maxNextUp,
          imageSize: this.config.imageSize,
          serverInfo: this.socket.serverInfo,
          preferredBase: this.config.imageBaseUrl || this.config.serverUrl
        })
      );
    } catch (err) {
      this.log(`refresh failed: ${err.message || err}`, "error");
    }
  },

  sendNowPlaying(payload) {
    // Dedupe identical payloads to avoid needless re-renders. We intentionally
    // ignore elapsed fields when the track is unchanged: the frontend ticks the
    // progress bar locally, so only meaningful changes need to be pushed.
    const dedupeKey = JSON.stringify({
      state: payload.state,
      title: payload.title,
      artist: payload.artist,
      album: payload.album,
      imageUrl: payload.imageUrl,
      // include a coarse elapsed so seeks/track-restarts still propagate
      elapsed: Math.round(payload.elapsedTime || 0),
      next: payload.nextUp
    });
    if (dedupeKey === this.lastPayloadJson) return;
    this.lastPayloadJson = dedupeKey;
    this.sendSocketNotification("NOW_PLAYING", payload);
  },

  stop() {
    this.clearReconnect();
    if (this.socket) this.socket.close();
  }
});
