#!/usr/bin/env bash
set -euo pipefail
exec 9>/run/lock/pricedip-deploy.lock
flock -w 300 9
previous=$(readlink -f /opt/pricedip/previous)
test -f "$previous/dist-server/app.js"
current=$(readlink -f /opt/pricedip/current)
ln -sfn "$previous" /opt/pricedip/current.next
mv -Tf /opt/pricedip/current.next /opt/pricedip/current
systemctl restart pricedip pricedip-worker
sleep 3
curl -fsS http://127.0.0.1:4350/healthz
ln -sfn "$current" /opt/pricedip/previous
