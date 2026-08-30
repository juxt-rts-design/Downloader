#!/usr/bin/env bash
# HEXARO / Downloader — install VPS (Ubuntu)
# Site : https://hexaro.92-222-80-91.sslip.io
# Ne touche pas juxt-cine / juxt-senpai (ports 80 / 8080 déjà pris).
set -euo pipefail

REPO_URL="https://github.com/juxt-rts-design/Downloader.git"
APP_DIR="${HOME}/Downloader"
SITE_NAME="hexaro"
SSLip_HOST="hexaro.92-222-80-91.sslip.io"
DOCKER_PORT="3002"

need_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

echo "==> Pare-feu"
need_sudo ufw allow 80
need_sudo ufw allow 443
need_sudo ufw allow 8080

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  need_sudo apt-get update
  need_sudo apt-get install -y ca-certificates curl git
  curl -fsSL https://get.docker.com | need_sudo sh
  if [ "${SUDO_USER:-}" != "" ]; then
    need_sudo usermod -aG docker "$SUDO_USER" || true
  elif [ "$(id -u)" -ne 0 ]; then
    need_sudo usermod -aG docker "$USER" || true
  fi
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
fi

echo "==> Dépôt ${APP_DIR}"
if [ ! -d "${APP_DIR}/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only || true
fi
cd "$APP_DIR"

cat > .env <<EOF
PUBLIC_BIND=127.0.0.1
PUBLIC_PORT=${DOCKER_PORT}
ALLOWED_ORIGINS=*
EOF

echo "==> Lancement Cobalt + backend + frontend"
"${DOCKER[@]}" compose up -d --build

echo "==> Nginx Hexaro (sans écraser cine / senpai)"
need_sudo apt-get update
need_sudo apt-get install -y nginx certbot python3-certbot-nginx

need_sudo tee "/etc/nginx/sites-available/${SITE_NAME}" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SSLip_HOST};

    gzip on;
    gzip_vary on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:${DOCKER_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

need_sudo ln -sfn "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"
need_sudo nginx -t
need_sudo systemctl reload nginx

echo "==> HTTPS sslip.io"
need_sudo certbot --nginx --agree-tos --register-unsafely-without-email -d "$SSLip_HOST" || true
need_sudo nginx -t
need_sudo systemctl reload nginx

echo
echo "HEXARO : https://${SSLip_HOST}"
echo "Dossier : ${APP_DIR}"
echo "Logs    : cd ${APP_DIR} && docker compose logs -f"
echo "Stop    : cd ${APP_DIR} && docker compose down"
