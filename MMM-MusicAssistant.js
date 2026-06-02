/* global Module, Log */

/* MMM-MusicAssistant.js
 *
 * Frontend: renders the now-playing card and ticks the progress bar locally
 * (smoothly, once a second) so it stays in sync without spamming the network.
 */

Module.register("MMM-MusicAssistant", {
  defaults: {
    serverUrl: "http://localhost:8095",
    token: "",
    player: "", // player_id or display name; auto-falls back to any playing player

    layout: "background", // "background" (blurred art) | "beside" (art left, text right)
    showAlbum: true,
    showProgressBar: true,
    showNextUp: true,
    maxNextUp: 3,

    imageSize: 512,
    imageBaseUrl: "", // override base used for album-art URLs (defaults to serverUrl)
    hideWhenIdle: true,
    updateProgressInterval: 1000,
    animationSpeed: 500
  },

  getStyles() {
    return ["MMM-MusicAssistant.css"];
  },

  getTranslations() {
    return { en: "translations/en.json" };
  },

  start() {
    this.nowPlaying = null;
    this.ticker = null;
    Log.info(`Starting module: ${this.name}`);
    this.sendSocketNotification("START", this.config);
    this.startTicker();
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "NOW_PLAYING") {
      const wasIdle = !this.nowPlaying || this.nowPlaying.state === "idle";
      const isIdle = !payload || payload.state === "idle";
      this.nowPlaying = payload;
      // Full re-render on meaningful change (track/state/idle transition).
      this.updateDom(wasIdle && isIdle ? 0 : this.config.animationSpeed);
    }
  },

  // -------------------------------------------------------------- progress tick

  startTicker() {
    this.stopTicker();
    this.ticker = setInterval(
      () => this.tickProgress(),
      this.config.updateProgressInterval
    );
  },

  stopTicker() {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  },

  /** Returns the corrected, real-time elapsed seconds (clamped to duration). */
  currentElapsed() {
    const np = this.nowPlaying;
    if (!np) return 0;
    let elapsed = np.elapsedTime || 0;
    if (np.state === "playing" && np.elapsedAt) {
      elapsed += (Date.now() - np.elapsedAt) / 1000;
    }
    if (np.duration) elapsed = Math.min(elapsed, np.duration);
    return Math.max(0, elapsed);
  },

  /** Update only the progress bar + time labels, without a full re-render. */
  tickProgress() {
    const np = this.nowPlaying;
    if (!np || np.state === "idle") return;

    const elapsed = this.currentElapsed();
    const duration = np.duration || 0;
    const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

    const fill = document.getElementById(`mma-fill-${this.identifier}`);
    if (fill) fill.style.width = `${pct}%`;

    const elapsedEl = document.getElementById(`mma-elapsed-${this.identifier}`);
    if (elapsedEl) elapsedEl.textContent = this.formatTime(elapsed);

    const remainEl = document.getElementById(`mma-remain-${this.identifier}`);
    if (remainEl && duration > 0) {
      remainEl.textContent = `-${this.formatTime(duration - elapsed)}`;
    }
  },

  // ----------------------------------------------------------------------- DOM

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = `mma mma-${this.config.layout}`;

    const np = this.nowPlaying;
    if (!np || np.state === "idle") {
      if (this.config.hideWhenIdle) {
        wrapper.classList.add("mma-hidden");
        return wrapper;
      }
      wrapper.appendChild(this.buildIdle());
      return wrapper;
    }

    if (this.config.layout === "background" && np.imageUrl) {
      const bg = document.createElement("div");
      bg.className = "mma-bg";
      bg.style.backgroundImage = `url("${np.imageUrl}")`;
      wrapper.appendChild(bg);
    }

    wrapper.appendChild(this.buildCard(np));

    if (this.config.showNextUp && np.nextUp && np.nextUp.length) {
      wrapper.appendChild(this.buildNextUp(np.nextUp));
    }

    return wrapper;
  },

  buildIdle() {
    const idle = document.createElement("div");
    idle.className = "mma-idle dimmed light small";
    idle.textContent = this.translate("NOTHING_PLAYING");
    return idle;
  },

  buildCard(np) {
    const card = document.createElement("div");
    card.className = "mma-card";

    if (np.imageUrl) {
      const art = document.createElement("img");
      art.className = "mma-art";
      art.src = np.imageUrl;
      art.alt = "";
      art.onerror = () => {
        art.style.display = "none";
      };
      card.appendChild(art);
    }

    const info = document.createElement("div");
    info.className = "mma-info";

    const title = document.createElement("div");
    title.className = "mma-title bright";
    title.textContent = np.title || "";
    info.appendChild(title);

    if (np.artist) {
      const artist = document.createElement("div");
      artist.className = "mma-artist";
      artist.textContent = np.artist;
      info.appendChild(artist);
    }

    if (this.config.showAlbum && np.album && !np.isRadio) {
      const album = document.createElement("div");
      album.className = "mma-album dimmed";
      album.textContent = np.album;
      info.appendChild(album);
    }

    if (this.config.showProgressBar && !np.isRadio && np.duration > 0) {
      info.appendChild(this.buildProgress(np));
    }

    card.appendChild(info);
    return card;
  },

  buildProgress(np) {
    const elapsed = this.currentElapsed();
    const duration = np.duration || 0;
    const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

    const container = document.createElement("div");
    container.className = "mma-progress";

    const bar = document.createElement("div");
    bar.className = "mma-bar";
    const fill = document.createElement("div");
    fill.className = "mma-bar-fill";
    fill.id = `mma-fill-${this.identifier}`;
    fill.style.width = `${pct}%`;
    const knob = document.createElement("div");
    knob.className = "mma-bar-knob";
    fill.appendChild(knob);
    bar.appendChild(fill);

    const times = document.createElement("div");
    times.className = "mma-times dimmed xsmall";

    const elapsedEl = document.createElement("span");
    elapsedEl.id = `mma-elapsed-${this.identifier}`;
    elapsedEl.textContent = this.formatTime(elapsed);

    const remainEl = document.createElement("span");
    remainEl.id = `mma-remain-${this.identifier}`;
    remainEl.textContent = `-${this.formatTime(duration - elapsed)}`;

    times.appendChild(elapsedEl);
    times.appendChild(remainEl);

    container.appendChild(bar);
    container.appendChild(times);
    return container;
  },

  buildNextUp(items) {
    const wrap = document.createElement("div");
    wrap.className = "mma-nextup";

    const heading = document.createElement("div");
    heading.className = "mma-nextup-heading dimmed xsmall";
    heading.textContent = this.translate("NEXT_UP");
    wrap.appendChild(heading);

    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "mma-nextup-row";

      if (it.imageUrl) {
        const img = document.createElement("img");
        img.className = "mma-nextup-art";
        img.src = it.imageUrl;
        img.alt = "";
        img.onerror = () => {
          img.style.visibility = "hidden";
        };
        row.appendChild(img);
      }

      const text = document.createElement("div");
      text.className = "mma-nextup-text";
      const t = document.createElement("div");
      t.className = "mma-nextup-title small";
      t.textContent = it.title || "";
      text.appendChild(t);
      if (it.artist) {
        const a = document.createElement("div");
        a.className = "mma-nextup-artist xsmall dimmed";
        a.textContent = it.artist;
        text.appendChild(a);
      }
      row.appendChild(text);
      wrap.appendChild(row);
    });

    return wrap;
  },

  // -------------------------------------------------------------------- helpers

  formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
  },

  suspend() {
    this.stopTicker();
  },

  resume() {
    this.startTicker();
  }
});
