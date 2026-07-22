#!/usr/bin/env bash
# NiCE Cognigy Plugin — bootstrap installer (macOS / Linux).
#
# Run interactively (keeps your terminal attached for the masked API-key prompt):
#   bash <(curl -fsSL https://raw.githubusercontent.com/Cognigy/cognigy-plugin/main/install.sh)
#
# This is a THIN bootstrap: it only ensures Node.js is present, then hands off to
# the real installer (`cognigy-setup`, fetched from npm — the latest published
# version). It never installs Node for you — if Node is missing it tells you how to get it
# and exits, so nothing on your machine is changed behind your back.
#
# NOTE: do NOT pipe this via `curl ... | bash` — a pipe steals stdin, so the
# installer's interactive prompts break. The `bash <(curl ...)` form above keeps
# your terminal attached.
set -euo pipefail

MIN_NODE_MAJOR=20
PKG="@cognigy/plugin-engine@latest"

err() { printf '%s\n' "$*" >&2; }

if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but was not found."
  err ""
  err "Install Node.js ${MIN_NODE_MAJOR} LTS or newer, then re-run this command:"
  err "  • Download:  https://nodejs.org  (pick the LTS installer)"
  err "  • Or via nvm: https://github.com/nvm-sh/nvm  then 'nvm install --lts'"
  err ""
  err "After installing Node, open a NEW terminal and run this bootstrap again."
  exit 1
fi

# node -p prints just the version string; guard against odd output.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt "$MIN_NODE_MAJOR" ] 2>/dev/null; then
  err "Node.js ${MIN_NODE_MAJOR}+ is required, but $(node -v 2>/dev/null || echo 'an older version') is installed."
  err "Upgrade Node (https://nodejs.org — LTS), open a new terminal, and re-run this command."
  exit 1
fi

# npx ships with npm/Node. Hand off to the real installer; forward any flags
# (e.g. --client, --api-base-url) so scripted use still works through the bootstrap.
exec npx -y -p "$PKG" cognigy-setup "$@"
