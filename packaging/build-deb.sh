#!/bin/sh
# Build a .deb from the staged tree.
#
# Usage: packaging/build-deb.sh <amd64 | arm64>
# Requires: packaging/stage.sh <linux-x64|linux-arm64> to have been run first.
#
# Environment: VERSION (e.g. v1.2.3, default 0.0.0), MAINTAINER (optional)
# Output: build/out/seedr_<version>_<arch>.deb
set -eu

ARCH="${1:?usage: $0 <amd64|arm64>}"
case "$ARCH" in
  amd64) TARGET="linux-x64" ;;
  arm64) TARGET="linux-arm64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAGE="$ROOT/build/stage/$TARGET/seedr"
[ -d "$STAGE" ] || { echo "run packaging/stage.sh $TARGET first" >&2; exit 1; }

# v1.2.3 -> 1.2.3 ; v1.0.0-rc1 -> 1.0.0~rc1 ; anything non-numeric -> 0.0.0~<it>
RAW="${VERSION:-0.0.0}"
RAW="${RAW#v}"
case "$RAW" in
  [0-9]*) DEB_VERSION=$(printf '%s' "$RAW" | sed 's/-/~/; s/@/+/') ;;
  *)      DEB_VERSION="0.0.0~$(printf '%s' "$RAW" | tr -c 'A-Za-z0-9.+~\n' '.')" ;;
esac
MAINTAINER="${MAINTAINER:-Seedr packagers <noreply@users.noreply.github.com>}"

PKG="$ROOT/build/deb/seedr_${DEB_VERSION}_${ARCH}"
rm -rf "$PKG"
mkdir -p "$PKG/DEBIAN" "$PKG/opt" "$PKG/lib/systemd/system" "$PKG/etc/default" "$ROOT/build/out"

cp -a "$STAGE" "$PKG/opt/seedr"
install -m 644 "$ROOT/packaging/debian/seedr.service" "$PKG/lib/systemd/system/seedr.service"
install -m 644 "$ROOT/packaging/debian/seedr.default" "$PKG/etc/default/seedr"
for s in postinst prerm postrm; do
  install -m 755 "$ROOT/packaging/debian/$s" "$PKG/DEBIAN/$s"
done
echo "/etc/default/seedr" > "$PKG/DEBIAN/conffiles"

SIZE=$(du -sk "$PKG/opt" "$PKG/lib" "$PKG/etc" | awk '{s+=$1} END {print s}')
cat > "$PKG/DEBIAN/control" <<CONTROL
Package: seedr
Version: $DEB_VERSION
Architecture: $ARCH
Maintainer: $MAINTAINER
Installed-Size: $SIZE
Depends: adduser
Section: net
Priority: optional
Homepage: https://github.com/rursache/Seedr
Description: BitTorrent ratio master with web UI
 Seedr loads .torrent files, connects to their trackers and announces
 simulated upload data, emulating real BitTorrent clients. It ships with
 its own Node.js runtime, runs as a systemd service and exposes a web
 dashboard on http://localhost:8080 .
CONTROL

dpkg-deb --root-owner-group -Zxz --build "$PKG" "$ROOT/build/out/"
echo "==> $(ls "$ROOT"/build/out/seedr_${DEB_VERSION}_${ARCH}.deb)"
