#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VSIX="cursor-engineering-coach-0.1.0.vsix"

echo "==> Building extension..."
npx vsce package --no-dependencies

echo "==> Installing $VSIX into Cursor..."
cursor --install-extension "$VSIX" --force

echo "==> Reloading Cursor..."
osascript -e '
tell application "Cursor"
  activate
end tell
delay 0.3
tell application "System Events"
  keystroke "p" using {command down, shift down}
  delay 0.3
  keystroke "Developer: Reload Window"
  delay 0.3
  key code 36
end tell
'

echo "==> Done."
