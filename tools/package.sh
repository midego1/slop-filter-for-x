#!/usr/bin/env bash
# Build a Chrome Web Store upload zip containing only what the extension needs
# at runtime. Run from anywhere; output lands in dist/.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="dist/slop-filter-for-x-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"
zip -r "$OUT" \
  manifest.json \
  icons/icon16.png icons/icon48.png icons/icon128.png \
  src/detector.js src/tags.js src/api.js src/content.js src/background.js src/ui.css \
  popup/popup.html popup/popup.css popup/popup.js \
  -x '.*'

echo "Built $OUT"
unzip -l "$OUT"
