const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const YTDLP_BIN = process.env.YTDLP_PATH || path.join(__dirname, 'bin', 'yt-dlp');

function extractYoutubeId(url) {
  const match = String(url).match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
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
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `yt-dlp exit ${code}`));
    });
  });
}

function sendFile(res, filePath, { filename, contentType }) {
  const stats = fs.statSync(filePath);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  fs.createReadStream(filePath).pipe(res);
}

async function downloadYouTubeFile(pageUrl, { audioOnly = false, cacheDir }) {
  const id = extractYoutubeId(pageUrl);
  if (!id) {
    throw new Error('ID YouTube introuvable');
  }
  if (!fs.existsSync(YTDLP_BIN)) {
    throw new Error('yt-dlp manquant (Backend_tiktok/bin/yt-dlp)');
  }

  const ext = audioOnly ? 'mp3' : 'mp4';
  const finalPath = path.join(cacheDir, `yt-${id}.${ext}`);
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 1024) {
    return { path: finalPath, filename: `youtube-${id}.${ext}`, contentType: audioOnly ? 'audio/mpeg' : 'video/mp4' };
  }

  const tmpOut = path.join(cacheDir, `yt-${id}-tmp.%(ext)s`);
  const args = [
    '--no-playlist',
    '--extractor-args',
    'youtube:player_client=android',
    '-o',
    tmpOut,
    pageUrl,
  ];

  if (audioOnly) {
    args.unshift('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3');
  } else {
    args.unshift('-f', '18/best[ext=mp4]/best');
  }

  await runYtDlp(args);

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

module.exports = {
  extractYoutubeId,
  downloadYouTubeFile,
  sendFile,
  YTDLP_BIN,
};
