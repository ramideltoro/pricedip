#!/usr/bin/env bash
set -euo pipefail
revision=${1:?release revision required}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
exec 9>/run/lock/pricedip-deploy.lock
flock -w 300 9
release="/opt/pricedip/releases/$revision"
test -f "$release/dist-server/app.js"
previous=$(readlink -f /opt/pricedip/current || true)
if [ -n "$previous" ] && [ -f /var/lib/pricedip/pricedip.sqlite ]; then sudo -u pricedip DB_PATH=/var/lib/pricedip/pricedip.sqlite node "$previous/scripts/backup.mjs"; fi
install -m 644 "$release"/deploy/pricedip*.service /etc/systemd/system/
install -m 644 "$release"/deploy/pricedip*.timer /etc/systemd/system/
systemctl daemon-reload
ln -sfn "$release" /opt/pricedip/current.next
mv -Tf /opt/pricedip/current.next /opt/pricedip/current
systemctl enable pricedip pricedip-worker pricedip-backup.timer
systemctl restart pricedip pricedip-worker
systemctl start pricedip-backup.timer
for attempt in $(seq 1 20); do
 if curl -fsS http://127.0.0.1:4350/healthz | node -e 'let x="";process.stdin.on("data",c=>x+=c).on("end",()=>process.exit(JSON.parse(x).ok?0:1))'; then
  [ -z "$previous" ] || ln -sfn "$previous" /opt/pricedip/previous
  systemctl start pricedip-backup.service
  exit 0
 fi
 sleep 2
done
if [ -n "$previous" ]; then ln -sfn "$previous" /opt/pricedip/current; systemctl restart pricedip pricedip-worker; fi
exit 1
