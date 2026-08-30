#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cmd="${1:-up}"

start_prod() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker est requis. Installe-le puis relance ./start.sh"
    exit 1
  fi
  if [ ! -f .env ]; then
    cp .env.example .env
  fi
  echo "Lancement de Juxt_RTS (Cobalt + backend + frontend)…"
  docker compose up -d --build
  port="$(grep -E '^PUBLIC_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
  port="${port:-80}"
  echo
  echo "Prêt : http://localhost:${port}"
  echo "Logs : ./start.sh logs   |   Stop : ./start.sh stop"
}

start_dev() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker est requis pour Cobalt."
    exit 1
  fi
  echo "Cobalt (Docker)…"
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d cobalt
  if [ ! -d Backend_tiktok/node_modules ]; then
    (cd Backend_tiktok && npm install)
  fi
  if [ ! -d tik_tok/node_modules ]; then
    (cd tik_tok && npm install)
  fi
  echo "Backend :3001  |  Frontend :5173"
  (cd Backend_tiktok && npm run dev) &
  (cd tik_tok && npm run dev) &
  wait
}

case "$cmd" in
  up|start)
    start_prod
    ;;
  dev)
    start_dev
    ;;
  stop)
    docker compose down
    ;;
  logs)
    docker compose logs -f
    ;;
  *)
    echo "Usage: ./start.sh [up|dev|stop|logs]"
    exit 1
    ;;
esac
