/* MMM-MusicAssistant - MaSocket.js
 *
 * A small wrapper around the Music Assistant WebSocket API.
 *
 * Protocol (verified against the official music-assistant/client source):
 *   - Connect to ws://<host>:<port>/ws
 *   - The server immediately sends a ServerInfoMessage (schema_version, base_url, ...)
 *   - For schema_version >= 28 the FIRST command must be `auth` with a long-lived token
 *   - Commands:  { command, message_id, args }
 *   - Responses: { message_id, result }  (success) or { message_id, error_code, details }
 *   - Events are pushed to every client automatically (no subscribe command needed):
 *       { event, object_id, data }
 *
 * This class is transport-only: it connects, authenticates, exposes a promise-based
 * `sendCommand`, and emits "ready", "event", "close" and "error" via simple callbacks.
 * Reconnection/back-off is handled by the caller (node_helper).
 */

const WebSocket = require("ws");
const crypto = require("crypto");

const AUTH_SCHEMA_VERSION = 28;

class MaSocket {
  /**
   * @param {object} opts
   * @param {string} opts.serverUrl  Base HTTP(S) url, e.g. http://192.168.1.50:8095
   * @param {string} [opts.token]    Long-lived token (required for schema >= 28)
   * @param {function} [opts.log]    Logger function (msg, level)
   */
  constructor(opts) {
    this.serverUrl = (opts.serverUrl || "").replace(/\/+$/, "");
    this.token = opts.token || "";
    this.log = opts.log || (() => {});

    this.ws = null;
    this.serverInfo = null;
    this.connected = false;

    this._pending = new Map(); // message_id -> { resolve, reject, timer }
    this._handlers = { ready: null, event: null, close: null, error: null };
  }

  on(name, fn) {
    if (name in this._handlers) this._handlers[name] = fn;
    return this;
  }

  _emit(name, ...args) {
    const fn = this._handlers[name];
    if (typeof fn === "function") {
      try {
        fn(...args);
      } catch (err) {
        this.log(`handler "${name}" threw: ${err}`, "error");
      }
    }
  }

  /** Build the ws(s):// URL from the base HTTP url. */
  _wsUrl() {
    let url = this.serverUrl.replace(/^http/, "ws");
    if (!url.endsWith("/ws")) url += "/ws";
    return url;
  }

  /** Open the connection. Resolves once authenticated and ready, rejects on failure. */
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      const wsUrl = this._wsUrl();
      this.log(`connecting to ${wsUrl}`);

      let ws;
      try {
        ws = new WebSocket(wsUrl, { handshakeTimeout: 10000 });
      } catch (err) {
        return finish(err);
      }
      this.ws = ws;

      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch (err) {
          this.log(`could not parse message: ${err}`, "error");
          return;
        }
        this._onMessage(msg, finish);
      });

      ws.on("open", () => {
        this.log("websocket open");
      });

      ws.on("error", (err) => {
        this.log(`websocket error: ${err.message || err}`, "error");
        this._emit("error", err);
        finish(err);
      });

      ws.on("close", (code) => {
        this.log(`websocket closed (code ${code})`);
        this.connected = false;
        this._rejectAllPending(new Error("connection closed"));
        this._emit("close", code);
        finish(new Error(`connection closed (code ${code})`));
      });
    });
  }

  async _onMessage(msg, finish) {
    // First message after connect is the ServerInfo message.
    if (!this.serverInfo && msg.server_id !== undefined && msg.schema_version !== undefined) {
      this.serverInfo = msg;
      this.log(
        `connected to Music Assistant ${msg.server_version} ` +
          `(schema ${msg.schema_version})`
      );
      try {
        if (msg.schema_version >= AUTH_SCHEMA_VERSION) {
          if (!this.token) {
            throw new Error(
              `server schema ${msg.schema_version} requires a token; none configured`
            );
          }
          await this.sendCommand("auth", { token: this.token });
          this.log("authenticated");
        }
        this.connected = true;
        this._emit("ready", this.serverInfo);
        finish();
      } catch (err) {
        this._emit("error", err);
        finish(err);
      }
      return;
    }

    // Command result?
    if (msg.message_id !== undefined && this._pending.has(msg.message_id)) {
      const entry = this._pending.get(msg.message_id);
      this._pending.delete(msg.message_id);
      clearTimeout(entry.timer);
      if (msg.error_code) {
        entry.reject(new Error(msg.details || msg.error_code));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    // Otherwise it's an event broadcast: { event, object_id, data }
    if (msg.event !== undefined) {
      this._emit("event", msg);
    }
  }

  /** Send a command and await its result. */
  sendCommand(command, args = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("not connected"));
      }
      const messageId = crypto.randomUUID();
      const timer = setTimeout(() => {
        if (this._pending.has(messageId)) {
          this._pending.delete(messageId);
          reject(new Error(`command "${command}" timed out`));
        }
      }, timeoutMs);
      this._pending.set(messageId, { resolve, reject, timer });

      try {
        this.ws.send(JSON.stringify({ command, message_id: messageId, args }));
      } catch (err) {
        this._pending.delete(messageId);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  _rejectAllPending(err) {
    for (const [, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this._pending.clear();
  }

  close() {
    this._rejectAllPending(new Error("closing"));
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = MaSocket;
