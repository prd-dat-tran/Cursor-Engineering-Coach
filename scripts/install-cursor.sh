#!/usr/bin/env bash
# --------------------------------------------------------------------------------------------
#  Cursor Engineering Coach — one-shot build & install for Cursor IDE.
#
#  Builds the extension, packages a .vsix, installs it into Cursor with --force, and reloads
#  the window. Works two ways:
#
#    LOCAL  (run from inside a checkout) — builds your current working tree:
#      npm run deploy
#      bash scripts/install-cursor.sh
#
#    REMOTE (run from anywhere) — clones/pulls the repo, then builds & installs:
#      curl -fsSL https://raw.githubusercontent.com/prd-dat-tran/Cursor-Engineering-Coach/main/scripts/install-cursor.sh | bash
#      curl -fsSL https://raw.githubusercontent.com/prd-dat-tran/Cursor-Engineering-Coach/main/scripts/install-cursor.sh | bash -s -- update
#
#  Subcommands:
#    install    (default) Build + install. Uses the local checkout if present, else clones.
#    update     Pull the latest from GitHub into the cache clone, then build + install.
#    uninstall  Remove the extension from Cursor.
#
#  Options / env:
#    --ref <branch|tag>   Git ref to install (remote/update).   [env COACH_REF, default: main]
#    --repo <url>         Git URL to clone.    [env COACH_REPO_URL, default: project repo]
#    --src <dir>          Cache clone dir.     [env COACH_SRC_DIR, default: ~/.cursor-engineering-coach/src]
#    --no-reload          Skip the post-install window reload. [env COACH_NO_RELOAD=1]
#    -h, --help           Show this help.
# --------------------------------------------------------------------------------------------
set -euo pipefail

REPO_URL="${COACH_REPO_URL:-https://github.com/prd-dat-tran/Cursor-Engineering-Coach.git}"
REF="${COACH_REF:-main}"
CACHE_DIR="${COACH_SRC_DIR:-$HOME/.cursor-engineering-coach/src}"
NO_RELOAD="${COACH_NO_RELOAD:-0}"
EXT_ID="cursor-engineering-coach.cursor-engineering-coach"

CMD="install"
case "${1:-}" in
  install | update | uninstall) CMD="$1"; shift ;;
  -h | --help | help) CMD="help"; shift || true ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --src) CACHE_DIR="$2"; shift 2 ;;
    --no-reload) NO_RELOAD=1; shift ;;
    -h | --help) CMD="help"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

show_help() {
  # Print the header comment block (everything from line 2 until the first
  # non-comment line), stripping the leading "# ".
  awk 'NR>=2 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

# Return-by-global to keep command output out of captured values.
CURSOR_BIN=""
LOCAL_CHECKOUT=""
SRC_DIR=""
VSIX_PATH=""

# Resolve the `cursor` CLI (it is often not on PATH on macOS) into CURSOR_BIN.
resolve_cursor() {
  if command -v cursor &>/dev/null; then
    CURSOR_BIN="cursor"
  elif [[ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]]; then
    CURSOR_BIN="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
  elif [[ -x "$HOME/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]]; then
    CURSOR_BIN="$HOME/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
  else
    die "Could not find the 'cursor' CLI. In Cursor: Cmd+Shift+P → 'Shell Command: Install cursor command'."
  fi
}

# Set LOCAL_CHECKOUT when running from a file inside a Cursor Engineering Coach checkout.
detect_local_checkout() {
  local self="${BASH_SOURCE[0]:-}"
  [[ -n "$self" && -f "$self" ]] || return 1
  local repo
  repo="$(cd "$(dirname "$self")/.." && pwd)"
  if [[ -f "$repo/package.json" ]] && grep -q '"name": "cursor-engineering-coach"' "$repo/package.json"; then
    LOCAL_CHECKOUT="$repo"
    return 0
  fi
  return 1
}

# Clone the repo into the cache dir (or fast-forward an existing clone to origin/<ref>),
# then point SRC_DIR at it.
sync_cache_clone() {
  command -v git &>/dev/null || die "git is required for remote install/update but was not found."
  if [[ -d "$CACHE_DIR/.git" ]]; then
    log "Updating cached clone at $CACHE_DIR (ref: $REF)"
    git -C "$CACHE_DIR" fetch --depth 1 origin "$REF"
    git -C "$CACHE_DIR" checkout -q "$REF" 2>/dev/null || true
    git -C "$CACHE_DIR" reset --hard FETCH_HEAD
  else
    log "Cloning $REPO_URL (ref: $REF) → $CACHE_DIR"
    mkdir -p "$(dirname "$CACHE_DIR")"
    git clone --depth 1 --branch "$REF" "$REPO_URL" "$CACHE_DIR"
  fi
  SRC_DIR="$CACHE_DIR"
}

install_deps() {
  local src="$1" force="$2"
  command -v npm &>/dev/null || die "npm is required but was not found."
  if [[ "$force" == "1" || ! -d "$src/node_modules" ]]; then
    log "Installing dependencies"
    if [[ -f "$src/package-lock.json" ]]; then
      ( cd "$src" && npm ci )
    else
      ( cd "$src" && npm install )
    fi
  else
    ok "Dependencies present (skipping install)"
  fi
}

# Build + package into a .vsix, then point VSIX_PATH at the freshest one.
build_and_package() {
  local src="$1"
  log "Building + packaging .vsix"
  ( cd "$src" && npm run package )
  VSIX_PATH="$(ls -t "$src"/*.vsix 2>/dev/null | head -n1 || true)"
  [[ -n "$VSIX_PATH" ]] || die "Packaging finished but no .vsix was produced in $src"
}

install_vsix() {
  local cursor="$1" vsix="$2"
  log "Installing $(basename "$vsix") into Cursor"
  "$cursor" --install-extension "$vsix" --force
}

# Best-effort reload of the focused Cursor window (macOS only).
reload_cursor() {
  [[ "$NO_RELOAD" == "1" ]] && { warn "Reload skipped (--no-reload)."; return 0; }
  if [[ "$(uname)" != "Darwin" ]] || ! command -v osascript &>/dev/null; then
    warn "Auto-reload only supported on macOS. Reload manually: Cmd+Shift+P → 'Developer: Reload Window'."
    return 0
  fi
  log "Reloading Cursor window"
  osascript >/dev/null 2>&1 <<'APPLESCRIPT' || warn "Auto-reload failed. Reload manually: Cmd+Shift+P → 'Developer: Reload Window'."
tell application "Cursor" to activate
delay 0.4
tell application "System Events"
  keystroke "p" using {command down, shift down}
  delay 0.4
  keystroke "Developer: Reload Window"
  delay 0.4
  key code 36
end tell
APPLESCRIPT
}

main() {
  if [[ "$CMD" == "help" ]]; then show_help; exit 0; fi

  resolve_cursor

  if [[ "$CMD" == "uninstall" ]]; then
    log "Uninstalling $EXT_ID from Cursor"
    if "$CURSOR_BIN" --uninstall-extension "$EXT_ID"; then
      ok "Uninstalled. Reload Cursor to finish."
    else
      die "Uninstall failed (is it installed?)."
    fi
    exit 0
  fi

  local deps_force=0
  if [[ "$CMD" == "update" ]]; then
    sync_cache_clone
    deps_force=1
  elif detect_local_checkout; then
    SRC_DIR="$LOCAL_CHECKOUT"
    ok "Building local checkout: $SRC_DIR"
  else
    sync_cache_clone
    deps_force=1
  fi

  install_deps "$SRC_DIR" "$deps_force"
  build_and_package "$SRC_DIR"
  install_vsix "$CURSOR_BIN" "$VSIX_PATH"
  reload_cursor

  ok "Done. Open it with: Cmd+Shift+P → 'Cursor Engineering Coach: Open Dashboard'"
}

main
