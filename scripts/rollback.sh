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
healthy=false
for attempt in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:4350/healthz >/dev/null && systemctl is-active --quiet pricedip-worker; then healthy=true; break; fi
  sleep 2
done
if [ "$healthy" != true ]; then
  ln -sfn "$current" /opt/pricedip/current.next
  mv -Tf /opt/pricedip/current.next /opt/pricedip/current
  systemctl restart pricedip pricedip-worker
  exit 1
fi
sudo -u pricedip node "$current/scripts/release-event.mjs" rollback
ln -sfn "$current" /opt/pricedip/previous
