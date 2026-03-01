#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# If PUID/PGID are set to non-root, create a user and run as that user
if [ "$PUID" != "0" ] || [ "$PGID" != "0" ]; then
  PGID="${PGID:-$PUID}"

  # Find or create group with the target GID
  EXISTING_GROUP=$(getent group "$PGID" | cut -d: -f1 || true)
  if [ -n "$EXISTING_GROUP" ]; then
    GROUP_NAME="$EXISTING_GROUP"
  else
    addgroup -g "$PGID" seedr
    GROUP_NAME="seedr"
  fi

  # Find or create user with the target UID
  EXISTING_USER=$(getent passwd "$PUID" | cut -d: -f1 || true)
  if [ -n "$EXISTING_USER" ]; then
    USER_NAME="$EXISTING_USER"
  else
    adduser -u "$PUID" -G "$GROUP_NAME" -s /bin/sh -D seedr
    USER_NAME="seedr"
  fi

  # Ensure data directory is owned by the target user
  chown -R "$PUID:$PGID" /data

  echo "Running as uid=$PUID($USER_NAME) gid=$PGID($GROUP_NAME)"
  exec su-exec "$USER_NAME" "$@"
else
  exec "$@"
fi
