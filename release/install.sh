#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="obsidian-local-audio-plus"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_FILES=("main.js" "manifest.json" "styles.css")

for file in "${PLUGIN_FILES[@]}"; do
  if [[ ! -f "$SCRIPT_DIR/$file" ]]; then
    echo "Missing plugin file: $SCRIPT_DIR/$file" >&2
    exit 1
  fi
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to locate the current Obsidian vault automatically." >&2
  echo "Install manually by copying this folder to <vault>/.obsidian/plugins/." >&2
  exit 1
fi

CONFIG_CANDIDATES=()
if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  CONFIG_CANDIDATES+=("$XDG_CONFIG_HOME/obsidian/obsidian.json")
fi
CONFIG_CANDIDATES+=("$HOME/.config/obsidian/obsidian.json")
CONFIG_CANDIDATES+=("$HOME/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json")
CONFIG_CANDIDATES+=("$HOME/snap/obsidian/current/.config/obsidian/obsidian.json")

CONFIG_PATH=""
for candidate in "${CONFIG_CANDIDATES[@]}"; do
  if [[ -f "$candidate" ]]; then
    CONFIG_PATH="$candidate"
    break
  fi
done

if [[ -z "$CONFIG_PATH" ]]; then
  echo "Could not find Obsidian config." >&2
  echo "Install manually by copying this folder to <vault>/.obsidian/plugins/." >&2
  exit 1
fi

VAULT_PATH="$(python3 - "$CONFIG_PATH" <<'PY'
import json
import os
import sys

config_path = sys.argv[1]
with open(config_path, "r", encoding="utf-8") as fh:
    config = json.load(fh)

vaults = [
    vault for vault in config.get("vaults", {}).values()
    if isinstance(vault, dict) and vault.get("path") and os.path.isdir(vault.get("path"))
]
if not vaults:
    sys.exit(2)

open_vaults = [vault for vault in vaults if vault.get("open") is True]
selected = max(open_vaults or vaults, key=lambda vault: vault.get("ts", 0))
print(selected["path"])
PY
)"

if [[ -z "$VAULT_PATH" || ! -d "$VAULT_PATH" ]]; then
  echo "No existing Obsidian vault path found in $CONFIG_PATH" >&2
  exit 1
fi

OBSIDIAN_DIR="$VAULT_PATH/.obsidian"
TARGET_DIR="$OBSIDIAN_DIR/plugins/$PLUGIN_ID"
mkdir -p "$TARGET_DIR"

for file in "${PLUGIN_FILES[@]}"; do
  cp -f "$SCRIPT_DIR/$file" "$TARGET_DIR/$file"
done

python3 - "$OBSIDIAN_DIR/community-plugins.json" "$PLUGIN_ID" <<'PY'
import json
import os
import sys

path, plugin_id = sys.argv[1], sys.argv[2]
plugins = []
if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as fh:
        try:
            loaded = json.load(fh)
            if isinstance(loaded, list):
                plugins = loaded
        except json.JSONDecodeError:
            plugins = []

if plugin_id not in plugins:
    plugins.append(plugin_id)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(plugins, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
PY

echo "Installed $PLUGIN_ID to:"
echo "$TARGET_DIR"
echo "Restart Obsidian if the plugin is not visible immediately."
