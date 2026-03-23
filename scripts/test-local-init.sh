#!/usr/bin/env bash
# See docs/TESTING.md for usage.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_LAUNCHER="${REPO_ROOT}/scripts/run-local-mcp.sh"
CLIENT="${1:-}"

if [[ -z "${CLIENT}" ]]; then
  echo "Usage: $0 <client>" >&2
  echo "Supported clients: claude, claude-code, codex, cursor, vscode" >&2
  exit 1
fi

case "${CLIENT}" in
  claude|claude-code|codex|cursor|vscode)
    ;;
  *)
    echo "Unsupported client: ${CLIENT}" >&2
    echo "Supported clients: claude, claude-code, codex, cursor, vscode" >&2
    exit 1
    ;;
esac

if [[ ! -f "${REPO_ROOT}/dist/index.js" ]]; then
  echo "Missing ${REPO_ROOT}/dist/index.js. Run 'npm run build' first." >&2
  exit 1
fi

if [[ ! -f "${LOCAL_LAUNCHER}" ]]; then
  echo "Missing ${LOCAL_LAUNCHER}." >&2
  exit 1
fi

export COGNIGY_MCP_INIT_COMMAND="bash"
export COGNIGY_MCP_INIT_ARGS="[\"${LOCAL_LAUNCHER}\"]"

exec node "${REPO_ROOT}/dist/index.js" init --client "${CLIENT}"
