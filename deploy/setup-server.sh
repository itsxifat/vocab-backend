#!/bin/bash
# Run once on the server to set up vocab.enfinito.cloud
# Usage: sudo bash deploy/setup-server.sh
# Must be run from /var/www/vocab

set -e

DOMAIN="vocab.enfinito.cloud"
APP_DIR="/var/www/vocab"
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

# ── 1. Install nginx + certbot ────────────────────────────────────────────────
apt update && apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx

# ── 2. Install PM2 globally ───────────────────────────────────────────────────
npm install -g pm2

# ── 3. Install backend dependencies ──────────────────────────────────────────
cd "$APP_DIR"
npm ci --omit=dev

# ── 4. Build admin panel ──────────────────────────────────────────────────────
cd "$APP_DIR/admin"
npm ci
npm run build   # outputs to ../public

# ── 5. Place nginx config (HTTP only first so certbot can reach port 80) ──────
cat > "$NGINX_CONF" <<'NGINXEOF'
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
NGINXEOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 6. Obtain SSL certificate ─────────────────────────────────────────────────
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@enfinito.cloud

# ── 7. Replace with full HTTPS config ─────────────────────────────────────────
cp "$APP_DIR/deploy/nginx.conf" "$NGINX_CONF"
nginx -t && systemctl reload nginx

# ── 8. Start app with PM2 ─────────────────────────────────────────────────────
cd "$APP_DIR"
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash   # register PM2 to start on reboot

echo ""
echo "✓ Done. Verify with: curl https://$DOMAIN/health"
