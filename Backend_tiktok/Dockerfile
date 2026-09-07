FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 \
  && rm -rf /var/lib/apt/lists/*

# Bust cache : rebuild = yt-dlp toujours à jour
ARG YTDLP_REFRESH=1
RUN curl -fsSL -o /usr/local/bin/yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && yt-dlp --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3001
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV COBALT_URL=http://cobalt:9000

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
