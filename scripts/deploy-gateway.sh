#!/usr/bin/env bash
set -euo pipefail
# Forced-command entrypoint for the dedicated CI key; no shell commands accepted.
request=${1:-}
[[ "$request" =~ ^deploy\ ([a-f0-9]{40})$ ]] || exit 64
revision=${BASH_REMATCH[1]}
archive=$(mktemp /var/tmp/pricedip-release.XXXXXX.tar.gz)
trap 'rm -f "$archive"' EXIT
head -c 104857601 > "$archive"
[ "$(stat -c %s "$archive")" -le 104857600 ] || exit 65
# Validate paths and reject links/devices before root-owned extraction.
node - "$archive" <<'JS'
const {execFileSync}=require('node:child_process');const file=process.argv[2];
const names=execFileSync('tar',['-tzf',file],{encoding:'utf8'}).trim().split('\n');
if(names.some(p=>p.startsWith('/')||p.split('/').includes('..')||! /^(dist|dist-server|scripts|deploy|package\.json|package-lock\.json|release\.json)(\/|$)/.test(p)))process.exit(1);
const types=execFileSync('tar',['-tvzf',file],{encoding:'utf8'}).trim().split('\n');if(types.some(l=>!['-','d'].includes(l[0])))process.exit(1);
JS
release="/opt/pricedip/releases/$revision"
[ ! -e "$release" ] || { echo 'Release already exists; refusing overwrite'; exit 66; }
install -d "$release"
tar -xzf "$archive" --no-same-owner -C "$release"
cd "$release"
# Dependencies are installed without package lifecycle scripts.
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
PLAYWRIGHT_BROWSERS_PATH=/opt/pricedip/browsers node node_modules/playwright/cli.js install chromium
bash scripts/activate.sh "$revision"
