#!/bin/sh
# Build a self-contained application tree (app + production deps + Node runtime)
# that the .deb and Windows installers are made from. The desktop launchers are
# added by build-deb.sh and by the Windows installer build (packaging/windows/launcher).
#
# Usage: packaging/stage.sh <linux-x64 | linux-arm64 | win-x64>
#
# Environment (all optional):
#   VERSION       version string embedded in the app (default: from git, see scripts/version.sh)
#   NODE_VERSION  exact Node version to bundle, e.g. v24.11.0 (default: latest v24.x)
#   NODE_BIN      path to an existing node binary to bundle instead of downloading one
#                 (handy for local tests)
#
# Output: build/stage/<target>/seedr/
set -eu

TARGET="${1:?usage: $0 <linux-x64|linux-arm64|win-x64>}"
case "$TARGET" in
  linux-x64|linux-arm64|win-x64) ;;
  *) echo "unknown target: $TARGET" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/build/stage/$TARGET/seedr"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"

echo "==> Building backend and UI"
npm ci
(cd ui && npm ci)
npm run build

echo "==> Assembling $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -a dist "$OUT/dist"
mkdir -p "$OUT/ui"
cp -a ui/dist "$OUT/ui/dist"
cp -a clients "$OUT/clients"
cp package.json package-lock.json LICENSE "$OUT/"

echo "==> Installing production dependencies"
(cd "$OUT" && npm ci --omit=dev --no-audit --no-fund)

# Trim what is never needed at runtime (tests, benchmarks, CI files, empty dirs)
find "$OUT/node_modules" -type d \( -name test -o -name tests -o -name __tests__ \
  -o -name benchmark -o -name benchmarks -o -name .github \) -prune -exec rm -rf {} +
find "$OUT/node_modules" -type d -empty -delete

echo "==> Bundling Node.js runtime"
if [ -n "${NODE_BIN:-}" ]; then
  case "$TARGET" in
    win-x64) cp "$NODE_BIN" "$OUT/node.exe" ;;
    *)       cp "$NODE_BIN" "$OUT/node" ;;
  esac
else
  BASE="https://nodejs.org/dist/${NODE_VERSION:-latest-v24.x}"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  case "$TARGET" in
    win-x64) EXT="zip" ;;
    *)       EXT="tar.xz" ;;
  esac
  FILE=$(grep -E " node-v[0-9.]+-$TARGET\.$EXT\$" "$TMP/SHASUMS256.txt" | awk '{print $2}' | head -n 1)
  [ -n "$FILE" ] || { echo "no Node build found for $TARGET at $BASE" >&2; exit 1; }
  echo "    $FILE"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -)
  DIR="${FILE%.$EXT}"
  case "$TARGET" in
    win-x64)
      unzip -q -j "$TMP/$FILE" "$DIR/node.exe" -d "$OUT"
      ;;
    *)
      tar -xJf "$TMP/$FILE" -C "$TMP" "$DIR/bin/node"
      cp "$TMP/$DIR/bin/node" "$OUT/node"
      ;;
  esac
fi
[ "$TARGET" = "win-x64" ] || chmod 755 "$OUT/node"

# Normalise permissions (npm leaves a mix behind)
chmod -R go-w,a+rX "$OUT"

echo "==> Done: $OUT"
