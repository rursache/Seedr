#!/bin/sh
# Generate src/version.json from git metadata.
# Called during build — works locally (git available) and in Docker (build args).

VERSION="${VERSION:-}"
COMMIT="${COMMIT:-}"
BUILD_DATE="${BUILD_DATE:-}"

# If not provided via env/args, read from git
if [ -z "$VERSION" ] && command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  TAG=$(git describe --tags --exact-match 2>/dev/null || echo "")
  if [ -n "$TAG" ]; then
    VERSION="$TAG"
  else
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    VERSION="${BRANCH}@${SHORT}"
  fi
fi

if [ -z "$COMMIT" ] && command -v git >/dev/null 2>&1; then
  COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
fi

if [ -z "$BUILD_DATE" ]; then
  BUILD_DATE=$(date -u +"%Y-%m-%d")
fi

# Fallbacks
VERSION="${VERSION:-dev}"
COMMIT="${COMMIT:-unknown}"

# Detect tagged vs untagged version
IS_TAG=$(echo "$VERSION" | grep -qE '^v[0-9]' && echo "yes" || echo "no")

# For untagged versions without a commit hash, append one (e.g. master -> master@1a2bd3e)
SHORT_COMMIT=$(echo "$COMMIT" | cut -c1-7)
HAS_HASH=$(echo "$VERSION" | grep -q '@' && echo "yes" || echo "no")
if [ "$IS_TAG" = "no" ] && [ "$HAS_HASH" = "no" ] && [ "$SHORT_COMMIT" != "unknown" ]; then
  VERSION="${VERSION}@${SHORT_COMMIT}"
fi

cat > src/version.json <<EOF
{
  "version": "$VERSION",
  "commit": "$COMMIT",
  "buildDate": "$BUILD_DATE",
  "isTagged": $( [ "$IS_TAG" = "yes" ] && echo "true" || echo "false" )
}
EOF

echo "Version: $VERSION ($COMMIT) built $BUILD_DATE"
