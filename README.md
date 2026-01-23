# Homepagedev-NowPlaying (Multi‑Source Now Playing Widget + Optional Linux MPRIS)

<img width="1919" height="310" alt="nwp" src="https://github.com/user-attachments/assets/d445f621-64bd-4720-8e76-0aa94b71429a" />

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

For browser sources, you’ll typically use the **Tampermonkey userscript** to:

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

```bash
git clone https://github.com/G-grbz/Homepagedev-NowPlaying
cd Homepagedev-NowPlaying
```

### 2) Generate a `WRITE_KEY` (manual)

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

* `http://your-nowplaying-host:8787/` → `nowplaying ok (multi-source + mpris)`
* `http://your-nowplaying-host:8787/nowplaying` → JSON payload

---

# Automated installation (install.sh)

This repo also ships with a **fully automated installer script** that sets everything up for you in one go.

If you don’t want to manually:

* generate keys
* edit `.env`
* patch `homepagedev-custom.js`
* patch `tampermonkey.script.txt`
* copy JS/CSS into Homepage

…then **this script is for you**.

The goal of `install.sh` is simple:

> **One command → working Now Playing widget** 🚀

---

## What the installer does

When you run `install.sh`, it will:

1. **Detect your LAN IP** automatically
2. **Generate secure secrets**

   * `WRITE_KEY`
   * `SEED_TOKEN`
3. **Create a fresh `.env` file** for Docker Compose
4. **Patch project files**

   * `homepagedev-custom.js`
   * `tampermonkey.script.txt` (if present)
5. **Optionally modify Homepage**

   * Append or update the Now Playing JS/CSS blocks
   * Automatically back up existing files
6. **Optionally start Docker Compose**

Everything is reversible:

* Homepage files are backed up
* Blocks are wrapped in `NOWPLAYING BEGIN / END` markers

---

## Requirements

Make sure these are installed before running the script:

* **bash**
* **Docker**
* **Docker Compose** (`docker compose` or `docker-compose`)
* One of:

  * `openssl` **or**
  * `python3`

On Linux, MPRIS is supported by default (can be disabled).

---

## Basic usage

From the project root:

```bash
chmod +x install.sh
./install.sh
```

This runs in **safe default mode**:

* Homepage is patched interactively
* Docker is **not** started
* Existing Homepage blocks are **not overwritten**

---

## Common examples

### 1) Quick local install (LAN only)

```bash
./install.sh --up
```

What happens:

* LAN IP is auto-detected
* `.env` is generated
* Homepage JS/CSS is appended
* Containers are built and started

---

### 2) HTTPS / reverse-proxy setup

If you use a domain like `nowplaying.example.com`:

```bash
./install.sh \
  --domain nowplaying.example.com \
  --up
```

Effects:

* JS endpoints use `https://nowplaying.example.com`
* Tampermonkey uses HTTPS
* `.env` includes `NOWPLAYING_DOMAIN`

---

### 3) Update existing Homepage blocks

If you already ran the installer before and want to refresh everything:

```bash
./install.sh --mode update
```

This will:

* Remove old NOWPLAYING blocks
* Write clean, fresh JS/CSS
* Keep unrelated Homepage code untouched

---

### 4) Non-interactive Homepage path

Useful for servers / SSH installs:

```bash
./install.sh \
  --homepage-dir /home/username/.homepage/config \
  --up
```

No prompts — fully automated.

---

### 5) Skip Homepage modification entirely

If you only want the server + Tampermonkey:

```bash
./install.sh --skip-homepage --up
```

You can paste JS/CSS manually later.

---

### 6) Disable MPRIS (browser-only mode)

```bash
./install.sh --no-mpris
```

Result:

* `ENABLE_MPRIS=0`
* No D-Bus or session bus is used

Perfect for non-Linux systems or headless servers.

---

### 7) Force container recreation

```bash
./install.sh --up --recreate
```

Equivalent to:

```bash
docker compose up -d --build --force-recreate --remove-orphans
```

---

## Installer options (full list)

```text
--up               Start Docker Compose after setup
--no-up            Do not start Docker Compose (default)
--recreate         Force container recreation (with --up)

--domain <domain>  HTTPS domain for endpoints
--port <port>      Override server port (default: 8787)

--mode append      Append blocks if missing (default)
--mode update      Remove old blocks and write fresh ones

--homepage-dir     Homepage config directory path
--skip-homepage    Do not touch Homepage files

--mpris            Enable MPRIS (default)
--no-mpris         Disable MPRIS

--help             Show help
```

---

## Files generated / modified

### Generated

* `.env` (Docker environment)

### Modified (with backups)

* `homepagedev-custom.js`
* `tampermonkey.script.txt`
* `Homepage/custom.js`
* `Homepage/custom.css`

Backups look like:

```text
custom.js.bak.20260123-235959
```

---

## After installation

The script prints everything you need at the end:

```text
LAN_IP: 192.168.1.29
PORT: 8787
DOMAIN: nowplaying.example.com
WRITE_KEY: <generated>
SEED_TOKEN: <generated>
```

### Important final step (Homepage env)

If Homepage uses environment variables, **set this**:

```env
HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY=<WRITE_KEY>
```

Without it:

* Widget still renders
* Controls will not work

---

## When should you NOT use the installer?

* If you want full manual control
* If you are debugging custom JS logic
* If you intentionally don’t want automatic patching

Otherwise: use the installer — it’s fast, safe, and repeatable.

---

## HomePageDev setup (manual)

> If you used `install.sh` with Homepage enabled, you can skip most of this section.

### 1) Add the widget JS to HomePageDev `custom.js`

Take the contents of:

* `homepagedev-custom.js`

…and paste it into HomePageDev’s `custom.js`.

Then edit these lines in the script:

```js
const NOWPLAYING_URL =
  (location.protocol === "https:")
    ? "https://nowplaying.example.com/nowplaying"
    : "http://your-nowplaying-host:8787/nowplaying";

const COMMAND_URL =
  (location.protocol === "https:")
    ? "https://nowplaying.example.com/command"
    : "http://your-nowplaying-host:8787/command";
```

Replace with your real endpoints.

Examples:

* **LAN / HTTP**

  * `http://<server-ip>/nowplaying`
  * `http://<server-ip>/command`

* **Reverse proxy / HTTPS**

  * `https://nowplaying.example.com/nowplaying`
  * `https://nowplaying.example.com/command`

### Write key configuration

```js
const ENV_RAW = "{{HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY}}";
```

This placeholder is used to provide the **write key** required by the NowPlaying service.

#### Option 1: Using environment variables (recommended)

If you are using environment variables with Homepage.dev, add your generated write key:

```env
HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY=your-write-key-here
```

Homepage will inject this value into `custom.js` at runtime.

#### Option 2: Without environment variables

If you’re not using Homepage env vars, replace the placeholder manually:

```js
const ENV_RAW = "your-write-key-here";
```

---

## Automatic write key storage (localStorage)

To automatically store `HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY` in the browser’s **localStorage**, the `SEED_TOKEN` defined on the server **must match** the token sent from the client.

### How it works

On the client side, a seed token is sent via request headers:

```js
const headers = { "X-Seed-Token": "change-me" };
```

On the server side, define the same value in your `.env` file:

```env
SEED_TOKEN=change-me
```

If these two values are identical:

* The server accepts the initial handshake
* `HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY` is written into `localStorage`
* Subsequent requests can use this key automatically

If the values **do not match**, the request is rejected and **no data is written**.

---

## 2) Add the CSS to HomePageDev `custom.css`

Take the contents of:

* `homepagedev-custom.css`

…and paste it into HomePageDev’s `custom.css`.

---

## 3) Provide the WRITE_KEY to HomePageDev

The widget reads the key from:

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

This repository includes the Tampermonkey script as:

```text
tampermonkey.script.txt
```

You **do not need to copy it from the README**.

This script:

* reads Now Playing info from the active browser tab
* sends it to the NowPlaying server (`POST /nowplaying`)
* polls commands from the server (`GET /command`) and executes them inside the tab

### Install

1. Install the **Tampermonkey** browser extension.
2. Open the file `tampermonkey.script.txt`.
3. Copy its full contents.
4. In Tampermonkey, create a **new userscript** and paste the contents.
5. Save the script.

### Configure the script

Inside `tampermonkey.script.txt`, update:

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

Add/remove `@connect` entries so they match the hostname used in `BASE`.

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
