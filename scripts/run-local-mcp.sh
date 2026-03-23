#!/usr/bin/env bash
# see docs/TESTING.md for the usage

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENTRYPOINT="${REPO_ROOT}/dist/index.js"

API_BASE_URL="${1:-${COGNIGY_API_BASE_URL:-}}"
API_KEY="${2:-${COGNIGY_API_KEY:-}}"

if [[ -z "${API_BASE_URL}" || -z "${API_KEY}" ]]; then
  echo "Usage: $0 <cognigy-api-base-url> <cognigy-api-key>" >&2
  echo "Or set COGNIGY_API_BASE_URL and COGNIGY_API_KEY in the environment." >&2
  exit 1
fi

if [[ ! -f "${ENTRYPOINT}" ]]; then
  echo "Missing ${ENTRYPOINT}. Run 'npm run build' first." >&2
  exit 1
fi

export COGNIGY_API_BASE_URL="${API_BASE_URL}"
export COGNIGY_API_KEY="${API_KEY}"

exec node "${ENTRYPOINT}"
