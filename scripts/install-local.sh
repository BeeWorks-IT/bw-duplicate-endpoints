#!/usr/bin/env bash
# Local BeeWorks deployment helper: link this checkout as a plugin package and
# enable the backend for every profile on this host. Idempotent.
# The gateway mounts backend routes at startup: restart hermes-serve once after.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${HERMES_ROOT:-$HOME/.hermes}"
NAME="bw-duplicate-endpoints"

mkdir -p "$ROOT/plugins"
if [ ! -e "$ROOT/plugins/$NAME" ]; then
  ln -s "$HERE" "$ROOT/plugins/$NAME"
  echo "linked $ROOT/plugins/$NAME -> $HERE"
fi

hermes plugins enable "$NAME"
for dir in "$ROOT"/profiles/*/; do
  [ -f "$dir/config.yaml" ] || continue
  HERMES_HOME="$dir" hermes plugins enable "$NAME" || true
done

echo
echo "Done. Restart the gateway once to mount the backend:"
echo "  systemctl restart hermes-serve   # or: hermes gateway restart"
echo "Then open Settings > Plugins > Duplicate Custom Endpoints in Hermes Desktop."
