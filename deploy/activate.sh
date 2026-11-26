#!/usr/bin/env bash
# Met en ligne https://planning.racines-perspectives.fr, une fois le DNS en place.
# Idempotent : ne fait rien si c'est déjà actif. Lancé par cron toutes les
# 10 min tant que ce n'est pas fait (la ligne cron se retire toute seule).
set -euo pipefail

DOMAIN=planning.racines-perspectives.fr
SERVER_IP=145.239.65.108
PROXY=/home/ubuntu/reverse-proxy
CONF=$PROXY/config/nginx/planning.conf
SRC=$(dirname "$(readlink -f "$0")")/planning.conf

log() { echo "[$(date '+%F %T')] $*"; }
done_() { crontab -l 2>/dev/null | grep -v 'rp-planning/deploy/activate.sh' | crontab - || true; }

if [ -f "$CONF" ]; then log "déjà actif"; done_; exit 0; fi

ip=$(dig +short "$DOMAIN" A @1.1.1.1 | tail -1)
if [ "$ip" != "$SERVER_IP" ]; then log "DNS pas encore prêt ($DOMAIN -> '${ip:-rien}')"; exit 0; fi

cd "$PROXY"
if [ ! -f "data/letsencrypt/etc/live/$DOMAIN/fullchain.pem" ]; then
  log "obtention du certificat…"
  docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN" --agree-tos --non-interactive
fi

cp "$SRC" "$CONF"
if docker compose exec -T nginx nginx -t; then
  docker compose exec -T nginx nginx -s reload
  log "en ligne : https://$DOMAIN"
  done_
else
  rm -f "$CONF"
  log "nginx -t a échoué, conf retirée"
  exit 1
fi
