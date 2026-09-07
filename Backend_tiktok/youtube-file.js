const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const YTDLP_BIN = process.env.YTDLP_PATH || path.join(__dirname, 'bin', 'yt-dlp');
// android/ios = formats progressifs (18) ; web = souvent SABR inutilisable
const YT_CLIENTS = String(
  process.env.YTDLP_CLIENTS || 'android,ios,tv_embedded,tv,web,mweb,web_embedded'
)
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);
const COOKIES_FILE = process.env.YTDLP_COOKIES || process.env.YOUTUBE_COOKIES || '';
const FORMAT_TRIES = [
  '18',
  '22',
  '17',
  'best[height<=360][ext=mp4]/best[ext=mp4]/best',
  'bv*[height<=720]+ba/b',
  'best',
];

function resolveWritableCookies(cacheDir) {
  if (!COOKIES_FILE || !fs.existsSync(COOKIES_FILE)) return null;
  const destDir = cacheDir || path.join(os.tmpdir(), 'hexaro-yt');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'youtube-cookies.txt');
  try {
    fs.copyFileSync(COOKIES_FILE, dest);
    try {
      fs.chmodSync(dest, 0o600);
    } catch {
      // ignore
    }
  } catch (err) {
    console.warn(`⚠️ Copie cookies: ${err.message}`);
    return COOKIES_FILE;
  }
  return dest;
}

let cachedCookiesPath = null;

function getCookiesPath(cacheDir) {
  if (cachedCookiesPath && fs.existsSync(cachedCookiesPath)) return cachedCookiesPath;
  cachedCookiesPath = resolveWritableCookies(cacheDir);
  if (cachedCookiesPath) {
    console.log(`🍪 Cookies YouTube: ${cachedCookiesPath}`);
  }
  return cachedCookiesPath;
}

function extractYoutubeId(url) {
  const match = String(url).match(/(?:youtu\.be\/|v=|shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function normalizeYoutubeUrl(url) {
  const id = extractYoutubeId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

function isBotError(msg) {
  return /not a bot|Sign in to confirm|login required/i.test(String(msg || ''));
}

function isFormatError(msg) {
  return /format is not available|Requested format/i.test(String(msg || ''));
}

function runYtDlp(args, { timeoutMs = 5 * 60 * 1000, captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(YTDLP_BIN)) {
      reject(new Error(`yt-dlp manquant (${YTDLP_BIN})`));
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
    }, timeoutMs);
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
      const last = stderr.trim().split('\n').slice(-4).join(' ');
      reject(new Error(last || `yt-dlp exit ${code}`));
    });
  });
}

function baseArgs(client, cacheDir, { useCookies = true } = {}) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--js-runtimes',
    'node',
    '--extractor-args',
    `youtube:player_client=${client}`,
  ];
  if (useCookies) {
    const cookies = getCookiesPath(cacheDir);
    if (cookies) {
      args.push('--cookies', cookies);
    }
  }
  return args;
}

async function withClients(buildArgs, { timeoutMs, captureStdout = false, cacheDir } = {}) {
  let lastError = null;
  const hasCookies = Boolean(getCookiesPath(cacheDir));
  const modes = hasCookies ? [true, false] : [false];

  for (const useCookies of modes) {
    for (const client of YT_CLIENTS) {
      try {
        const out = await runYtDlp(buildArgs(client, useCookies), { timeoutMs, captureStdout });
        return { out, client, useCookies };
      } catch (err) {
        lastError = err;
        console.warn(
          `⚠️ yt-dlp probe client=${client} cookies=${useCookies ? 'yes' : 'no'}: ${err.message}`
        );
        if (!useCookies && isBotError(err.message) && hasCookies) {
          break;
        }
      }
    }
  }
  throw lastError || new Error('yt-dlp: tous les clients YouTube ont échoué');
}

function sendFile(res, filePath, { filename, contentType }) {
  const stats = fs.statSync(filePath);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  fs.createReadStream(filePath).pipe(res);
}

async function probeYouTube(pageUrl, { cacheDir } = {}) {
  const target = normalizeYoutubeUrl(pageUrl);
  const { out, client } = await withClients(
    (c, useCookies) => [
      ...baseArgs(c, cacheDir, { useCookies }),
      '--ignore-no-formats-error',
      '--no-check-formats',
      '-j',
      '--skip-download',
      target,
    ],
    { timeoutMs: 60000, captureStdout: true, cacheDir }
  );
  const line = out
    .trim()
    .split('\n')
    .reverse()
    .find((row) => row.startsWith('{'));
  if (!line) {
    throw new Error('yt-dlp n’a renvoyé aucune métadonnée');
  }
  return { info: JSON.parse(line), client };
}

async function listVideoFormatIds(client, cacheDir, useCookies, target) {
  try {
    const out = await runYtDlp(
      [...baseArgs(client, cacheDir, { useCookies }), '-F', '--skip-download', target],
      { timeoutMs: 45000, captureStdout: true }
    );
    const ids = [];
    for (const line of out.split('\n')) {
      const match = line.match(/^(\d+)\s+(\w+)\s+(\d+x\d+|audio only)/);
      if (!match) continue;
      const [, formatId, ext] = match;
      if (ext === 'mhtml') continue;
      ids.push(formatId);
    }
    if (ids.length) {
      console.log(`📋 formats client=${client} cookies=${useCookies ? 'yes' : 'no'}: ${ids.slice(0, 8).join(',')}`);
    }
    return ids;
  } catch (err) {
    console.warn(`⚠️ -F client=${client} cookies=${useCookies ? 'yes' : 'no'}: ${err.message}`);
    return [];
  }
}

async function tryDownloadOnce({ client, useCookies, format, audioOnly, cacheDir, target, tmpOut }) {
  const args = [...baseArgs(client, cacheDir, { useCookies }), '-f', format, '-o', tmpOut, target];
  if (audioOnly) {
    args.push('-x', '--audio-format', 'mp3');
  } else if (!/^\d+$/.test(format)) {
    args.push('--merge-output-format', 'mp4');
  }
  console.log(`⬇️ yt-dlp client=${client} cookies=${useCookies ? 'yes' : 'no'} format=${format}`);
  await runYtDlp(args);
}

async function downloadYouTubeFile(pageUrl, { audioOnly = false, cacheDir }) {
  const id = extractYoutubeId(pageUrl);
  if (!id) {
    throw new Error('ID YouTube introuvable');
  }
  if (!fs.existsSync(YTDLP_BIN)) {
    throw new Error(`yt-dlp manquant (${YTDLP_BIN})`);
  }

  const target = normalizeYoutubeUrl(pageUrl);
  const ext = audioOnly ? 'mp3' : 'mp4';
  const finalPath = path.join(cacheDir, `yt-${id}.${ext}`);
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1024) {
    return { path: finalPath, filename: `youtube-${id}.${ext}`, contentType: audioOnly ? 'audio/mpeg' : 'video/mp4' };
  }

  const tmpOut = path.join(cacheDir, `yt-${id}-tmp.%(ext)s`);
  let lastError = null;
  const hasCookies = Boolean(getCookiesPath(cacheDir));
  // Sur VPS : cookies d’abord (sans cookies = anti-bot).
  const cookieModes = hasCookies ? [true, false] : [false];

  for (const useCookies of cookieModes) {
    let botOnThisMode = false;

    for (const client of YT_CLIENTS) {
      // Tentative prioritaire : android/ios + 18
      if (!audioOnly && (client === 'android' || client === 'ios')) {
        try {
          await tryDownloadOnce({
            client,
            useCookies,
            format: '18',
            audioOnly,
            cacheDir,
            target,
            tmpOut,
          });
          lastError = null;
          botOnThisMode = false;
          break;
        } catch (err) {
          lastError = err;
          console.warn(`⚠️ prioritaire ${client}/18: ${err.message}`);
          if (isBotError(err.message)) {
            botOnThisMode = true;
            if (!useCookies && hasCookies) break;
            continue;
          }
        }
      }

      const listed = audioOnly ? [] : await listVideoFormatIds(client, cacheDir, useCookies, target);
      if (!listed.length && !audioOnly && isBotError(lastError?.message)) {
        continue;
      }

      const formatList = audioOnly
        ? ['bestaudio/best', 'best']
        : [...listed.slice(0, 8), ...FORMAT_TRIES];
      const uniqueFormats = [...new Set(formatList)];

      for (const format of uniqueFormats) {
        if (!audioOnly && client === 'android' && format === '18') continue; // déjà tenté
        try {
          await tryDownloadOnce({
            client,
            useCookies,
            format,
            audioOnly,
            cacheDir,
            target,
            tmpOut,
          });
          lastError = null;
          botOnThisMode = false;
          break;
        } catch (err) {
          lastError = err;
          console.warn(
            `⚠️ yt-dlp client=${client} cookies=${useCookies ? 'yes' : 'no'} format=${format}: ${err.message}`
          );
          if (isBotError(err.message)) {
            botOnThisMode = true;
            break; // inutile de tester tous les formats si bot
          }
          if (isFormatError(err.message) && listed.length === 0) {
            break; // pas de formats sur ce client
          }
        }
      }
      if (!lastError) break;
      if (botOnThisMode && !useCookies && hasCookies) break;
    }
    if (!lastError) break;
  }

  if (lastError) {
    if (isBotError(lastError.message)) {
      throw new Error(
        'YouTube anti-bot sur cette IP. Réexporte des cookies frais (compte connecté) vers Backend_tiktok/cookies/youtube.txt'
      );
    }
    throw lastError;
  }

  const produced = fs.readdirSync(cacheDir).find((name) => name.startsWith(`yt-${id}-tmp.`));
  if (!produced) {
    throw new Error('yt-dlp n’a pas produit de fichier');
  }
  const producedPath = path.join(cacheDir, produced);
  if (fs.statSync(producedPath).size < 1024) {
    fs.unlinkSync(producedPath);
    throw new Error('Fichier YouTube vide');
  }
  fs.renameSync(producedPath, finalPath);

  return {
    path: finalPath,
    filename: `youtube-${id}.${ext}`,
    contentType: audioOnly ? 'audio/mpeg' : 'video/mp4',
  };
}

async function downloadViaYoutubeFallback(url, { audioOnly = false, publicBase, cacheDir } = {}) {
  const id = extractYoutubeId(url);
  if (!id) {
    throw new Error('Lien YouTube invalide');
  }
  const { info, client } = await probeYouTube(url, { cacheDir });
  const title = String(info.title || info.fulltitle || `YouTube ${id}`).slice(0, 160);
  const author = info.uploader || info.channel || info.uploader_id || 'youtube';
  const thumb =
    info.thumbnail ||
    (Array.isArray(info.thumbnails) ? info.thumbnails[info.thumbnails.length - 1]?.url : null) ||
    `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
  const downloadUrl = `${publicBase}/api/youtube/file?url=${encodeURIComponent(
    normalizeYoutubeUrl(url)
  )}&audio=${audioOnly ? '1' : '0'}`;

  return {
    success: true,
    data: {
      id: `youtube-${id}`,
      title,
      type: audioOnly ? 'audio' : 'video',
      platform: 'youtube',
      source: 'cobalt',
      filename: `youtube-${id}.${audioOnly ? 'mp3' : 'mp4'}`,
      author: {
        username: author,
        nickname: author,
        avatar: null,
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
      previewUrl: null,
      audioUrl: null,
      picker: [],
      canExtractAudio: !audioOnly,
      cobaltStatus: `youtube-fallback:${client}`,
    },
  };
}

module.exports = {
  extractYoutubeId,
  normalizeYoutubeUrl,
  downloadYouTubeFile,
  downloadViaYoutubeFallback,
  probeYouTube,
  sendFile,
  YTDLP_BIN,
};
