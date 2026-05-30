#!/usr/bin/env bash
# --------------------------------------------------------------------------------------------
#  Cursor Engineering Coach — local test/install helper.
#  Builds the extension, packages it as a .vsix, installs into Cursor, and optionally launches.
# --------------------------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Resolve the `cursor` CLI (macOS may not have it on PATH)
if command -v cursor &>/dev/null; then
  CODE=cursor
elif [[ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]]; then
  CODE="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
else
  echo "❌ Could not find Cursor ('cursor' CLI). Install it via: Cursor → Cmd+Shift+P → 'Shell Command: Install cursor command'"
  exit 1
fi

# Package the extension (builds + swaps README + creates .vsix)
echo "📦 Packaging extension..."
npm run package

# Find the generated .vsix file (latest by modification time)
shopt -s nullglob
vsix_files=(*.vsix)
shopt -u nullglob
if [[ ${#vsix_files[@]} -eq 0 ]]; then
  echo "❌ No .vsix file found after packaging"
  exit 1
fi
VSIX=$(ls -t "${vsix_files[@]}" | head -n1)

echo "📥 Installing $VSIX..."
"$CODE" --install-extension "$VSIX" --force

if [[ "${SKIP_LAUNCH:-}" == "1" ]]; then
  echo "✅ Extension installed (launch skipped)"
else
  echo "🚀 Launching Cursor in current directory..."
  "$CODE" .
fi
