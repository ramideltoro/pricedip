#!/usr/bin/env bash
set -euo pipefail
revision=${1:?release revision required}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
exec 9>/run/lock/pricedip-deploy.lock
flock -w 300 9
release="/opt/pricedip/releases/$revision"
test -f "$release/dist-server/app.js"
previous=$(readlink -f /opt/pricedip/current || true)
restore_previous() {
  if [ -n "$previous" ]; then
    ln -sfn "$previous" /opt/pricedip/current.next
    mv -Tf /opt/pricedip/current.next /opt/pricedip/current
    systemctl restart pricedip pricedip-worker || true
  fi
}
if [ -n "$previous" ] && [ -f /var/lib/pricedip/pricedip.sqlite ]; then sudo -u pricedip DB_PATH=/var/lib/pricedip/pricedip.sqlite node "$previous/scripts/backup.mjs"; fi
install -m 644 "$release"/deploy/pricedip*.service /etc/systemd/system/
install -m 644 "$release"/deploy/pricedip*.timer /etc/systemd/system/
systemctl daemon-reload
ln -sfn "$release" /opt/pricedip/current.next
mv -Tf /opt/pricedip/current.next /opt/pricedip/current
trap restore_previous ERR
systemctl enable pricedip pricedip-worker pricedip-backup.timer
systemctl restart pricedip pricedip-worker
systemctl start pricedip-backup.timer
for attempt in $(seq 1 20); do
 if curl -fsS http://127.0.0.1:4350/healthz | node -e 'let x="";process.stdin.on("data",c=>x+=c).on("end",()=>{try{let h=JSON.parse(x);process.exit(h.ok&&h.release===process.argv[1]?0:1)}catch{process.exit(1)}})' "$revision" && systemctl is-active --quiet pricedip-worker; then
  [ -z "$previous" ] || ln -sfn "$previous" /opt/pricedip/previous
  systemctl start pricedip-backup.service
  sudo -u pricedip node "$release/scripts/release-event.mjs" deployment
  trap - ERR
  exit 0
 fi
 sleep 2
done
restore_previous
exit 1
