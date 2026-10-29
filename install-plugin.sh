#!/bin/sh
# Installs the OpenCase plugin into the current user's Euro-Office desktop app
# on Linux. Same as install-plugin.ps1 on Windows.
#
# Run as the user (not with sudo: the plugin folder is in the user's home):
#   sh install-plugin.sh --zip opencase-plugin.zip --url https://opencase.kommune.dk/
#
# Options:
#   --zip <file>   Install from dist/opencase-plugin.zip (package-plugin.ps1).
#                  Without it, the plugin is taken from this script's folder
#                  (the repo or the unpacked zip).
#   --url <URL>    Default OpenCase server (sets DEFAULT_URL). Users can still
#                  change it under Indstillinger.
#   --dir <folder> The desktop app's sdkjs-plugins folder. Found automatically
#                  if left out.
#   --uninstall    Remove the plugin.
set -eu

SRC="$(cd "$(dirname "$0")" && pwd)"
ZIP=""
URL=""
PLUGINS_DIR=""
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --zip) ZIP="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --dir) PLUGINS_DIR="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

case "$URL" in
  ""|http://*|https://*) ;;
  *) echo "--url must start with http:// or https://" >&2; exit 1 ;;
esac

if [ "$(id -u)" -eq 0 ] && [ -z "$PLUGINS_DIR" ]; then
  echo "Warning: running as root installs the plugin for root only. Run as the user, or pass --dir." >&2
fi

UNPACKED=""
cleanup() { if [ -n "$UNPACKED" ]; then rm -rf "$UNPACKED"; fi; }
trap cleanup EXIT

if [ -n "$ZIP" ]; then
  command -v unzip >/dev/null 2>&1 || { echo "unzip is needed for --zip." >&2; exit 1; }
  UNPACKED=$(mktemp -d)
  unzip -q "$ZIP" -d "$UNPACKED"
  SRC="$UNPACKED"
fi

[ -f "$SRC/config.json" ] || { echo "No config.json in $SRC." >&2; exit 1; }
# The folder name is the GUID in config.json, without "asc.".
GUID=$(sed -n 's/.*"guid"[[:space:]]*:[[:space:]]*"asc\.\([^"]*\)".*/\1/p' "$SRC/config.json" | head -n 1)
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/config.json" | head -n 1)
[ -n "$GUID" ] || { echo "No guid in $SRC/config.json." >&2; exit 1; }

# The desktop app keeps user plugins in <data folder>/desktopeditors/sdkjs-plugins,
# where ONLYOFFICE uses ~/.local/share/onlyoffice. The app creates its data
# folder on first start, so prefer one that exists; Flatpak installs keep it
# under ~/.var/app/<app id>/data.
if [ -z "$PLUGINS_DIR" ]; then
  DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
  for candidate in "$DATA_HOME"/euro-office "$DATA_HOME"/eurooffice "$DATA_HOME"/Euro-Office \
      "$HOME"/.var/app/*[Ee]uro*[Oo]ffice*/data/*; do
    if [ -d "$candidate/desktopeditors" ]; then
      PLUGINS_DIR="$candidate/desktopeditors/sdkjs-plugins"
      break
    fi
  done
fi
if [ -z "$PLUGINS_DIR" ]; then
  PLUGINS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/euro-office/desktopeditors/sdkjs-plugins"
  echo "Warning: no Euro-Office data folder found (start Euro-Office once first?). Using $PLUGINS_DIR; pass --dir if that is wrong." >&2
fi

if pgrep -f "desktopeditors" >/dev/null 2>&1; then
  echo "Warning: Euro-Office is running. Restart it after this script to load the changes." >&2
fi

TARGET="$PLUGINS_DIR/$GUID"
rm -rf "$TARGET"

if [ "$UNINSTALL" -eq 1 ]; then
  echo "Removed OpenCase plugin from $TARGET"
  exit 0
fi

mkdir -p "$TARGET"
# The files that make up the plugin (as in install-plugin.ps1).
cp -r "$SRC/config.json" "$SRC"/*.html "$SRC/scripts" "$SRC/resources" "$TARGET/"

if [ -n "$URL" ]; then
  # Escape characters that are special in a sed replacement.
  ESCAPED=$(printf '%s' "$URL" | sed 's/[&|\\]/\\&/g')
  sed -i "s|var DEFAULT_URL = \"[^\"]*\";|var DEFAULT_URL = \"$ESCAPED\";|" "$TARGET/scripts/settings.js"
fi

echo "Installed OpenCase $VERSION to $TARGET"
