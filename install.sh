#!/usr/bin/env bash
set -euo pipefail

UUID="minie-pill@toxic"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

command -v glib-compile-schemas >/dev/null 2>&1 || { echo "Error: glib-compile-schemas not found." >&2; exit 1; }

command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions disable "$UUID" >/dev/null 2>&1 || true

mkdir -p "$DEST"
# copy everything except installer + schemas (schema is compiled fresh on this machine)
find "$SRC" -mindepth 1 -maxdepth 1 ! -name install.sh ! -name schemas -exec cp -a -t "$DEST" -- {} +
mkdir -p "$DEST/schemas"
cp -a "$SRC/schemas/org.gnome.shell.extensions.minie-pill.gschema.xml" "$DEST/schemas/"
rm -f "$DEST/schemas/gschemas.compiled"
glib-compile-schemas --strict "$DEST/schemas"
[ -f "$DEST/schemas/gschemas.compiled" ] || { echo "Error: schema compile failed" >&2; exit 1; }

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" || true
    echo "Installed. Log out and back in if the pill does not update (Wayland)."
else
    echo "Installed. Enable '$UUID' in the Extensions app."
fi
