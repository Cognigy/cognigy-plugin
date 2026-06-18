#!/usr/bin/env bash
# Append a footer linking to the README install section onto a GitHub release body.
# Usage: append-release-install-link.sh <git-tag>
# Requires: gh (preinstalled on GitHub-hosted runners), GITHUB_TOKEN in env.
set -euo pipefail

TAG="$1"
BODY="$(gh release view "$TAG" --json body -q .body)"

printf '%s\n\n---\n\n📦 **[Install instructions](https://github.com/Cognigy/cognigy-plugin#installation)**\n' \
  "$BODY" | gh release edit "$TAG" -F -
