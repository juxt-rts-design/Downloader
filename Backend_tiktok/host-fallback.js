const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { detectPlatform } = require('./cobalt');

const YTDLP_BIN = process.env.YTDLP_PATH || path.join(__dirname, 'bin', 'yt-dlp');

const HOST_FALLBACK_PLATFORMS = new Set([
  'reddit',
  'vimeo',
  'dailymotion',
  'snapchat',
  'tumblr',
  'twitch',
  'bilibili',
  'bluesky',
  'loom',
  'vk',
  'ok',
  'newgrounds',
  'rutube',
]);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function isHostFallbackPlatform(platform) {
  return HOST_FALLBACK_PLATFORMS.has(platform);
}

function cacheId(url, audioOnly) {
  return crypto.createHash('sha1').update(`${url}|${audioOnly ? '1' : '0'}`).digest('hex').slice(0, 16);
}

function extractVimeoId(url) {
  const text = String(url);
  const player = text.match(/player\.vimeo\.com\/video\/(\d+)/i);
  if (player) {
    const hash = text.match(/[?&]h=([a-z0-9]+)/i);
    return { id: player[1], hash: hash ? hash[1] : null };
  }
  const unlisted = text.match(/vimeo\.com\/(\d+)\/([a-f0-9]{6,})/i);
  if (unlisted) return { id: unlisted[1], hash: unlisted[2] };
  const simple = text.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/i);
  return simple ? { id: simple[1], hash: null } : null;
}

function extractRedditId(url) {
  const text = String(url);
  const comments = text.match(/\/comments\/([a-z0-9]+)/i);
  if (comments) return comments[1];
  const short = text.match(/(?:redd\.it|v\.redd\.it)\/([a-z0-9]+)/i);
  return short ? short[1] : null;
}

function normalizeHostUrl(url) {
  const platform = detectPlatform(url);
  if (platform === 'vimeo') {
    const parsed = extractVimeoId(url);
    if (parsed?.id) {
      return parsed.hash
        ? `https://player.vimeo.com/video/${parsed.id}?h=${parsed.hash}`
        : `https://player.vimeo.com/video/${parsed.id}`;
    }
  }
  return url;
}

function runYtDlp(args, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(YTDLP_BIN)) {
      reject(new Error('yt-dlp manquant (Backend_tiktok/bin/yt-dlp)'));
      return;
    }
    const child = spawn(YTDLP_BIN, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      if (captureStdout) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('yt-dlp timeout'));
    }, 5 * 60 * 1000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const last = stderr.trim().split('\n').slice(-3).join(' ');
      reject(new Error(last || `yt-dlp exit ${code}`));
    });
  });
}

function toResult(url, info, { audioOnly, publicBase, platform, status }) {
  const id = info.id || cacheId(url, audioOnly);
  const title = String(info.title || info.fulltitle || platform).slice(0, 160);
  const author = info.uploader || info.channel || info.uploader_id || platform;
  const downloadUrl = `${publicBase}/api/host/file?url=${encodeURIComponent(url)}&audio=${audioOnly ? '1' : '0'}`;
  const thumb = info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || null;

  return {
    success: true,
    data: {
      id: `${platform}-${id}`,
      title,
      type: audioOnly ? 'audio' : 'video',
      platform,
      source: 'cobalt',
      filename: `${platform}-${id}.${audioOnly ? 'mp3' : 'mp4'}`,
      author: {
        username: author,
        nickname: author,
        avatar: info.uploader_url || null,
      },
      video: {
        url: downloadUrl,
        duration: Number(info.duration) || 0,
        size: 0,
        quality: audioOnly ? 'MP3' : info.resolution || 'HD',
      },
      thumbnail: thumb,
      stats: {
        likes: info.like_count || 0,
        shares: 0,
        comments: info.comment_count || 0,
        views: info.view_count || 0,
      },
      downloadUrl,
      audioUrl: null,
      picker: [],
      canExtractAudio: !audioOnly,
      cobaltStatus: status,
    },
  };
}

async function probeYtDlp(url) {
  const stdout = await runYtDlp(
    ['-j', '--no-playlist', '--skip-download', '--no-warnings', '--no-check-certificates', url],
    { captureStdout: true }
  );
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((row) => row.startsWith('{'));
  if (!line) {
    throw new Error('yt-dlp n’a renvoyé aucune métadonnée');
  }
  return JSON.parse(line);
}

async function downloadViaYtDlp(url, { audioOnly = false, publicBase, platform } = {}) {
  const target = normalizeHostUrl(url);
  const info = await probeYtDlp(target);
  return toResult(url, info, {
    audioOnly,
    publicBase,
    platform: platform || detectPlatform(url),
    status: 'host-fallback',
  });
}

async function downloadHostFile(pageUrl, { audioOnly = false, cacheDir }) {
  const platform = detectPlatform(pageUrl);
  if (!isHostFallbackPlatform(platform)) {
    throw new Error('Plateforme hors fallback hôte');
  }
  const target = normalizeHostUrl(pageUrl);
  const id = cacheId(target, audioOnly);
  const ext = audioOnly ? 'mp3' : 'mp4';
  const finalPath = path.join(cacheDir, `host-${id}.${ext}`);
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1024) {
    return {
      path: finalPath,
      filename: `${platform}-${id}.${ext}`,
      contentType: audioOnly ? 'audio/mpeg' : 'video/mp4',
    };
  }

  const tmpOut = path.join(cacheDir, `host-${id}-tmp.%(ext)s`);
  const args = ['--no-playlist', '--no-warnings', '--no-check-certificates', '-o', tmpOut, target];
  if (audioOnly) {
    args.unshift('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3');
  } else {
    args.unshift('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  }

  await runYtDlp(args);

  const produced = fs.readdirSync(cacheDir).find((name) => name.startsWith(`host-${id}-tmp.`));
  if (!produced) {
    throw new Error('yt-dlp n’a pas produit de fichier');
  }
  const producedPath = path.join(cacheDir, produced);
  if (fs.statSync(producedPath).size < 1024) {
    fs.unlinkSync(producedPath);
    throw new Error('Fichier vide');
  }
  fs.renameSync(producedPath, finalPath);
  return {
    path: finalPath,
    filename: `${platform}-${id}.${ext}`,
    contentType: audioOnly ? 'audio/mpeg' : 'video/mp4',
  };
}

function rewriteMedia(url, publicBase) {
  if (!url) return null;
  return `${publicBase}/api/media/proxy?u=${encodeURIComponent(url)}`;
}

async function downloadViaRedditFallback(url, { audioOnly = false, publicBase } = {}) {
  try {
    return await downloadViaYtDlp(url, { audioOnly, publicBase, platform: 'reddit' });
  } catch {
    // Reddit bloque souvent yt-dlp sans cookies : oembed / miroir.
  }

  const postId = extractRedditId(url);
  if (!postId) {
    throw new Error('Lien Reddit invalide');
  }

  let title = `Reddit ${postId}`;
  let author = 'reddit';
  let thumbnail = null;
  let mediaUrl = null;
  let isPhoto = false;

  try {
    const { data: embed } = await axios.get('https://www.reddit.com/oembed', {
      params: { url },
      timeout: 12000,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    title = String(embed.title || title).slice(0, 160);
    author = embed.author_name || author;
    thumbnail = embed.thumbnail_url || null;
  } catch {
    // oembed optionnel
  }

  try {
    const { data } = await axios.get('https://api.pullpush.io/reddit/search/submission/', {
      params: { ids: postId },
      timeout: 12000,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    const post = data?.data?.[0];
    if (post) {
      title = String(post.title || title).slice(0, 160);
      author = post.author || author;
      thumbnail = post.thumbnail && String(post.thumbnail).startsWith('http') ? post.thumbnail : thumbnail;
      const redditVideo = post.media?.reddit_video || post.secure_media?.reddit_video;
      if (redditVideo?.fallback_url) {
        mediaUrl = redditVideo.fallback_url.split('?')[0];
      } else if (typeof post.url === 'string' && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(post.url)) {
        mediaUrl = post.url;
        isPhoto = true;
      } else if (typeof post.url === 'string' && /i\.redd\.it|preview\.redd\.it/.test(post.url)) {
        mediaUrl = post.url;
        isPhoto = true;
      }
    }
  } catch {
    // miroir optionnel
  }

  if (audioOnly && (isPhoto || !mediaUrl)) {
    throw new Error('Pas d’audio sur ce post Reddit');
  }
  if (!mediaUrl && thumbnail) {
    mediaUrl = thumbnail;
    isPhoto = true;
  }
  if (!mediaUrl) {
    throw new Error('Reddit exige une session (cookies). Réessaie plus tard ou ouvre le post public.');
  }

  const proxied = rewriteMedia(mediaUrl, publicBase);
  return {
    success: true,
    data: {
      id: `reddit-${postId}`,
      title,
      type: isPhoto ? 'image' : 'video',
      platform: 'reddit',
      source: 'cobalt',
      filename: `reddit-${postId}.${isPhoto ? 'jpg' : 'mp4'}`,
      author: { username: author, nickname: author, avatar: null },
      video: {
        url: proxied,
        duration: 0,
        size: 0,
        quality: isPhoto ? 'Image' : 'HD',
      },
      thumbnail: rewriteMedia(thumbnail || mediaUrl, publicBase),
      stats: { likes: 0, shares: 0, comments: 0, views: 0 },
      downloadUrl: proxied,
      audioUrl: null,
      picker: [],
      canExtractAudio: !isPhoto && !audioOnly,
      cobaltStatus: 'reddit-fallback',
    },
  };
}

async function downloadViaHostFallback(url, { audioOnly = false, publicBase } = {}) {
  const platform = detectPlatform(url);
  if (!isHostFallbackPlatform(platform)) {
    throw new Error('Pas de fallback hôte pour cette plateforme');
  }
  if (platform === 'reddit') {
    return downloadViaRedditFallback(url, { audioOnly, publicBase });
  }
  return downloadViaYtDlp(url, { audioOnly, publicBase, platform });
}

module.exports = {
  HOST_FALLBACK_PLATFORMS,
  isHostFallbackPlatform,
  downloadViaHostFallback,
  downloadHostFile,
  normalizeHostUrl,
};
