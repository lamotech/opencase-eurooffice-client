#!/bin/sh
# Installs the OpenCase plugin on a Document Server (package install), so it
# is available in documents opened from OpenCase, in browsers and in the
# Euro-Office desktop app.
#
# Run as root from the unpacked plugin folder:
#   sudo sh install-server.sh --url https://dev03.opencase.dk/
#
# Options:
#   --url <OpenCase URL>   Default OpenCase server for all users (sets DEFAULT_URL).
#   --dir <documentserver> Document Server folder. Found automatically if left out.
#   --uninstall            Remove the plugin.
set -eu

GUID="{0CCBED17-288E-417C-8A84-26832C7AF9D2}"
SRC="$(cd "$(dirname "$0")" && pwd)"
URL=""
DS_DIR=""
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --dir) DS_DIR="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# The Document Server's web root holds web-apps and sdkjs (and sdkjs-plugins,
# which may not exist yet). /etc/<product>/documentserver is only its config.
is_ds_root() {
  [ -d "$1/web-apps" ] && [ -d "$1/sdkjs" ]
}

if [ -z "$DS_DIR" ]; then
  for candidate in /var/www/euro-office/documentserver /var/www/eurooffice/documentserver /var/www/onlyoffice/documentserver; do
    if is_ds_root "$candidate"; then DS_DIR="$candidate"; break; fi
  done
fi

# Otherwise use the folder nginx serves web-apps/sdkjs from, e.g.
#   alias /var/www/onlyoffice/documentserver/$2$3;
if [ -z "$DS_DIR" ]; then
  for conf in /etc/*/documentserver/nginx/includes/*.conf /etc/nginx/includes/*.conf; do
    [ -f "$conf" ] || continue
    candidate=$(sed -n 's|^[[:space:]]*alias[[:space:]]\{1,\}\([^$;]*\)/\$2\$3;.*|\1|p' "$conf" | head -n 1)
    if [ -n "$candidate" ] && is_ds_root "$candidate"; then DS_DIR="$candidate"; break; fi
  done
fi

# Last resort: search for the web-apps folder of a Document Server.
if [ -z "$DS_DIR" ]; then
  candidate=$(find / -xdev -type d -path "*documentserver/web-apps" -prune -print 2>/dev/null | head -n 1)
  if [ -n "$candidate" ]; then DS_DIR=$(dirname "$candidate"); fi
fi

if [ -z "$DS_DIR" ] || ! is_ds_root "$DS_DIR"; then
  echo "Document Server not found. Pass --dir with the folder that contains web-apps and sdkjs." >&2
  exit 1
fi
echo "Document Server: $DS_DIR"
mkdir -p "$DS_DIR/sdkjs-plugins"

TARGET="$DS_DIR/sdkjs-plugins/$GUID"
rm -rf "$TARGET"

if [ "$UNINSTALL" -eq 0 ]; then
  mkdir -p "$TARGET"
  cp -r "$SRC/config.json" "$SRC"/*.html "$SRC/scripts" "$SRC/resources" "$TARGET/"

  if [ -n "$URL" ]; then
    # Escape characters that are special in a sed replacement.
    ESCAPED=$(printf '%s' "$URL" | sed 's/[&|\\]/\\&/g')
    sed -i "s|var DEFAULT_URL = \"[^\"]*\";|var DEFAULT_URL = \"$ESCAPED\";|" "$TARGET/scripts/settings.js"
  fi

  # Same owner as the other Document Server files.
  OWNER=$(stat -c '%U:%G' "$DS_DIR/web-apps")
  chown "$OWNER" "$DS_DIR/sdkjs-plugins"
  chmod 755 "$DS_DIR/sdkjs-plugins"
  chown -R "$OWNER" "$TARGET"
  find "$TARGET" -type d -exec chmod 755 {} +
  find "$TARGET" -type f -exec chmod 644 {} +
  echo "Installed OpenCase plugin in $TARGET"
else
  echo "Removed OpenCase plugin from $TARGET"
fi

# Editors cache static files by version; make them reload the plugin list.
for flush in documentserver-flush-cache.sh eurooffice-documentserver-flush-cache.sh; do
  if command -v "$flush" >/dev/null 2>&1; then
    "$flush"
    echo "Ran $flush"
    break
  fi
done

echo "Reload the editor (close and reopen the document) to see the change."
