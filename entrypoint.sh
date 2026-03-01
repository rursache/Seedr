#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# If PUID/PGID are set to non-root, create a user and run as that user
if [ "$PUID" != "0" ] || [ "$PGID" != "0" ]; then
  # Default to PUID if PGID not explicitly set
  PGID="${PGID:-$PUID}"

  # Create group and user if they don't exist
  if ! getent group seedr >/dev/null 2>&1; then
    addgroup -g "$PGID" seedr
  fi
  if ! getent passwd seedr >/dev/null 2>&1; then
    adduser -u "$PUID" -G seedr -s /bin/sh -D seedr
  fi

  # Ensure data directory is owned by the target user
  chown -R "$PUID:$PGID" /data

  echo "Running as uid=$PUID gid=$PGID"
  exec su-exec seedr "$@"
else
  exec "$@"
fi
