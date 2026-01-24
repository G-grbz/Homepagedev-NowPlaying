import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import crypto from "crypto";

const app = express();
app.set("trust proxy", true);

/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 8787;
const WRITE_KEY = process.env.WRITE_KEY || "change-me";
const SEED_TOKEN = process.env.SEED_TOKEN || "";
const STALE_MS = Number(process.env.STALE_MS || 15000);
const TM_TTL_MS = Number(process.env.TM_TTL_MS || 12000);
const COVER_PROXY_ALLOW = String(process.env.COVER_PROXY_ALLOW || "i.scdn.co,i.ytimg.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOW_ALL_COVER_PROXY = process.env.ALLOW_ALL_COVER_PROXY === "1";

/* =========================
   MPRIS CONFIG
========================= */
const ENABLE_MPRIS = process.env.ENABLE_MPRIS !== "0";
const MPRIS_TICK_MS = Number(process.env.MPRIS_TICK_MS || 1000);
const MPRIS_PREFER = String(process.env.MPRIS_PREFER || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/* =========================
   CORS
========================= */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Widget-Key, X-Seed-Token");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "256kb" }));

/* =========================
   STATE (MULTI-SOURCE)
========================= */
function blankState(source) {
  return {
    source,
    title: null,
    artist: null,
    album: null,
    year: null,
    url: null,
    cover: null,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    ts: 0,
    _trackId: null,
    _playerName: null,
    _posBaseMs: 0,
    _posBaseTs: 0,
  };
}

const states = {
  spotify: blankState("spotify"),
  ytmusic: blankState("ytmusic"),
  youtube: blankState("youtube"),
  mpris: blankState("mpris"),
  other: blankState("other"),
};

function normSource(s) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return "other";
  if (v === "spotify") return "spotify";
  if (v === "ytmusic" || v === "youtube_music" || v === "youtubemusic") return "ytmusic";
  if (v === "youtube" || v === "yt") return "youtube";
  if (v === "mpris") return "mpris";
  return "other";
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function sanitizeIncoming(b, prev) {
  const playing = !!b.playing;

  const positionMs = isFiniteNumber(b.positionMs)
    ? Math.max(0, Math.floor(b.positionMs))
    : (prev.positionMs || 0);

  const durationMs = isFiniteNumber(b.durationMs)
    ? Math.max(0, Math.floor(b.durationMs))
    : (prev.durationMs || 0);

  const pos2 = durationMs > 0 ? clamp(positionMs, 0, durationMs) : positionMs;

  return {
    ...prev,
    source: prev.source,
    title: cleanStr(b.title) ?? prev.title,
    artist: cleanStr(b.artist) ?? prev.artist,
    album: cleanStr(b.album) ?? prev.album,
    year: (Number.isFinite(Number(b.year)) ? Number(b.year) : prev.year),
    url: cleanStr(b.url) ?? prev.url,
    cover: cleanStr(b.cover) ?? prev.cover,
    playing,
    positionMs: pos2,
    durationMs,
    ts: Date.now(),
  };
}

const TM_SOURCES = new Set(
  String(process.env.TM_SOURCES || "ytmusic,youtube")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function isFresh(ts, ttlMs) {
  return !!ts && (Date.now() - ts) <= ttlMs;
}

function isTamperFresh(now = Date.now()) {
  for (const k of TM_SOURCES) {
    const s = states[k];
    if (s && s.ts && (now - s.ts) <= TM_TTL_MS) return true;
  }
  return false;
}

function pickActive(now = Date.now()) {
  const suppressMpris = isTamperFresh(now);

  const list = Object.values(states)
    .filter((s) => !(suppressMpris && s.source === "mpris"))
    .map((s) => {
    const age = s.ts ? (now - s.ts) : Infinity;
    const stale = age > STALE_MS;
    return { ...s, age, stale };
    });

  const fresh = list.filter((s) => !s.stale);
  const playingFresh = fresh.filter((s) => s.playing);
  if (playingFresh.length) {
    playingFresh.sort((a, b) => b.ts - a.ts);
    return { active: playingFresh[0], stale: false, reason: "playing" };
  }

  if (fresh.length) {
    fresh.sort((a, b) => b.ts - a.ts);
    return { active: fresh[0], stale: false, reason: "paused" };
  }

  return { active: null, stale: true, reason: "none" };
}

/* =========================
   COMMAND CHANNEL
========================= */

let cmd = { id: 0, action: null, value: null, ts: 0 };

function auth(req, res) {
  const key = req.get("X-Widget-Key") || "";
  if (key !== WRITE_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

/* =========================
   HELPERS (cover rewrite for client)
========================= */

function getExternalBase(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0].trim();
  return `${proto}://${host}`;
}

function coverForClient(coverRaw, req) {
  const c = cleanStr(coverRaw);
  if (!c) return null;
  if (c.startsWith("file://") || c.startsWith("http://")) {
    const base = getExternalBase(req);
    return `${base}/cover?u=${encodeURIComponent(c)}`;
  }
  return c;
}

function humanizeMprisName(name) {
  const n = String(name || "").toLowerCase();

  if (n.includes("vlc")) return { key: "vlc", label: "VLC" };
  if (n.includes("spotify")) return { key: "spotify", label: "Spotify" };
  if (n.includes("chrom")) return { key: "chrome", label: "Chrome" };
  if (n.includes("brave")) return { key: "brave", label: "Brave" };
  if (n.includes("vivaldi")) return { key: "vivaldi", label: "Vivaldi" };
  if (n.includes("edge")) return { key: "edge", label: "Edge" };
  if (n.includes("firefox")) return { key: "firefox", label: "Firefox" };
  if (n.includes("mpv")) return { key: "mpv", label: "mpv" };
  if (n.includes("kodi")) return { key: "kodi", label: "Kodi" };
  if (n.includes("jellyfin")) return { key: "jellyfin", label: "Jellyfin" };

  const last = n.split(".").filter(Boolean).pop() || "mpris";
  return { key: last, label: last.toUpperCase() };
}

function clientSourceInfo(s) {
  if (!s) return { key: "none", label: "" };

  if (s.source && s.source !== "mpris") {
    const src = String(s.source);
    const map = {
      spotify: { key: "spotify", label: "Spotify" },
      ytmusic: { key: "ytmusic", label: "YouTube Music" },
      youtube: { key: "youtube", label: "YouTube" },
      other: { key: "other", label: "Other" },
    };
    return map[src] || { key: src, label: src };
  }

  return humanizeMprisName(s._playerName);
}

function mapStateForClient(s, req) {
  if (!s) return s;
  const src = clientSourceInfo(s);
  return {
    ...s,
    cover: coverForClient(s.cover, req),
    clientSourceKey: src.key,
    clientSourceLabel: src.label,
  };
}

/* =========================
   MPRIS BRIDGE (inside server.js)
========================= */

let mpris = {
  ok: false,
  bus: null,
  ifaces: new Map(),
  players: new Map(),
};

function asNumber(x) {
  if (x == null) return 0;
  if (typeof x === "number") return x;
  if (typeof x === "bigint") return Number(x);
  try { return Number(x.valueOf()); } catch {}
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function variantVal(v) {
  return v && typeof v === "object" && "value" in v ? v.value : v;
}

function preferRank(name) {
  const n = String(name || "").toLowerCase();
  if (!MPRIS_PREFER.length) return 999;
  const idx = MPRIS_PREFER.findIndex((p) => p && n.includes(p));
  return idx === -1 ? 999 : idx;
}

function hintTerms(hint) {
  const h = String(hint || "").trim().toLowerCase();
  if (!h) return [];
  if (h === "spotify") return ["spotify"];
  if (h === "youtube" || h === "ytmusic") {
    return ["firefox", "chrome", "chromium", "brave", "vivaldi", "edge"];
  }
  return [h];
}

function matchesHint(name, hint) {
  const terms = hintTerms(hint);
  if (!terms.length) return false;
  const n = String(name || "").toLowerCase();
  return terms.some((t) => t && n.includes(t));
}

function chooseMprisPlayer(hint = null) {
  const arr = [...mpris.players.values()];
  if (!arr.length) return null;

  const now = Date.now();
  const freshish = arr.filter((p) => p.ts && (now - p.ts) <= (STALE_MS * 3));
  const base = freshish.length ? freshish : arr;

  const playing = base.filter((p) => p.playing);
  const cand = playing.length ? playing : base;

  cand.sort((a, b) => {
    const ha = matchesHint(a.name, hint) ? 0 : 1;
    const hb = matchesHint(b.name, hint) ? 0 : 1;
    if (ha !== hb) return ha - hb;

    const ra = preferRank(a.name);
    const rb = preferRank(b.name);
    if (ra !== rb) return ra - rb;

    return (b.ts || 0) - (a.ts || 0);
  });

  return cand[0] || null;
}

function syncMprisToState() {
  const chosen = chooseMprisPlayer();
  if (!chosen) return;

  const now = Date.now();
  let pos = chosen.positionMs || 0;

  if (chosen.playing && chosen._posBaseTs) {
    pos = (chosen._posBaseMs || 0) + (now - chosen._posBaseTs);
  }

  if (chosen.durationMs > 0) pos = clamp(pos, 0, chosen.durationMs);
  else pos = Math.max(0, pos);

  states.mpris.title = cleanStr(chosen.title);
  states.mpris.artist = cleanStr(chosen.artist);
  states.mpris.album = cleanStr(chosen.album);
  states.mpris.year  = Number.isFinite(Number(chosen.year)) ? Number(chosen.year) : null;
  states.mpris.url = cleanStr(chosen.url);
  states.mpris.cover = cleanStr(chosen.cover);
  states.mpris.playing = !!chosen.playing;
  states.mpris.positionMs = Math.floor(pos);
  states.mpris.durationMs = Math.max(0, Math.floor(chosen.durationMs || 0));
  states.mpris.ts = now;
  states.mpris._trackId = chosen.trackId || null;
  states.mpris._playerName = chosen.name || null;
  states.mpris._posBaseMs = states.mpris.positionMs;
  states.mpris._posBaseTs = now;
}

function yearFromAny(x) {
  const v = cleanStr(variantVal(x));
  if (!v) return null;
  const m = v.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function parseMetadata(md) {
  const title = cleanStr(variantVal(md["xesam:title"]));
  const album = cleanStr(variantVal(md["xesam:album"]));

  const year =
    yearFromAny(md["xesam:date"]) ||
    yearFromAny(md["xesam:contentCreated"]) ||
    yearFromAny(md["xesam:comment"]) ||
    null;

  let artist = null;
  const artists = variantVal(md["xesam:artist"]);
  if (Array.isArray(artists)) {
    const a = artists.map(cleanStr).filter(Boolean);
    artist = a.length ? a.join(", ") : null;
  } else {
    artist = cleanStr(artists);
  }

  const url =
    cleanStr(variantVal(md["xesam:url"])) ||
    cleanStr(variantVal(md["xesam:comment"])) ||
    null;

  const cover = cleanStr(variantVal(md["mpris:artUrl"])) || null;

  const lengthUs = asNumber(variantVal(md["mpris:length"]));
  const durationMs = lengthUs > 0 ? Math.floor(lengthUs / 1000) : 0;

  const trackId = variantVal(md["mpris:trackid"]) || null;

  return { title, artist, album, year, url, cover, durationMs, trackId };
}


async function getMprisIfaces(name) {
  if (mpris.ifaces.has(name)) return mpris.ifaces.get(name);

  const obj = await mpris.bus.getProxyObject(name, "/org/mpris/MediaPlayer2");
  const props = obj.getInterface("org.freedesktop.DBus.Properties");
  const player = obj.getInterface("org.mpris.MediaPlayer2.Player");
  const root = obj.getInterface("org.mpris.MediaPlayer2");

  const pack = { obj, props, player, root };
  mpris.ifaces.set(name, pack);
  return pack;
}

async function refreshMprisPlayer(name) {
  const { props } = await getMprisIfaces(name);
  const all = await props.GetAll("org.mpris.MediaPlayer2.Player");

  try {
    const md = variantVal(all.Metadata) || {};
    console.log("MPRIS:", name, "PlaybackStatus=", variantVal(all.PlaybackStatus));
    console.log("Metadata keys:", Object.keys(md));
    console.log("album=", variantVal(md["xesam:album"]));
    console.log("contentCreated=", variantVal(md["xesam:contentCreated"]));
    console.log("date=", variantVal(md["xesam:date"]));
    console.log("comment=", variantVal(md["xesam:comment"]));
  } catch {}
  const playback = cleanStr(variantVal(all.PlaybackStatus)) || "";
  const playing = playback.toLowerCase() === "playing";

  const md = variantVal(all.Metadata) || {};
  const meta = parseMetadata(md);

  const posUs = asNumber(variantVal(all.Position));
  const positionMs = posUs > 0 ? Math.floor(posUs / 1000) : 0;

  const snap = {
    name,
    playing,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    year: meta.year,
    url: meta.url,
    cover: meta.cover,
    durationMs: meta.durationMs,
    positionMs,
    trackId: meta.trackId,
    ts: Date.now(),

    _posBaseMs: positionMs,
    _posBaseTs: Date.now(),
  };

  mpris.players.set(name, snap);
}

async function attachMprisPlayer(name) {
  try {
    const { props, player } = await getMprisIfaces(name);
    if (props._hpBound) return;
    props._hpBound = true;

    props.on("PropertiesChanged", (iface) => {
      if (iface !== "org.mpris.MediaPlayer2.Player") return;
      refreshMprisPlayer(name).catch(() => {});
    });

    player.on("Seeked", (posUs) => {
      const snap = mpris.players.get(name);
      if (!snap) return;
      const ms = Math.max(0, Math.floor(asNumber(posUs) / 1000));
      snap.positionMs = ms;
      snap._posBaseMs = ms;
      snap._posBaseTs = Date.now();
      snap.ts = Date.now();
      mpris.players.set(name, snap);
    });

    await refreshMprisPlayer(name);
  } catch {
  }
}

async function scanMprisPlayers() {
  try {
    const obj = await mpris.bus.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus");
    const dbusIf = obj.getInterface("org.freedesktop.DBus");
    const names = await dbusIf.ListNames();

    const mprisNames = (names || []).filter((n) => String(n).startsWith("org.mpris.MediaPlayer2."));
    for (const n of mprisNames) await attachMprisPlayer(n);
    const set = new Set(mprisNames);
    for (const k of [...mpris.players.keys()]) {
      if (!set.has(k)) {
        mpris.players.delete(k);
        mpris.ifaces.delete(k);
      }
    }
  } catch {
  }
}

async function execMprisCommand(action, value) {
  if (!mpris.ok) return false;

  const hint = (action === "raise") ? cleanStr(value) : null;
  const chosen = chooseMprisPlayer(hint);
  if (!chosen) return false;

  try {
    const { player, root, props } = await getMprisIfaces(chosen.name);

    if (action === "raise") {
      try {
        const canRaise = variantVal(await props.Get("org.mpris.MediaPlayer2", "CanRaise"));
        if (canRaise === false) return false;
      } catch {}
      await root.Raise();
      return true;
    }

    if (action === "toggle") { await player.PlayPause(); return true; }
    if (action === "next")   { await player.Next(); return true; }
    if (action === "prev")   { await player.Previous(); return true; }

    if (action === "seek") {
      const targetMs = Math.max(0, Math.floor(Number(value) || 0));
      const trackId = chosen.trackId || states.mpris._trackId;

      if (trackId) {
        const posUs = targetMs * 1000;
        await player.SetPosition(String(trackId), posUs);
        chosen.positionMs = targetMs;
        chosen._posBaseMs = targetMs;
        chosen._posBaseTs = Date.now();
        chosen.ts = Date.now();
        mpris.players.set(chosen.name, chosen);
        return true;
      }

      const curMs = Math.max(0, Math.floor(states.mpris.positionMs || 0));
      const deltaUs = (targetMs - curMs) * 1000;
      await player.Seek(deltaUs);

      chosen.positionMs = targetMs;
      chosen._posBaseMs = targetMs;
      chosen._posBaseTs = Date.now();
      chosen.ts = Date.now();
      mpris.players.set(chosen.name, chosen);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function startMpris() {
  if (!ENABLE_MPRIS) return;

  let dbusMod = null;
  try {
    dbusMod = await import("dbus-next");
  } catch (e) {
    console.warn("⚠️ MPRIS disabled: install dbus-next (npm i dbus-next)");
    return;
  }

  try {
    const bus = dbusMod.sessionBus();
    mpris.bus = bus;
    mpris.ok = true;

    await scanMprisPlayers();

    try {
      const obj = await bus.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus");
      const dbusIf = obj.getInterface("org.freedesktop.DBus");
      dbusIf.on("NameOwnerChanged", (name, oldOwner, newOwner) => {
        const n = String(name || "");
        if (!n.startsWith("org.mpris.MediaPlayer2.")) return;

        if (newOwner) attachMprisPlayer(n).catch(() => {});
        if (!newOwner) {
          mpris.players.delete(n);
          mpris.ifaces.delete(n);
        }
      });
    } catch {}

    setInterval(() => scanMprisPlayers(), 5000);
    setInterval(() => {
      if (!mpris.ok) return;
      syncMprisToState();
    }, MPRIS_TICK_MS);

    console.log("🎛️ MPRIS bridge enabled");
  } catch (e) {
    console.warn("⚠️ MPRIS init failed:", e?.message || e);
  }
}

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => res.type("text").send("nowplaying ok (multi-source + mpris)"));
app.get("/widget-key", (req, res) => {
  if (SEED_TOKEN) {
    const t = String(req.get("X-Seed-Token") || "");
    if (t !== SEED_TOKEN) return res.status(401).type("text").send("unauthorized");
  }
  res.type("text").send(WRITE_KEY);
});

app.get("/nowplaying", (req, res) => {
  const now = Date.now();
  const picked = pickActive(now);
  const suppressMpris = isTamperFresh(now);

  const mappedStates = Object.fromEntries(
    Object.entries(states).map(([k, v]) => [
      k,
      (suppressMpris && k === "mpris") ? null : mapStateForClient(v, req)
    ])
  );

  res.json({
    active: mapStateForClient(picked.active, req),
    stale: picked.stale,
    reason: picked.reason,
    ts: Date.now(),
    states: mappedStates,
  });
});

app.post("/nowplaying", (req, res) => {
  if (!auth(req, res)) return;

  const b = req.body || {};
  const sKey = normSource(b.source);

  const prev = states[sKey] || blankState(sKey);
  states[sKey] = sanitizeIncoming(b, prev);

  res.json({ ok: true, source: sKey, ts: states[sKey].ts });
});

app.post("/command", async (req, res) => {
  if (!auth(req, res)) return;

  const b = req.body || {};
  const action = String(b.action || "").trim();
  const value = b.value ?? null;

  if (!action) return res.status(400).json({ error: "missing action" });

  cmd = { id: cmd.id + 1, action, value, ts: Date.now() };

  const executed = isTamperFresh(Date.now()) ? false : await execMprisCommand(action, value);

  res.json({ ok: true, cmd, executed });
});

app.get("/command", (req, res) => {
  const since = Number(req.query.since || 0);
  if (cmd.id <= since) return res.status(204).end();
  res.json(cmd);
});


app.get("/cover", async (req, res) => {
  let u0 = req.query.u || req.query.url || "";
  if (Array.isArray(u0)) u0 = u0[0];
  let u = String(u0).trim();
  try {
    u = decodeURIComponent(u);
  } catch {}
  if (!u) return res.status(400).send("missing u");

  try {
    if (u.startsWith("file://")) {
      const p = fileURLToPath(u);
      const buf = await fs.readFile(p);

      const lower = p.toLowerCase();
      const ct =
        lower.endsWith(".png") ? "image/png" :
        (lower.endsWith(".webp") ? "image/webp" :
        (lower.endsWith(".gif") ? "image/gif" :
        "image/jpeg"));

      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(buf);
    }

    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return res.status(400).send("bad protocol");
    }

    if (!ALLOW_ALL_COVER_PROXY) {
      const hostOk = COVER_PROXY_ALLOW.includes(url.hostname);
      if (!hostOk) return res.status(403).send("host not allowed");
    }

    const r = await fetch(u, { redirect: "follow" });
    if (!r.ok) return res.status(502).send("fetch failed");

    const ct = r.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const ab = await r.arrayBuffer();
    return res.send(Buffer.from(ab));
  } catch (e) {
    console.warn("cover error:", {
      u,
      code: e?.code,
      message: e?.message,
    });
    return res.status(500).send("cover error");
  }
});

/* =========================
   START
========================= */

startMpris().catch(() => {});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎵 nowplaying (multi-source + mpris) listening on :${PORT}`);
});
