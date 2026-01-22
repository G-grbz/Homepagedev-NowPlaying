# Homepagedev-NowPlaying (Multi‑Source Now Playing Widget + Optional Linux MPRIS)

<img width="1919" height="314" alt="nwp" src="https://github.com/user-attachments/assets/9fcb338b-f852-4f5c-9a12-0ee2cbaa077d" />

This repo adds a slick **“Now Playing” chip** to **HomePageDev**: cover art, title/artist, progress, and quick controls (**prev / play‑pause / next / seek**).

It’s intentionally split into two layers:

1. **NowPlaying Server (Node/Express)** — a tiny API that stores the latest now‑playing state and exposes a command channel.
2. **HomePageDev Custom UI (JS + CSS)** — the chip UI that lives inside HomePageDev’s `custom.js` / `custom.css`.

Optional (Linux only): the server can also bridge **MPRIS** (desktop media control via D‑Bus).

---

## What you get

* ✅ Top‑bar Now Playing chip (cover + title/artist + progress)
* ✅ Controls: previous / play‑pause / next
* ✅ Seek by clicking the progress bar
* ✅ “Raise” behavior: try to focus/raise the active player window (when supported)
* ✅ Multi‑source state (Spotify / YouTube / YouTube Music / MPRIS)
* ✅ Cover proxy (`/cover`) to safely serve local `file://` album art and allow‑listed remote covers

---

## Supported sources

### Browser sources (any OS)

* YouTube (`www.youtube.com`)
* YouTube Music (`music.youtube.com`)
* Spotify Web (`open.spotify.com`)

For browser sources, you’ll typically use the **Tampermonkey userscript** (included below) to:

* read what’s currently playing in the tab
* send it to the server
* poll commands so the HomePageDev chip can control the tab

### MPRIS (Linux only)

MPRIS is a Linux desktop standard for media player control over **D‑Bus**.

* ✅ Reads now playing from desktop players
* ✅ Sends play/pause/next/prev/seek/raise

> **MPRIS only works on Linux.** Windows/macOS don’t expose Linux session D‑Bus + MPRIS in the same way.

---

## Quick start (Docker)

### 1) Clone

```
git clone https://github.com/G-grbz/Homepagedev-NowPlaying
cd Homepagedev-NowPlaying
```

### 2) Generate a `WRITE_KEY` (simple example)

You need a secret key to protect write/control endpoints (`POST /nowplaying` and `POST /command`).

**Easiest (Linux/macOS):**

```bash
# 32 bytes hex (64 chars)
openssl rand -hex 32
```

**Node one‑liner (works anywhere Node is installed):**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output — you’ll use it in:

* server `.env` (`WRITE_KEY=...`)
* HomePageDev env (`HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY=...`) and/or Tampermonkey script

### 3) Create `.env`

Create a `.env` file next to `docker-compose.yml`.

Minimum example:

```dotenv
# Server
PORT=8787
WRITE_KEY=PASTE_YOUR_RANDOM_KEY_HERE
SEED_TOKEN=change-me

# App paths
NOWPLAYING_APP_DIR=/home/username/nowplaying
APP_WORKDIR=/app

# Linux / MPRIS (optional)
ENABLE_MPRIS=1
XDG_RUNTIME_DIR=/run/user/1000
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
```

#### What you MUST change

* `WRITE_KEY` — set to the random key you generated.
* `NOWPLAYING_APP_DIR` — must point to the `nowplaying/` folder on your host.
* If using MPRIS on Linux:

  * `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` must match your **actual UID**.

### 4) Start

```bash
docker compose up -d
```

### 5) Sanity check

* `http://<server-ip>:8787/` → `nowplaying ok (multi-source + mpris)`
* `http://<server-ip>:8787/nowplaying` → JSON payload

---

## HomePageDev setup (this is the important part)

### 1) Add the widget JS to HomePageDev `custom.js`

Take the contents of:

* `homepagedev-custom.js`

…and **paste it into HomePageDev’s `custom.js`** (Settings/Config → Custom → **Custom JavaScript**, or however you manage HomePageDev’s custom files).

Then edit these lines in the script:

```js
const NOWPLAYING_URL =
  (location.protocol === "https:")
    ? "https://proxy.domain.adresiniz(varsa)/nowplaying"
    : "http://nowplaying-ip-adresiniz:8787/nowplaying";

const COMMAND_URL =
  (location.protocol === "https:")
    ? "https://proxy.domain.adresiniz(varsa)/command"
    : "http://nowplaying-ip-adresiniz:8787/command";
```

Replace with your real endpoints.

Examples:

* **LAN / HTTP**

  * `http://192.168.1.29:8787/nowplaying`
  * `http://192.168.1.29:8787/command`

* **Reverse proxy / HTTPS**

  * `https://nowplaying.example.com/nowplaying`
  * `https://nowplaying.example.com/command`

### 2) Add the CSS to HomePageDev `custom.css`

Take the contents of:

* `homepagedev-custom.css`

…and **paste it into HomePageDev’s `custom.css`** (Custom CSS).

The JS will create the HTML for the chip; the CSS makes it look and behave correctly.

### 3) Provide the WRITE_KEY to HomePageDev

The widget reads the key from an env‑style placeholder:

* `{{HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY}}`

So you should set this in your HomePageDev environment (Docker compose example):

```yaml
environment:
  - HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY=PASTE_YOUR_RANDOM_KEY_HERE
```

If the key is missing, the chip still renders, but controls won’t work.

---

## Browser-only mode (no MPRIS)

If you don’t want MPRIS:

* set `ENABLE_MPRIS=0`
* use the Tampermonkey userscript below

This is the cleanest cross‑platform setup: it works on any OS because the browser tab itself reads/controls playback.

---

## Tampermonkey userscript (Spotify + YouTube + YT Music)

This repository already includes the Tampermonkey script as a file:

```
tampermonkey.script.txt
```

You **do not need to copy it from the README**.

This script:

* reads Now Playing info from the active browser tab
* sends it to the NowPlaying server (`POST /nowplaying`)
* polls commands from the server (`GET /command`) and executes them inside the tab

### Install

1. Install the **Tampermonkey** browser extension.
2. Open the file:

```
tampermonkey.script.txt
```

3. Copy its full contents.
4. In Tampermonkey, create a **new userscript** and paste the contents.
5. Save the script.

### Configure the script

Inside `tampermonkey.script.txt`, update the following values:

```js
const BASE = "http://NOWPLAYING_IP_OR_DOMAIN:8787";
const WRITE_KEY = "YOUR_NOWPLAYING_WRITE_KEY";
```

Examples:

* **LAN only**

  * `BASE = "http://192.168.1.29:8787"`

* **HTTPS / reverse proxy**

  * `BASE = "https://nowplaying.example.com"`

### Update `@connect`

Tampermonkey blocks network requests unless the destination host is explicitly allowed.

In the userscript header, make sure these lines match your server:

```js
// @connect      nowplaying.example.com
// @connect      192.168.1.29
```

Add or remove `@connect` entries so they match the hostname used in `BASE`.

> ⚠️ **Important:** For playback control to work, the browser tab must remain open. The userscript is what actually clicks buttons and seeks inside the page.

---

## MPRIS setup (Linux only)

### Enable

In `.env`:

```dotenv
ENABLE_MPRIS=1
XDG_RUNTIME_DIR=/run/user/1000
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
```

In Docker, you must mount the session runtime directory (already in the provided compose example).

### Disable

```dotenv
ENABLE_MPRIS=0
```

### Prefer certain players

```dotenv
MPRIS_PREFER=spotify,firefox,chrome
```

---

## Reverse proxy (recommended for HTTPS)

If HomePageDev is served via HTTPS, your browser will block mixed content if the NowPlaying API is HTTP.

Minimal Nginx example:

```nginx
server {
  listen 443 ssl;
  server_name nowplaying.example.com;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
  }
}
```

---

## Security notes

* `WRITE_KEY` protects write/control endpoints. Treat it like a password.
* The cover proxy is restricted by default using `COVER_PROXY_ALLOW`.

If you really want to allow any remote host:

```dotenv
ALLOW_ALL_COVER_PROXY=1
```

…not recommended on a public server.

---

## Environment variables (server)

| Variable                   |                 Default | Notes                           |
| -------------------------- | ----------------------: | ------------------------------- |
| `PORT`                     |                  `8787` | Server listen port              |
| `WRITE_KEY`                |             `change-me` | Required secret key             |
| `SEED_TOKEN`               |                   empty | Optional, used by `/widget-key` |
| `STALE_MS`                 |                 `15000` | State staleness window          |
| `ENABLE_MPRIS`             |                     `1` | Linux only                      |
| `MPRIS_TICK_MS`            |                  `1000` | MPRIS sync tick                 |
| `MPRIS_PREFER`             |                   empty | Player preference substrings    |
| `COVER_PROXY_ALLOW`        | `i.scdn.co,i.ytimg.com` | Allow‑listed remote cover hosts |
| `ALLOW_ALL_COVER_PROXY`    |                     `0` | Allow all remote hosts (unsafe) |
| `DBUS_SESSION_BUS_ADDRESS` |                (varies) | Linux session D‑Bus             |

---

## API

### `GET /nowplaying`

Returns the active state plus all per‑source states.

### `POST /nowplaying`

Header:

* `X-Widget-Key: <WRITE_KEY>`

Body (example):

```json
{
  "source": "spotify",
  "title": "Track",
  "artist": "Artist",
  "url": "https://...",
  "cover": "https://...",
  "playing": true,
  "positionMs": 12000,
  "durationMs": 180000
}
```

### `POST /command`

Header:

* `X-Widget-Key: <WRITE_KEY>`

Body:

```json
{ "action": "toggle" }
```

Actions:

* `toggle`
* `next`
* `prev`
* `seek` (value = ms)
* `raise` (value = optional hint like `spotify` / `youtube`)

---

## Troubleshooting

### “Nothing is playing”

* Check `GET /nowplaying`
* If using browser mode:

  * confirm Tampermonkey is running on the site
  * confirm `BASE` and `@connect`

### Controls don’t work

* Confirm HomePageDev has `HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY`
* Confirm the server `WRITE_KEY` matches
* In browser mode, keep the player tab open

### MPRIS not working (Linux)

* Confirm `/run/user/<uid>/bus` exists on the host
* Confirm the container mounts `XDG_RUNTIME_DIR`
* Confirm `ENABLE_MPRIS=1`

---

## License

MIT
