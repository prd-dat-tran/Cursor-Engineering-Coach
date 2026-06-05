#!/usr/bin/env bash
# Thin wrapper kept for backwards compatibility. The canonical one-shot
# build + install tool is scripts/install-cursor.sh (also: `npm run deploy`).
set -euo pipefail
exec "$(dirname "$0")/install-cursor.sh" install "$@"
