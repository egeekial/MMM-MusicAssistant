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
      const prev = this.nowPlaying;
      this.nowPlaying = payload;

      // The backend pushes a fresh payload roughly once a second to keep elapsed
      // time in sync. We avoid MagicMirror's animated updateDom wherever we can,
      // because it fades the whole module out-and-in (a visible flash) and reloads
      // the album art. Three tiers, cheapest first:
      //   1. Nothing meaningful changed -> just resync the local progress ticker.
      //   2. Only fields changed, same layout -> patch those nodes in place
      //      (no fade, and art is left alone unless its URL actually changed).
      //   3. The layout itself changed -> fall back to a full animated re-render.
      if (!this.isMeaningfulChange(prev, payload)) {
        this.tickProgress();
        return;
      }

      const canPatch =
        prev && prev.state !== "idle" &&
        payload && payload.state !== "idle" &&
        this.sameStructure(prev, payload);

      if (canPatch) {
        this.patchInPlace(prev, payload);
      } else {
        const wasIdle = !prev || prev.state === "idle";
        const isIdle = !payload || payload.state === "idle";
        this.updateDom(wasIdle && isIdle ? 0 : this.config.animationSpeed);
      }
    }
  },

  /** True when a field the card renders changed (ignores elapsed/timing). */
  isMeaningfulChange(prev, next) {
    if (!prev || !next) return true;
    return (
      prev.state !== next.state ||
      prev.title !== next.title ||
      prev.artist !== next.artist ||
      prev.album !== next.album ||
      prev.imageUrl !== next.imageUrl ||
      JSON.stringify(prev.nextUp) !== JSON.stringify(next.nextUp)
    );
  },

  /**
   * True when prev and next render the *same set of elements* (so we can patch
   * text/src in place instead of rebuilding). Returns false the moment the DOM
   * shape would differ, in which case the caller does a full updateDom.
   */
  sameStructure(prev, next) {
    if (!prev || !next) return false;
    if (!!prev.isRadio !== !!next.isRadio) return false;
    if (!!prev.artist !== !!next.artist) return false;
    if (!!prev.imageUrl !== !!next.imageUrl) return false;

    const albumShown = (x) => this.config.showAlbum && !!x.album && !x.isRadio;
    if (albumShown(prev) !== albumShown(next)) return false;

    const progShown = (x) =>
      this.config.showProgressBar && !x.isRadio && x.duration > 0;
    if (progShown(prev) !== progShown(next)) return false;

    const rows = (x) => (this.config.showNextUp && x.nextUp ? x.nextUp : []);
    const a = rows(prev);
    const b = rows(next);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!!a[i].artist !== !!b[i].artist) return false;
      if (!!a[i].imageUrl !== !!b[i].imageUrl) return false;
    }
    return true;
  },

  /**
   * Update only the nodes whose content changed, leaving the rest of the DOM
   * (and crucially the album art, unless its URL changed) untouched. Avoids the
   * whole-module fade/flash on track changes within the same album/queue.
   */
  patchInPlace(prev, next) {
    const id = this.identifier;
    const setText = (suffix, text) => {
      const el = document.getElementById(`mma-${suffix}-${id}`);
      if (el && el.textContent !== text) el.textContent = text;
    };

    setText("title", next.title || "");
    if (next.artist) setText("artist", next.artist);
    if (this.config.showAlbum && next.album && !next.isRadio) {
      setText("album", next.album);
    }

    if (next.imageUrl && next.imageUrl !== prev.imageUrl) {
      const art = document.getElementById(`mma-art-${id}`);
      if (art) {
        art.style.display = "";
        art.src = next.imageUrl;
      }
      const bg = document.getElementById(`mma-bg-${id}`);
      if (bg) bg.style.backgroundImage = `url("${next.imageUrl}")`;
    }

    if (this.config.showNextUp && next.nextUp) {
      next.nextUp.forEach((it, i) => {
        const prevIt = (prev.nextUp && prev.nextUp[i]) || {};
        const t = document.getElementById(`mma-nextup-title-${id}-${i}`);
        if (t && t.textContent !== (it.title || "")) t.textContent = it.title || "";
        if (it.artist) {
          const a = document.getElementById(`mma-nextup-artist-${id}-${i}`);
          if (a && a.textContent !== it.artist) a.textContent = it.artist;
        }
        if (it.imageUrl && it.imageUrl !== prevIt.imageUrl) {
          const img = document.getElementById(`mma-nextup-art-${id}-${i}`);
          if (img) {
            img.style.visibility = "";
            img.src = it.imageUrl;
          }
        }
      });
    }

    this.tickProgress();
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
    const ratio = duration > 0 ? Math.min(1, elapsed / duration) : 0;

    const bar = document.getElementById(`mma-bar-${this.identifier}`);
    if (bar) this.applyBarRatio(bar, ratio);

    const elapsedEl = document.getElementById(`mma-elapsed-${this.identifier}`);
    if (elapsedEl) elapsedEl.textContent = this.formatTime(elapsed);

    const remainEl = document.getElementById(`mma-remain-${this.identifier}`);
    if (remainEl && duration > 0) {
      remainEl.textContent = `-${this.formatTime(duration - elapsed)}`;
    }
  },

  /**
   * Drive the progress bar via a single CSS variable on the .mma-bar element.
   * The fill (transform: scaleX) and the knob (left: %) both inherit --mma-pct
   * (0..1). The fill animates on the compositor (no per-frame layout/paint), so
   * the once-a-second tick stays cheap.
   */
  applyBarRatio(bar, ratio) {
    bar.style.setProperty("--mma-pct", ratio);
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
      bg.id = `mma-bg-${this.identifier}`;
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
      art.id = `mma-art-${this.identifier}`;
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
    title.id = `mma-title-${this.identifier}`;
    title.textContent = np.title || "";
    info.appendChild(title);

    if (np.artist) {
      const artist = document.createElement("div");
      artist.className = "mma-artist";
      artist.id = `mma-artist-${this.identifier}`;
      artist.textContent = np.artist;
      info.appendChild(artist);
    }

    if (this.config.showAlbum && np.album && !np.isRadio) {
      const album = document.createElement("div");
      album.className = "mma-album dimmed";
      album.id = `mma-album-${this.identifier}`;
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
    const ratio = duration > 0 ? Math.min(1, elapsed / duration) : 0;

    const container = document.createElement("div");
    container.className = "mma-progress";

    const bar = document.createElement("div");
    bar.className = "mma-bar";
    bar.id = `mma-bar-${this.identifier}`;
    this.applyBarRatio(bar, ratio);
    const fill = document.createElement("div");
    fill.className = "mma-bar-fill";
    bar.appendChild(fill);
    // Knob is a sibling of the fill so the fill's scaleX never distorts it; both
    // read --mma-pct inherited from the bar.
    const knob = document.createElement("div");
    knob.className = "mma-bar-knob";
    bar.appendChild(knob);

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

    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "mma-nextup-row";

      if (it.imageUrl) {
        const img = document.createElement("img");
        img.className = "mma-nextup-art";
        img.id = `mma-nextup-art-${this.identifier}-${i}`;
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
      t.id = `mma-nextup-title-${this.identifier}-${i}`;
      t.textContent = it.title || "";
      text.appendChild(t);
      if (it.artist) {
        const a = document.createElement("div");
        a.className = "mma-nextup-artist xsmall dimmed";
        a.id = `mma-nextup-artist-${this.identifier}-${i}`;
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
