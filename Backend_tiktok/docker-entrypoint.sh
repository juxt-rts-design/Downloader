#!/bin/sh
set -e
echo "🔄 Mise à jour yt-dlp…"
if curl -fsSL -o /usr/local/bin/yt-dlp.new \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp; then
  chmod +x /usr/local/bin/yt-dlp.new
  mv /usr/local/bin/yt-dlp.new /usr/local/bin/yt-dlp
fi
yt-dlp --version || true
exec node index.js
