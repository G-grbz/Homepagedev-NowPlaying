/* =========================
   NOWPLAYING WIDGET (Multi-Source)
   - Top bar chip with cover, progress and controls
   - Polls /nowplaying and sends commands to /command
========================= */
(() => {
  "use strict";

  /* =========================
     ENDPOINTS & ENVIRONMENT
     - Uses HTTPS domain when available, otherwise local LAN endpoints
     - Reads write key from env / window / localStorage
  ========================= */
  const NOWPLAYING_URL =
    (location.protocol === "https:")
      ? "https://nowplaying.example.com/nowplaying"
      : "http://your-nowplaying-host:8787/nowplaying";

  const COMMAND_URL =
    (location.protocol === "https:")
      ? "https://nowplaying.example.com/command"
      : "http://your-nowplaying-host:8787/command";

  const ENV_RAW = "{{HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY}}";

  function getEnvKey() {
    const v = String(ENV_RAW || "").trim();
    if (!v) return "";
    if (/^\{\{.*\}\}$/.test(v)) return "";
    if (v.includes("HOMEPAGE_VAR_")) return "";
    return v;
  }

  function getWriteKey() {
    return (
      getEnvKey() ||
      window.__NP_WRITE_KEY__ ||
      localStorage.getItem("np_write_key") ||
      ""
    ).trim();
  }

  (function seedKeyFromEnv() {
    const k = getEnvKey();
    if (!k) return;
    localStorage.setItem("np_write_key", k);
  })();

  /* =========================
     OPTIONAL: ONE-TIME KEY SEED FROM SERVER
     - Runs only if localStorage is empty
     - Fetches /widget-key using a seed header
  ========================= */
  async function seedKeyFromServerOnce() {
    try {
      const cur = (localStorage.getItem("np_write_key") || "").trim();
      if (cur) return;

      const base = COMMAND_URL.replace(/\/command$/, "");
      const headers = { "X-Seed-Token": "super-secret-seed-token" };

      const r = await fetch(base + "/widget-key", {
        cache: "no-store",
        headers,
      });
      if (!r.ok) return;

      const k = (await r.text()).trim();
      if (!k) return;

      localStorage.setItem("np_write_key", k);
    } catch {}
  }
  seedKeyFromServerOnce();

  /* =========================
     BASIC CONSTANTS & HELPERS
  ========================= */
  const FALLBACK_HREF = "https://music.youtube.com";
  const REFRESH_MS = 1000;

  const $ = (sel, root = document) => root.querySelector(sel);

  function fmtMs(ms) {
    ms = Math.max(0, ms | 0);
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  }

  function safeStr(v) {
    return v == null ? "" : String(v).trim();
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normArtist(s) {
    s = safeStr(s);
    if (!s) return "";
    s = s.replace(/\s*,\s*/g, " & ");
    s = s.replace(/\s+(and)\s+/gi, " & ");
    s = s.replace(/\s*&\s*/g, " & ");
    return s.trim();
  }

  /* =========================
     LAYOUT: CHIP MOUNT LOCATION
  ========================= */
  function findTopWidgetsBar() {
    const searchInput =
      $(".information-widget-search input") || $("input[type='search']");
    if (searchInput) {
      const searchWidget =
        searchInput.closest(".information-widget-search") ||
        searchInput.closest(".widget") ||
        searchInput.parentElement;

      return (
        searchWidget?.closest(".widgets") ||
        searchWidget?.closest(".information-widgets") ||
        searchWidget?.parentElement ||
        document.body
      );
    }
    return $(".information-widgets") || $(".widgets") || document.body;
  }

  /* =========================
     COMMAND SENDER (Playback Control)
  ========================= */
  async function sendCommand(action, value = null) {
    const key = getWriteKey();
    if (!key) return { ok: false, executed: false };

    try {
      const r = await fetch(COMMAND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Widget-Key": key,
        },
        body: JSON.stringify({ action, value }),
        cache: "no-store",
      });

      if (!r.ok) return { ok: false, executed: false };
      return await r.json();
    } catch {
      return { ok: false, executed: false };
    }
  }

  /* =========================
     OPEN TARGET & CLICK MODES
  ========================= */
  const PLAYER_TARGET = "hp_nowplaying_player";
  const BAR_PRIMARY_MODE = "seek"; // "seek" or "open"

  /* =========================
     DEEP LINK HELPERS (Spotify)
  ========================= */
  function spotifyAppUrlFromHttp(u) {
    try {
      const url = new URL(u);
      const m = url.pathname.match(/^\/track\/([A-Za-z0-9]+)$/);
      if (m) return `spotify:track:${m[1]}`;
      return null;
    } catch {
      return null;
    }
  }

  function preferredOpenUrl(active) {
    const http = safeStr(active?.url) || FALLBACK_HREF;

    if (active?.source === "spotify") {
      const app = spotifyAppUrlFromHttp(http);
      return { app, http };
    }

    return { app: null, http };
  }

  function openNowPlaying(active) {
    const { app, http } = preferredOpenUrl(active);

    if (http && http.startsWith("file://")) {
      window.open(FALLBACK_HREF, PLAYER_TARGET);
      return;
    }

    if (app) {
      const w1 = window.open(app, PLAYER_TARGET);
      setTimeout(() => {
        try {
          window.open(http, PLAYER_TARGET)?.focus?.();
        } catch {}
      }, 250);
      try {
        w1?.focus?.();
      } catch {}
      return;
    }

    try {
      window.open(http, PLAYER_TARGET)?.focus?.();
    } catch {}
  }

  /* =========================
     INLINE SVG ICONS
  ========================= */
  const ICONS = {
    prev: `
      <svg viewBox="0 0 24 24">
        <path d="M6 19V5" />
        <path d="M18 19L9 12l9-7v14z" fill="currentColor"/>
      </svg>
    `,
    next: `
      <svg viewBox="0 0 24 24">
        <path d="M18 19V5" />
        <path d="M6 5l9 7-9 7V5z" fill="currentColor"/>
      </svg>
    `,
    play: `
      <svg viewBox="0 0 24 24">
        <path d="M8 5l11 7-11 7V5z" fill="currentColor"/>
      </svg>
    `,
    pause: `
      <svg viewBox="0 0 24 24">
        <rect x="7" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>
        <rect x="13" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>
      </svg>
    `,
  };

  /* =========================
     CHIP CREATION & EVENT WIRING
  ========================= */
  function ensureChip() {
    let el = $("#hp-nowplaying-chip");
    if (el) return el;

    const bar = findTopWidgetsBar();
    if (!bar) return null;

    el = document.createElement("a");
    el.id = "hp-nowplaying-chip";
    el.href = FALLBACK_HREF;
    el.target = PLAYER_TARGET;
    el.className = "hp-nowplaying-chip is-stale";

    el.addEventListener(
      "click",
      async (e) => {
        if (e.target.closest(".hp-np-controls")) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const payload = el._hpLastPayload;
        const active = payload?.active;

        if (e.shiftKey && active) {
          openNowPlaying(active);
          return;
        }

        const hint = active?.source || "";
        const r = await sendCommand("raise", hint);
        if (!r?.executed && active) openNowPlaying(active);
      },
      { capture: true }
    );

    if (!getWriteKey()) el.classList.add("is-no-key");

    const meta = document.createElement("div");
    meta.className = "hp-nowplaying-meta";

    const dot = document.createElement("span");
    dot.id = "hp-nowplaying-dot";
    dot.classList.add("hp-eq");
    dot.setAttribute("aria-hidden", "true");
    dot.innerHTML = `
      <span class="hp-eq-bar"></span>
      <span class="hp-eq-bar"></span>
      <span class="hp-eq-bar"></span>
    `;

    const cover = document.createElement("img");
    cover.id = "hp-nowplaying-cover";
    cover.loading = "lazy";
    cover.style.display = "none";

    const text = document.createElement("span");
    text.id = "hp-nowplaying-text";
    text.textContent = "Nothing is playing";

    meta.append(dot, cover, text);

    const controls = document.createElement("div");
    controls.className = "hp-np-controls";

    const mkBtn = (cls, icon, title, cmd) => {
      const b = document.createElement("button");
      b.className = `hp-np-btn ${cls}`;
      b.innerHTML = icon;
      b.title = title;
      b.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          sendCommand(cmd);
        },
        { capture: true }
      );
      return b;
    };

    const prev = mkBtn("hp-np-prev", ICONS.prev, "Previous", "prev");
    const toggle = mkBtn("hp-np-toggle", ICONS.play, "Play / Pause", "toggle");
    const next = mkBtn("hp-np-next", ICONS.next, "Next", "next");

    const btnWrap = document.createElement("div");
    btnWrap.className = "hp-np-buttons";
    btnWrap.append(prev, toggle, next);

    const barEl = document.createElement("div");
    barEl.className = "hp-np-bar";

    const fill = document.createElement("div");
    fill.className = "hp-np-fill";
    barEl.appendChild(fill);

    barEl.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();

        const active = el._hpLastPayload?.active;
        if (!active) return;

        if (BAR_PRIMARY_MODE === "open") {
          openNowPlaying(active);
          return;
        }

        const dur = Number(active.durationMs || 0);
        if (!dur) return;

        const r = barEl.getBoundingClientRect();
        const p = (e.clientX - r.left) / r.width;
        sendCommand("seek", Math.floor(dur * p));

        if (e.shiftKey) openNowPlaying(active);
      },
      { capture: true }
    );

    const time = document.createElement("span");
    time.id = "hp-nowplaying-time";
    time.textContent = "0:00 / 0:00";

    controls.append(btnWrap, barEl, time);
    el.append(meta, controls);
    bar.prepend(el);

    return el;
  }

  /* =========================
     STATE → UI RENDER
  ========================= */
  function setChipFromPayload(payload) {
    const el = ensureChip();
    if (!el) return;

    el._hpLastPayload = payload;

    const active = payload?.active;
    const stale = payload?.stale;

    const text = $("#hp-nowplaying-text");
    const cover = $("#hp-nowplaying-cover");
    const time = $("#hp-nowplaying-time");
    const fill = el.querySelector(".hp-np-fill");
    const toggle = el.querySelector(".hp-np-toggle");

    if (!active || stale) {
      text.textContent = "Nothing is playing";
      cover.style.display = "none";
      time.textContent = "0:00 / 0:00";
      fill.style.width = "0%";
      el.classList.add("is-stale");
      el.classList.remove("is-playing", "is-paused");
      return;
    }

    const title = safeStr(active.title);
    const artist = normArtist(active.artist);
    const album = safeStr(active.album);
    let year = Number(active.year || 0);
    if (!(year >= 1900 && year <= 2100)) year = 0;
    const playing = !!active.playing;

    el.classList.toggle("is-playing", playing);
    el.classList.toggle("is-paused", !playing);

    const top = title && artist
      ? `🎵 ${escHtml(title)} <span class="hp-np-sep">&amp;</span> ${escHtml(artist)}`
      : `🎵 ${escHtml(title) || "Unknown"}`;

    const sub = album
      ? `<span class="hp-np-sub">💿 ${escHtml(album)}${year ? ` <span class="hp-np-year">(${year})</span>` : ""}</span>`
      : "";

    text.innerHTML = `${top}${sub}`;
    el.title = [title, artist, album, (year || "")].filter(Boolean).join(" • ");

    if (active.cover) {
      cover.src = active.cover;
      cover.style.display = "block";
    } else {
      cover.style.display = "none";
    }

    toggle.innerHTML = playing ? ICONS.pause : ICONS.play;
    toggle.title = playing ? "Pause" : "Play";

    const pos = Number(active.positionMs || 0);
    const dur = Number(active.durationMs || 0);

    time.textContent = `${fmtMs(pos)} / ${fmtMs(dur)}`;
    fill.style.width = dur ? `${(pos / dur) * 100}%` : "0%";

    el.href = active.url || FALLBACK_HREF;
    el.classList.remove("is-stale");
  }

  /* =========================
     DATA FETCH & POLLING LOOP
  ========================= */
  async function fetchNowPlaying() {
    try {
      const r = await fetch(NOWPLAYING_URL, { cache: "no-store" });
      if (!r.ok) throw 0;
      return await r.json();
    } catch {
      return null;
    }
  }

  let lastSig = "";
  async function tick() {
    const payload = await fetchNowPlaying();
    const a = payload?.active;
    const sig = a
      ? `${a.source}|${a.title}|${a.artist}|${a.positionMs}|${a.playing}`
      : "none";

    if (sig !== lastSig) {
      lastSig = sig;
      setChipFromPayload(payload || {});
    }
  }

  /* =========================
     BOOTSTRAP
  ========================= */
  function init() {
    ensureChip();
    tick();
    setInterval(tick, REFRESH_MS);

    new MutationObserver(ensureChip).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init, { once: true })
    : init();
})();
