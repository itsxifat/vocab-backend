#!/bin/bash
# Run this once on a fresh Ubuntu/Debian VPS to set up vocab.enfinito.cloud
# Usage: sudo bash setup-server.sh

set -e

DOMAIN="vocab.enfinito.cloud"
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

# ── 1. Install dependencies ───────────────────────────────────────────────────
apt update && apt install -y nginx certbot python3-certbot-nginx

# Docker — skip if already installed (conflicts with containerd on some hosts)
if ! command -v docker &>/dev/null; then
  apt install -y docker.io docker-compose-plugin
fi

systemctl enable --now nginx docker

# ── 2. Place nginx config (HTTP only first — certbot needs port 80 reachable) ─
cat > "$NGINX_CONF" <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name vocab.enfinito.cloud;

    location / {
        proxy_pass         http://127.0.0.1:3008;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        proxy_read_timeout 86400s;
        client_max_body_size 10G;
    }
}
EOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# ── 3. Obtain SSL certificate ─────────────────────────────────────────────────
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@enfinito.cloud

# ── 4. Replace with full HTTPS config ─────────────────────────────────────────
cp "$(dirname "$0")/nginx.conf" "$NGINX_CONF"
nginx -t && systemctl reload nginx

# ── 5. Auto-renew cron (certbot installs this automatically, but verify) ──────
systemctl enable --now certbot.timer 2>/dev/null || true
# Manual fallback if timer not available:
# (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -

echo ""
echo "✓ Nginx + SSL configured for $DOMAIN"
echo ""
echo "Next: start the app stack"
echo "  cd /path/to/backend/deploy"
echo "  docker compose up -d --build"
echo ""
echo "Then verify:"
echo "  curl https://$DOMAIN/health"
