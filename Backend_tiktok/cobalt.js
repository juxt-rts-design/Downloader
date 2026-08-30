const axios = require('axios');

const COBALT_URL = (process.env.COBALT_URL || 'http://127.0.0.1:9000').replace(/\/$/, '');

const ERROR_MESSAGES = {
  'error.api.fetch.fail': 'Impossible de joindre la plateforme. Réessaie dans un instant.',
  'error.api.fetch.empty': 'La plateforme n’a rien renvoyé. Le lien est peut-être privé ou expiré.',
  'error.api.fetch.critical': 'Erreur réseau vers la plateforme (DNS / VPN).',
  'error.api.link.invalid': 'Lien invalide.',
  'error.api.link.unsupported': 'Cette plateforme n’est pas encore prise en charge.',
  'error.api.content.video.unavailable': 'Média indisponible ou supprimé.',
  'error.api.content.video.live': 'Les lives ne sont pas téléchargeables.',
  'error.api.content.video.age': 'Contenu soumis à une restriction d’âge.',
  'error.api.content.too_long': 'Vidéo trop longue pour cette instance.',
  'error.api.content.post.unavailable': 'Publication introuvable.',
  'error.api.youtube.login': 'YouTube demande une authentification côté instance.',
  'error.api.youtube.video.region': 'Vidéo bloquée dans cette région.',
  'error.api.youtube.video.unavailable': 'Vidéo YouTube indisponible.',
};

function sanitizeMediaUrl(raw) {
  const text = String(raw || '').trim();
  const parts = text.split(/(?=https?:\/\/)/i).filter(Boolean);
  if (parts.length > 1 && /^https?:\/\//i.test(parts[0])) {
    return parts[0].trim();
  }
  return text;
}

function detectPlatform(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
    const table = [
      [['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'], 'youtube'],
      [['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'], 'tiktok'],
      [['instagram.com'], 'instagram'],
      [['twitter.com', 'x.com'], 'twitter'],
      [['facebook.com', 'fb.watch', 'fb.com'], 'facebook'],
      [['reddit.com', 'redd.it'], 'reddit'],
      [['vimeo.com'], 'vimeo'],
      [['soundcloud.com'], 'soundcloud'],
      [['pinterest.com', 'pin.it'], 'pinterest'],
      [['snapchat.com'], 'snapchat'],
      [['tumblr.com'], 'tumblr'],
      [['twitch.tv'], 'twitch'],
      [['bilibili.com', 'bilibili.tv'], 'bilibili'],
      [['dailymotion.com', 'dai.ly'], 'dailymotion'],
      [['vk.com', 'vk.ru'], 'vk'],
      [['ok.ru'], 'ok'],
      [['rutube.ru'], 'rutube'],
      [['streamable.com'], 'streamable'],
      [['bsky.app'], 'bluesky'],
      [['loom.com'], 'loom'],
      [['newgrounds.com'], 'newgrounds'],
    ];
    for (const [hosts, name] of table) {
      if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return name;
    }
    return host.split('.')[0] || 'web';
  } catch {
    return 'web';
  }
}

function mapCobaltError(payload) {
  const code = payload?.error?.code || 'error.unknown';
  return ERROR_MESSAGES[code] || `Cobalt : ${code}`;
}

function rewriteMediaUrl(mediaUrl, publicBase) {
  if (!mediaUrl) return null;
  return `${publicBase}/api/cobalt/proxy?u=${encodeURIComponent(mediaUrl)}`;
}

function isLocalCobaltUrl(raw) {
  try {
    const parsed = new URL(raw);
    const hostOk = ['127.0.0.1', 'localhost', 'cobalt'].includes(parsed.hostname);
    const portOk = parsed.port === '9000' || parsed.port === '';
    return hostOk && portOk && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

async function getInstanceInfo() {
  const { data } = await axios.get(`${COBALT_URL}/`, {
    timeout: 5000,
    headers: { Accept: 'application/json' },
  });
  return data;
}

async function processUrl(url, { audioOnly = false } = {}) {
  try {
    const { data } = await axios.post(
      `${COBALT_URL}/`,
      {
        url,
        alwaysProxy: true,
        videoQuality: '1080',
        downloadMode: audioOnly ? 'audio' : 'auto',
        audioFormat: 'mp3',
        filenameStyle: 'pretty',
      },
      {
        timeout: 45000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    return data;
  } catch (err) {
    if (err.response?.data) {
      return err.response.data;
    }
    throw err;
  }
}

function toVideoData(url, cobalt, publicBase, { audioOnly = false } = {}) {
  if (!cobalt || cobalt.status === 'error') {
    const err = new Error(mapCobaltError(cobalt));
    err.code = cobalt?.error?.code;
    throw err;
  }

  const platform = detectPlatform(url);
  const filename = cobalt.filename || cobalt.output?.filename || (audioOnly ? 'audio.mp3' : 'media.mp4');
  const title = filename.replace(/\.[^.]+$/, '') || 'Média';
  // YouTube : le tunnel Cobalt ressort souvent à 0 octet (blocage Docker).
  // On sert le fichier via yt-dlp sur la machine hôte.
  const downloadUrl =
    platform === 'youtube'
      ? `${publicBase}/api/youtube/file?url=${encodeURIComponent(url)}&audio=${audioOnly ? '1' : '0'}`
      : rewriteMediaUrl(cobalt.url || cobalt.tunnel?.[0], publicBase);
  const picker = Array.isArray(cobalt.picker)
    ? cobalt.picker.map((item) => ({
        type: item.type,
        url: rewriteMediaUrl(item.url, publicBase),
        thumb: rewriteMediaUrl(item.thumb, publicBase) || item.thumb || null,
      }))
    : [];
  const audioUrl = rewriteMediaUrl(cobalt.audio, publicBase);

  return {
    success: true,
    data: {
      id: `cobalt-${Date.now()}`,
      title,
      type: audioOnly ? 'audio' : picker.length ? 'picker' : 'video',
      platform,
      source: 'cobalt',
      filename,
      author: {
        username: platform,
        nickname: platform,
        avatar: null,
      },
      video: {
        url: downloadUrl || picker[0]?.url || '',
        duration: 0,
        size: 0,
        quality: audioOnly ? 'MP3' : 'HD',
      },
      thumbnail: picker[0]?.thumb || null,
      stats: { likes: 0, shares: 0, comments: 0, views: 0 },
      downloadUrl: downloadUrl || picker[0]?.url || '',
      audioUrl,
      picker,
      canExtractAudio: !audioOnly,
      cobaltStatus: cobalt.status,
    },
  };
}

async function downloadViaCobalt(url, { audioOnly = false, publicBase }) {
  const cobalt = await processUrl(url, { audioOnly });
  return toVideoData(url, cobalt, publicBase, { audioOnly });
}

function extractTweetId(url) {
  const match = String(url).match(/(?:status|statuses)\/(\d+)/i);
  return match ? match[1] : null;
}

function rewriteTwimgUrl(mediaUrl, publicBase) {
  if (!mediaUrl) return null;
  return `${publicBase}/api/media/proxy?u=${encodeURIComponent(mediaUrl)}`;
}

function isAllowedTwitterMediaUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'video.twimg.com' ||
      host === 'pbs.twimg.com' ||
      host.endsWith('.twimg.com') ||
      host === 'i.pinimg.com' ||
      host === 'v1.pinimg.com' ||
      host.endsWith('.pinimg.com') ||
      host === 'i.redd.it' ||
      host === 'v.redd.it' ||
      host === 'preview.redd.it' ||
      host.endsWith('.redd.it')
    );
  } catch {
    return false;
  }
}

async function downloadViaTwitterFallback(url, { audioOnly = false, publicBase } = {}) {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    throw new Error('Lien X / Twitter invalide');
  }

  const { data } = await axios.get(`https://api.fxtwitter.com/status/${tweetId}`, {
    timeout: 15000,
    headers: { Accept: 'application/json' },
  });

  const tweet = data?.tweet;
  if (!tweet) {
    throw new Error('Post X introuvable');
  }

  const videos = tweet.media?.videos || [];
  const photos = tweet.media?.photos || tweet.media?.images || [];
  const video = videos[0];
  let mediaUrl = video?.url || null;

  if (Array.isArray(video?.variants) && video.variants.length) {
    const mp4s = video.variants
      .filter((item) => (item.content_type || '').includes('mp4') || String(item.url || '').includes('.mp4'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (mp4s[0]?.url) mediaUrl = mp4s[0].url;
  }

  const picker = photos.map((photo) => ({
    type: 'photo',
    url: rewriteTwimgUrl(photo.url || photo, publicBase),
    thumb: rewriteTwimgUrl(photo.url || photo, publicBase),
  }));

  if (audioOnly && !mediaUrl) {
    throw new Error('Pas d’audio sur ce post X');
  }
  if (!mediaUrl && !picker.length) {
    throw new Error('Aucun média dans ce post X');
  }

  const author = tweet.author?.screen_name || 'twitter';
  const title = (tweet.text || `Post X de @${author}`).slice(0, 120);
  const downloadUrl = rewriteTwimgUrl(mediaUrl, publicBase) || picker[0]?.url;

  return {
    success: true,
    data: {
      id: `twitter-${tweetId}`,
      title,
      type: picker.length && !mediaUrl ? 'picker' : audioOnly ? 'audio' : 'video',
      platform: 'twitter',
      source: 'cobalt',
      filename: `x-${tweetId}.mp4`,
      author: {
        username: author,
        nickname: tweet.author?.name || author,
        avatar: tweet.author?.avatar_url || null,
      },
      video: {
        url: downloadUrl || '',
        duration: video?.duration || 0,
        size: 0,
        quality: 'HD',
      },
      thumbnail: video?.thumbnail_url || picker[0]?.thumb || null,
      stats: {
        likes: tweet.likes || 0,
        shares: tweet.retweets || 0,
        comments: tweet.replies || 0,
        views: tweet.views || 0,
      },
      downloadUrl: downloadUrl || '',
      audioUrl: null,
      picker,
      canExtractAudio: Boolean(mediaUrl) && !audioOnly,
      cobaltStatus: 'twitter-fallback',
    },
  };
}

function rewritePinUrl(mediaUrl, publicBase) {
  if (!mediaUrl) return null;
  return `${publicBase}/api/media/proxy?u=${encodeURIComponent(mediaUrl)}`;
}

function upgradePinimg(url) {
  if (!url) return url;
  return url.replace(/\/\d+x\//, '/originals/');
}

async function resolvePinterestPinId(url) {
  const direct = String(url).match(/\/pin\/(\d+)/);
  if (direct) return direct[1];

  const res = await axios.get(url, {
    maxRedirects: 8,
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/json',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const finalUrl = res.request?.res?.responseUrl || res.headers.location || url;
  const match = String(finalUrl).match(/\/pin\/(\d+)/);
  if (match) return match[1];
  const bodyMatch = String(res.data || '').match(/\/pin\/(\d+)/);
  return bodyMatch ? bodyMatch[1] : null;
}

async function downloadViaPinterestFallback(url, { audioOnly = false, publicBase } = {}) {
  const pinId = await resolvePinterestPinId(url);
  if (!pinId) {
    throw new Error('Lien Pinterest invalide');
  }

  const ua = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  let title = `Pin ${pinId}`;
  let author = 'pinterest';
  let thumbnail = null;
  let mediaUrl = null;
  let isPhoto = false;

  try {
    const { data: embed } = await axios.get('https://www.pinterest.com/oembed.json', {
      params: { url: `https://www.pinterest.com/pin/${pinId}/` },
      timeout: 12000,
      headers: { Accept: 'application/json', ...ua },
    });
    title = (embed.title || title).slice(0, 140);
    author = embed.author_name || author;
    thumbnail = embed.thumbnail_url || null;
    if (embed.thumbnail_url) {
      mediaUrl = upgradePinimg(embed.thumbnail_url);
      isPhoto = true;
    }
  } catch {
    // oembed optionnel
  }

  try {
    const { data: html } = await axios.get(`https://www.pinterest.com/pin/${pinId}/`, {
      timeout: 15000,
      headers: { Accept: 'text/html', ...ua },
    });
    const text = String(html);
    const videos = [
      ...text.matchAll(/https:\\\/\\\/v1\.pinimg\.com\\\/videos\\\/[^"\\]+/g),
      ...text.matchAll(/https:\/\/v1\.pinimg\.com\/videos\/[^"\\\s]+/g),
    ].map((m) => m[0].replace(/\\\//g, '/'));
    const mp4 = videos.find((v) => v.includes('.mp4'));
    if (mp4) {
      mediaUrl = mp4;
      isPhoto = false;
    } else if (!mediaUrl) {
      const originals = [...text.matchAll(/https:\/\/i\.pinimg\.com\/originals\/[a-z0-9/_.-]+\.(?:jpg|jpeg|png|gif|webp)/gi)].map(
        (m) => m[0]
      );
      if (originals[0]) {
        mediaUrl = originals[0];
        isPhoto = true;
      }
    }
  } catch {
    // scrape optionnel si oembed a déjà une image
  }

  if (audioOnly && isPhoto) {
    throw new Error('Ce pin Pinterest n’a pas d’audio');
  }
  if (!mediaUrl) {
    throw new Error('Aucun média trouvé sur ce pin');
  }

  const proxied = rewritePinUrl(mediaUrl, publicBase);
  const thumb = rewritePinUrl(thumbnail && !isPhoto ? thumbnail : mediaUrl, publicBase);

  return {
    success: true,
    data: {
      id: `pinterest-${pinId}`,
      title,
      type: isPhoto ? 'image' : 'video',
      platform: 'pinterest',
      source: 'cobalt',
      filename: `pinterest-${pinId}.${isPhoto ? 'jpg' : 'mp4'}`,
      author: {
        username: author,
        nickname: author,
        avatar: null,
      },
      video: {
        url: proxied,
        duration: 0,
        size: 0,
        quality: isPhoto ? 'Image' : 'HD',
      },
      thumbnail: thumb,
      stats: { likes: 0, shares: 0, comments: 0, views: 0 },
      downloadUrl: proxied,
      audioUrl: null,
      picker: [],
      canExtractAudio: !isPhoto && !audioOnly,
      cobaltStatus: 'pinterest-fallback',
    },
  };
}

module.exports = {
  COBALT_URL,
  detectPlatform,
  getInstanceInfo,
  downloadViaCobalt,
  downloadViaTwitterFallback,
  downloadViaPinterestFallback,
  sanitizeMediaUrl,
  isLocalCobaltUrl,
  isAllowedTwitterMediaUrl,
  mapCobaltError,
};
