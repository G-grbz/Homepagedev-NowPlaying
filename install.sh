#!/usr/bin/env bash
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  ./install.sh [--up|--no-up] [--recreate]
                            [--domain nowplaying.example.com] [--port 8787]
                            [--mode update|append]
                            [--homepage-dir /path/to/.homepage/config]
                            [--skip-homepage] [--help]

Options:
  --up               Start Docker Compose after generating files (docker compose up -d --build)
  --no-up            Do not start Docker Compose (default)
  --recreate         When used with --up, force recreate containers (--force-recreate) and remove orphans

  --domain           Override HTTPS domain in JS (default: nowplaying.example.com)
  --port             Override PORT used for LAN endpoints + .env (default: 8787 or $PORT)

  --mode append      (default) Only append if block not present (do not overwrite)
  --mode update      Remove old NOWPLAYING BEGIN/END blocks and write fresh ones

  --homepage-dir     Provide Homepage config directory non-interactively (e.g. /home/gkhng/.homepage/config)
  --skip-homepage    Skip Homepage custom.js/custom.css modification

  --mpris            Enable MPRIS integration (default)
  --no-mpris         Disable MPRIS integration (sets ENABLE_MPRIS=0)

  --help             Show this help
EOF
}

get_lan_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
  fi
  if [[ -z "${ip}" ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  [[ -n "${ip}" ]] || die "Could not detect LAN IP address."
  echo "${ip}"
}

gen_hex() {
  local nbytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "${nbytes}"
  else
    command -v python3 >/dev/null 2>&1 || die "Missing required command: python3"
    python3 - <<PY
import secrets
print(secrets.token_hex(${nbytes}))
PY
  fi
}

inplace_sed() {
  local expr="$1" file="$2"
  if sed --version >/dev/null 2>&1; then
    sed -i -E "${expr}" "${file}"
  else
    sed -i '' -E "${expr}" "${file}"
  fi
}

compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi
  die "Docker Compose not found (need 'docker compose' or 'docker-compose')."
}

ensure_file_exists() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    mkdir -p "$(dirname "$f")"
    : > "$f"
  fi
}

backup_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  cp -f "$f" "${f}.bak.$(date +%Y%m%d-%H%M%S)"
}

# EXACT line-match block remover (no regex headaches).
# Deletes inclusive range between lines equal to BEGIN and END.
remove_block_by_markers() {
  local dest="$1" begin="$2" end="$3"
  [[ -f "$dest" ]] || return 0

  grep -Fq "$begin" "$dest" || return 0

  backup_file "$dest"

  local tmp
  tmp="$(mktemp)"
  awk -v b="$begin" -v e="$end" '
    $0==b {inblock=1; next}
    $0==e {inblock=0; next}
    !inblock {print}
  ' "$dest" > "$tmp"

  mv "$tmp" "$dest"
}

has_block() {
  local dest="$1" begin="$2" end="$3"
  [[ -f "$dest" ]] || return 1
  grep -Fq "$begin" "$dest" && grep -Fq "$end" "$dest"
}

append_block_js() {
  local src="$1" dest="$2" begin="$3" end="$4"
  [[ -f "$src" ]] || die "Source file not found: $src"
  ensure_file_exists "$dest"
  {
    echo ""
    echo "$begin"
    echo "// Added by install.sh at $(date -Is)"
    echo "// Source: $(basename "$src")"
    echo "// ------------------------------------------------------------"
    cat "$src"
    echo ""
    echo "$end"
    echo ""
  } >> "$dest"
}

append_block_css() {
  local src="$1" dest="$2" begin="$3" end="$4"
  [[ -f "$src" ]] || die "Source file not found: $src"
  ensure_file_exists "$dest"
  {
    echo ""
    echo "$begin"
    echo "/* Added by install.sh at $(date -Is) */"
    echo "/* Source: $(basename "$src") */"
    echo "/* ------------------------------------------------------------ */"
    cat "$src"
    echo ""
    echo "$end"
    echo ""
  } >> "$dest"
}

prompt_homepage_dir() {
  local dir=""
  echo ""
  echo "Homepage config dir needed to update custom.js/custom.css."
  echo "Example: /home/gkhng/.homepage/config"
  read -r -p "Enter Homepage config directory path (leave empty to SKIP): " dir || true
  [[ -n "$dir" ]] || return 1
  [[ -d "$dir" ]] || die "Given path is not a directory: $dir"
  echo "$dir"
}

# ----------------------------
# Parse args
# ----------------------------
DO_UP=0
RECREATE=0
DOMAIN_OVERRIDE=""
PORT_OVERRIDE=""
MPRIS_MODE="auto"
MODE="append"
HOMEPAGE_DIR=""
SKIP_HOMEPAGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --up) DO_UP=1; shift ;;
    --no-up) DO_UP=0; shift ;;
    --recreate) RECREATE=1; shift ;;

    --domain) [[ $# -ge 2 ]] || die "--domain requires a value"; DOMAIN_OVERRIDE="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die "--port requires a value"; PORT_OVERRIDE="$2"; shift 2 ;;
    --mode) [[ $# -ge 2 ]] || die "--mode requires a value (update|append)"; MODE="$2"; shift 2 ;;
    --homepage-dir) [[ $# -ge 2 ]] || die "--homepage-dir requires a path"; HOMEPAGE_DIR="$2"; shift 2 ;;
    --mpris) MPRIS_MODE="on"; shift ;;
    --no-mpris) MPRIS_MODE="off"; shift ;;
    --skip-homepage) SKIP_HOMEPAGE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown argument: $1 (use --help)" ;;
  esac
done

[[ "$MODE" == "update" || "$MODE" == "append" ]] || die "Invalid --mode: $MODE (use update|append)"

# ----------------------------
# Paths (project root = cwd)
# ----------------------------
PROJECT_ROOT="$(pwd)"
ENV_OUT="${PROJECT_ROOT}/.env"
JS_FILE="${PROJECT_ROOT}/homepagedev-custom.js"
CSS_FILE="${PROJECT_ROOT}/homepagedev-custom.css"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
TM_FILE="${PROJECT_ROOT}/tampermonkey.script.txt"

[[ -f "${COMPOSE_FILE}" ]] || die "docker-compose.yml not found in project root."
[[ -f "${JS_FILE}" ]] || die "homepagedev-custom.js not found in project root."
[[ -f "${CSS_FILE}" ]] || die "homepagedev-custom.css not found in project root."

# ----------------------------
# Values
# ----------------------------
LAN_IP="$(get_lan_ip)"
UID_VAL="$(id -u)"
GID_VAL="$(id -g)"

PORT_VAL="${PORT_OVERRIDE:-${PORT:-8787}}"
DOMAIN_VAL="${DOMAIN_OVERRIDE:-${NOWPLAYING_DOMAIN:-nowplaying.example.com}}"

WRITE_KEY_VAL="$(gen_hex 32)"
SEED_TOKEN_VAL="$(gen_hex 16)"

NOWPLAYING_APP_DIR_VAL="${NOWPLAYING_APP_DIR:-${PROJECT_ROOT}}"
APP_WORKDIR_VAL="${APP_WORKDIR:-/app}"

XDG_RUNTIME_DIR_VAL="${XDG_RUNTIME_DIR:-/run/user/${UID_VAL}}"
CACHE_DIR_VAL="${CACHE_DIR:-${HOME}/.cache}"
if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  DBUS_SESSION_BUS_ADDRESS_VAL="${DBUS_SESSION_BUS_ADDRESS}"
else
  DBUS_SESSION_BUS_ADDRESS_VAL="unix:path=${XDG_RUNTIME_DIR_VAL}/bus"
fi

# ENABLE_MPRIS selection
case "${MPRIS_MODE}" in
  on)
    ENABLE_MPRIS_VAL=1
    ;;
  off)
    ENABLE_MPRIS_VAL=0
    ;;
  *)
    ENABLE_MPRIS_VAL="${ENABLE_MPRIS:-1}"
    ;;
esac

# ----------------------------
# Patch homepagedev-custom.js
# ----------------------------
echo "Patching JS: ${JS_FILE}"

inplace_sed "s#https://[^\"']+/nowplaying#https://${DOMAIN_VAL}/nowplaying#g" "${JS_FILE}"
inplace_sed "s#https://[^\"']+/command#https://${DOMAIN_VAL}/command#g" "${JS_FILE}"
inplace_sed "s#http://[^\"']+/nowplaying#http://${LAN_IP}:${PORT_VAL}/nowplaying#g" "${JS_FILE}"
inplace_sed "s#http://[^\"']+/command#http://${LAN_IP}:${PORT_VAL}/command#g" "${JS_FILE}"
inplace_sed "s#(\"X-Seed-Token\"[[:space:]]*:[[:space:]]*\")[^\"]*(\")#\\1${SEED_TOKEN_VAL}\\2#g" "${JS_FILE}"
inplace_sed "s#\\{\\{NP_WRITE_KEY_BOOTSTRAP\\}\\}#${WRITE_KEY_VAL}#g" "${JS_FILE}"
inplace_sed 's#(localStorage[[:space:]]*\.[[:space:]]*setItem[[:space:]]*\([[:space:]]*["'"'"']np_write_key["'"'"'][[:space:]]*,[[:space:]]*["'"'"'])[A-Fa-f0-9]{16,}(["'"'"'][[:space:]]*\)[[:space:]]*;?)#\1'"${WRITE_KEY_VAL}"'\2#g' "${JS_FILE}"

# ----------------------------
# Patch tampermonkey.script.txt (optional)
# ----------------------------
if [[ -f "${TM_FILE}" ]]; then
  echo "Patching Tampermonkey: ${TM_FILE}"

  # Decide BASE:
  # - If domain is something real (not the example default), prefer https://domain
  # - Else fallback to LAN http://ip:port
  TM_BASE="http://${LAN_IP}:${PORT_VAL}"
  if [[ -n "${DOMAIN_VAL}" && "${DOMAIN_VAL}" != "nowplaying.example.com" ]]; then
    TM_BASE="https://${DOMAIN_VAL}"
  fi

  inplace_sed "s#^([[:space:]]*const[[:space:]]+BASE[[:space:]]*=[[:space:]]*\")[^\"]*(\"[[:space:]]*;[[:space:]]*)#\\1${TM_BASE}\\2#g" "${TM_FILE}"
  inplace_sed "s#^([[:space:]]*const[[:space:]]+WRITE_KEY[[:space:]]*=[[:space:]]*\")[^\"]*(\"[[:space:]]*;[[:space:]]*)#\\1${WRITE_KEY_VAL}\\2#g" "${TM_FILE}"
  inplace_sed "s#NOWPLAYING_IP_OR_DOMAIN:8787#${LAN_IP}:${PORT_VAL}#g" "${TM_FILE}"
  inplace_sed "s#YOUR_NOWPLAYING_WRITE_KEY#${WRITE_KEY_VAL}#g" "${TM_FILE}"

else
  echo "NOTE: ${TM_FILE} not found, skipping Tampermonkey patch."
fi

# ----------------------------
# Write .env
# ----------------------------
echo "Writing .env: ${ENV_OUT}"

cat > "${ENV_OUT}" <<EOF
# ------------------------------------------------------------
# NowPlaying - Docker Compose environment (generated)
# ------------------------------------------------------------

UID=${UID_VAL}
GID=${GID_VAL}

NOWPLAYING_APP_DIR=${NOWPLAYING_APP_DIR_VAL}
APP_WORKDIR=${APP_WORKDIR_VAL}

XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR_VAL}
CACHE_DIR=${CACHE_DIR_VAL}

PORT=${PORT_VAL}
START_COMMAND=npm install && node server.js

WRITE_KEY=${WRITE_KEY_VAL}
SEED_TOKEN=${SEED_TOKEN_VAL}

NOWPLAYING_DOMAIN=${DOMAIN_VAL}

EOF

# MPRIS env lines (conditional)
{
  echo "ENABLE_MPRIS=${ENABLE_MPRIS_VAL}"
  if [[ "${ENABLE_MPRIS_VAL}" -eq 1 ]]; then
    echo "DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS_VAL}"
  fi
} >> "${ENV_OUT}"
# ----------------------------
# Homepage append/update
# ----------------------------
if [[ "$SKIP_HOMEPAGE" -eq 0 ]]; then
  if [[ -z "$HOMEPAGE_DIR" ]]; then
    if HOMEPAGE_DIR="$(prompt_homepage_dir)"; then :; else
      echo "Skipping Homepage modification (no directory provided)."
      HOMEPAGE_DIR=""
    fi
  else
    [[ -d "$HOMEPAGE_DIR" ]] || die "--homepage-dir is not a directory: $HOMEPAGE_DIR"
  fi

  if [[ -n "$HOMEPAGE_DIR" ]]; then
    HP_CUSTOM_JS="${HOMEPAGE_DIR%/}/custom.js"
    HP_CUSTOM_CSS="${HOMEPAGE_DIR%/}/custom.css"

    echo ""
    echo "Homepage mode: ${MODE}"
    echo "Target JS : ${HP_CUSTOM_JS}"
    echo "Target CSS: ${HP_CUSTOM_CSS}"
    echo ""

    JS_BEGIN="// === NOWPLAYING BEGIN JS ==="
    JS_END="// === NOWPLAYING END JS ==="
    CSS_BEGIN="/* === NOWPLAYING BEGIN CSS === */"
    CSS_END="/* === NOWPLAYING END CSS === */"

    if [[ "$MODE" == "update" ]]; then
      remove_block_by_markers "$HP_CUSTOM_JS" "$JS_BEGIN" "$JS_END"
      remove_block_by_markers "$HP_CUSTOM_CSS" "$CSS_BEGIN" "$CSS_END"

      backup_file "$HP_CUSTOM_JS"
      append_block_js "$JS_FILE" "$HP_CUSTOM_JS" "$JS_BEGIN" "$JS_END"
      echo "Updated JS block -> ${HP_CUSTOM_JS}"

      backup_file "$HP_CUSTOM_CSS"
      append_block_css "$CSS_FILE" "$HP_CUSTOM_CSS" "$CSS_BEGIN" "$CSS_END"
      echo "Updated CSS block -> ${HP_CUSTOM_CSS}"
    else
      if has_block "$HP_CUSTOM_JS" "$JS_BEGIN" "$JS_END"; then
        echo "JS block already present -> ${HP_CUSTOM_JS} (append mode: skipping)"
      else
        backup_file "$HP_CUSTOM_JS"
        append_block_js "$JS_FILE" "$HP_CUSTOM_JS" "$JS_BEGIN" "$JS_END"
        echo "Appended JS block -> ${HP_CUSTOM_JS}"
      fi

      if has_block "$HP_CUSTOM_CSS" "$CSS_BEGIN" "$CSS_END"; then
        echo "CSS block already present -> ${HP_CUSTOM_CSS} (append mode: skipping)"
      else
        backup_file "$HP_CUSTOM_CSS"
        append_block_css "$CSS_FILE" "$HP_CUSTOM_CSS" "$CSS_BEGIN" "$CSS_END"
        echo "Appended CSS block -> ${HP_CUSTOM_CSS}"
      fi
    fi
  fi
else
  echo "Skipping Homepage modification (--skip-homepage)."
fi

# ----------------------------
# Optionally start Docker Compose
# ----------------------------
if [[ "${DO_UP}" -eq 1 ]]; then
  COMPOSE="$(compose_cmd)"
  echo ""
  echo "Starting containers with: ${COMPOSE}"

  if [[ "${RECREATE}" -eq 1 ]]; then
    ${COMPOSE} -f "${COMPOSE_FILE}" up -d --build --force-recreate --remove-orphans
  else
    ${COMPOSE} -f "${COMPOSE_FILE}" up -d --build --remove-orphans
  fi
else
  echo ""
  echo "Skipping Docker Compose start (use --up to start)."
fi

echo ""
echo "DONE."
echo "LAN_IP: ${LAN_IP}"
echo "PORT: ${PORT_VAL}"
echo "DOMAIN: ${DOMAIN_VAL}"
echo "WRITE_KEY: ${WRITE_KEY_VAL}"
echo "SEED_TOKEN: ${SEED_TOKEN_VAL}"
echo "Env file: ${ENV_OUT}"
echo ""
echo "Tip: If Homepage uses env vars, set HOMEPAGE_VAR_NOWPLAYING_WRITE_KEY=${WRITE_KEY_VAL} in Homepage."
