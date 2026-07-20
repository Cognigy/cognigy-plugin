# NiCE Cognigy Plugin - bootstrap installer (Windows PowerShell).
#
# Run in PowerShell (opened as Administrator is recommended for Claude Code):
#   irm https://raw.githubusercontent.com/Cognigy/cognigy-plugin/main/install.ps1 | iex
#
# This is a THIN bootstrap: it only ensures Node.js is present, then hands off to
# the real installer (`cognigy-setup`, fetched from npm at the pinned version).
# It never installs Node for you - if Node is missing it tells you how to get it
# and exits, so nothing on your machine is changed behind your back.
$ErrorActionPreference = 'Stop'

$MinNodeMajor = 20
$Pkg = '@cognigy/plugin-engine@latest'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error @"
Node.js is required but was not found.

Install Node.js $MinNodeMajor LTS or newer, then re-run this command:
  - Download: https://nodejs.org  (pick the LTS installer)

After installing Node, open a NEW PowerShell window and run this bootstrap again.
"@
  exit 1
}

$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt $MinNodeMajor) {
  Write-Error "Node.js $MinNodeMajor+ is required, but $(& node -v) is installed. Upgrade from https://nodejs.org (LTS), open a new PowerShell window, and re-run."
  exit 1
}

# npx ships with npm/Node. Hand off to the real installer, forwarding any flags.
& npx -y -p $Pkg cognigy-setup @args
