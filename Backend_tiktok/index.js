require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { PassThrough } = require('stream');
const { exec } = require('child_process');
const { promisify } = require('util');
const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('@distube/ytdl-core');
const {
  downloadViaCobalt,
  downloadViaTwitterFallback,
  downloadViaPinterestFallback,
  getInstanceInfo,
  processUrl,
  isLocalCobaltUrl,
  resolveCobaltTunnelUrl,
  isAllowedTwitterMediaUrl,
  sanitizeMediaUrl,
  detectPlatform,
  mapCobaltError,
  COBALT_URL,
} = require('./cobalt');
const { downloadYouTubeFile, downloadViaYoutubeFallback, sendFile } = require('./youtube-file');
const {
  isHostFallbackPlatform,
  downloadViaHostFallback,
  downloadHostFile,
} = require('./host-fallback');

function getLanIPv4() {
  const interfaces = os.networkInterfaces();
  const skipName = /^(lo|docker|br-|veth|proton|tun|tap|virbr|veth|ipv6leak)/i;
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs || skipName.test(name)) continue;
    for (const addr of addrs) {
      const family = addr.family === 'IPv4' || addr.family === 4;
      if (!family || addr.internal) continue;
      if (addr.address.startsWith('172.17.') || addr.address.startsWith('172.18.')) continue;
      if (addr.address.startsWith('10.2.')) continue;
      candidates.push(addr.address);
    }
  }

  return (
    candidates.find((ip) => ip.startsWith('192.168.')) ||
    candidates.find((ip) => ip.startsWith('10.')) ||
    candidates[0] ||
    'localhost'
  );
}

const LAN_IP = getLanIPv4();

const execAsync = promisify(exec);

// 🚀 CACHES POUR ACCÉLÉRATION ULTRA-RAPIDE
const urlCache = new Map(); // Cache des URLs courtes résolues
const metadataCache = new Map(); // Cache des métadonnées TikWM
const videoCache = new Map(); // Cache des URLs vidéo téléchargées

// Configuration optimisée pour la vitesse
const httpsAgent = new https.Agent({ 
  keepAlive: true, 
  maxSockets: 50,
  timeout: 10000
});

// Dossier de cache temporaire pour les vidéos
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Dossier temporaire pour FFmpeg
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Nettoyage du cache toutes les heures
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 heure
  
  for (const [key, value] of urlCache.entries()) {
    if (now - value.timestamp > maxAge) {
      urlCache.delete(key);
    }
  }
  
  for (const [key, value] of metadataCache.entries()) {
    if (now - value.timestamp > maxAge) {
      metadataCache.delete(key);
    }
  }
  
  // Nettoyer les fichiers vidéo anciens
  fs.readdir(CACHE_DIR, (err, files) => {
    if (!err) {
      files.forEach(file => {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });
}, 60 * 60 * 1000);

// Fonction pour utiliser TikWM API (priorité)
async function getTikTokVideoTikWM(url) {
  console.log('Tentative avec TikWM API pour:', url);
  
  try {
    const response = await axios.get(`https://tikwm.com/api?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log('TikWM - Status:', response.status);
    console.log('TikWM - Data:', response.data);
    
    if (response.data && response.data.code === 0 && response.data.data) {
      const data = response.data.data;
      
      // Détecter si c'est une image ou une vidéo
      const isImage = data.images && data.images.length > 0;
      const isVideo = data.play || data.wmplay;
      
      return {
        success: true,
        data: {
          id: data.id || Date.now().toString(),
          title: data.title || (isImage ? 'Image TikTok' : 'Vidéo TikTok'),
          type: isImage ? 'image' : 'video',
          author: {
            username: data.author?.unique_id || 'tiktok_user',
            nickname: data.author?.nickname || 'Utilisateur TikTok',
            avatar: data.author?.avatar || null
          },
          video: isVideo ? {
            url: data.play || data.wmplay,
            duration: data.duration || 0,
            size: data.size || 0,
            quality: 'HD'
          } : null,
          image: isImage ? {
            url: data.images[0] || data.cover,
            width: data.images?.[0]?.width || 0,
            height: data.images?.[0]?.height || 0,
            quality: 'HD'
          } : null,
          // Pour les images TikTok, on crée une vidéo avec image + son
          combinedVideo: isImage ? {
            imageUrl: data.images[0] || data.cover,
            audioUrl: data.music || null,
            duration: data.duration || 0
          } : null,
          thumbnail: data.cover || data.origin_cover || null,
          stats: {
            likes: data.digg_count || 0,
            shares: data.share_count || 0,
            comments: data.comment_count || 0,
            views: data.play_count || 0
          },
          // Pour les images TikTok, on utilise l'image comme vidéo (elle contient déjà le son)
          downloadUrl: isImage ? (data.images[0] || data.cover) : (data.play || data.wmplay),
          // Les images TikTok sont en fait des vidéos statiques avec son
          isStaticVideo: isImage,
          audioUrl: data.music || null
        }
      };
    }
    
    throw new Error(`TikWM erreur: ${response.data?.msg || 'Données invalides'}`);
    
  } catch (error) {
    console.error('TikWM - Erreur:', error.message);
    throw error;
  }
}

// Nouvelle fonction pour utiliser une API alternative
async function getTikTokVideoAlternative(url) {
  console.log('Tentative avec API alternative pour:', url);
  
  try {
    // Essayer une autre API TikTok qui fonctionne
    const response = await axios.get(`https://api.tiklydown.eu.org/api?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log('API Alternative - Status:', response.status);
    console.log('API Alternative - Data:', response.data);
    
    if (response.data && response.data.success && response.data.data) {
      const data = response.data.data;
      return {
        success: true,
        data: {
          id: data.id || Date.now().toString(),
          title: data.title || 'Vidéo TikTok',
          author: {
            username: data.author?.username || 'tiktok_user',
            nickname: data.author?.nickname || 'Utilisateur TikTok',
            avatar: data.author?.avatar || null
          },
          video: {
            url: data.video?.url || data.video,
            duration: data.duration || 0,
            size: data.size || 0,
            quality: 'HD'
          },
          thumbnail: data.thumbnail || null,
          stats: {
            likes: data.stats?.likes || 0,
            shares: data.stats?.shares || 0,
            comments: data.stats?.comments || 0,
            views: data.stats?.views || 0
          },
          downloadUrl: data.video?.url || data.video
        }
      };
    }
    
    throw new Error('API alternative ne retourne pas de données valides');
    
  } catch (error) {
    console.error('API Alternative - Erreur:', error.message);
    throw error;
  }
}

// Fonction de fallback simple avec une API qui fonctionne
async function getTikTokVideoFallback(url) {
  console.log('Tentative avec API de fallback pour:', url);
  
  try {
    // Utiliser une API simple qui fonctionne
    const response = await axios.get(`https://api.tiklydown.eu.org/api?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    console.log('API Fallback - Status:', response.status);
    console.log('API Fallback - Data:', response.data);
    
    if (response.data && response.data.success && response.data.data) {
      const data = response.data.data;
      return {
        success: true,
        data: {
          id: data.id || Date.now().toString(),
          title: data.title || 'Vidéo TikTok',
          author: {
            username: data.author?.username || 'tiktok_user',
            nickname: data.author?.nickname || 'Utilisateur TikTok',
            avatar: data.author?.avatar || null
          },
          video: {
            url: data.video?.url || data.video,
            duration: data.duration || 0,
            size: data.size || 0,
            quality: 'HD'
          },
          thumbnail: data.thumbnail || null,
          stats: {
            likes: data.stats?.likes || 0,
            shares: data.stats?.shares || 0,
            comments: data.stats?.comments || 0,
            views: data.stats?.views || 0
          },
          downloadUrl: data.video?.url || data.video
        }
      };
    }
    
    throw new Error('API de fallback ne retourne pas de données valides');
    
  } catch (error) {
    console.error('API Fallback - Erreur:', error.message);
    throw error;
  }
}

// Fonction pour utiliser BOTCAHX API locale (fallback)
async function getTikTokVideoBOTCAHX(url) {
  console.log('Tentative avec BOTCAHX API locale pour:', url);
  
  try {
    const response = await axios.get(`http://localhost:3000/tiktok/api.php?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    console.log('BOTCAHX - Status:', response.status);
    console.log('BOTCAHX - Data:', response.data);
    
    if (response.data && (response.data.video || response.data.audio)) {
      return {
        success: true,
        data: {
          id: Date.now().toString(),
          title: 'Vidéo TikTok',
          author: {
            username: 'tiktok_user',
            nickname: 'Utilisateur TikTok',
            avatar: null
          },
          video: {
            url: response.data.video?.[0] || response.data.video,
            duration: 0,
            size: 0,
            quality: 'HD'
          },
          thumbnail: null,
          stats: {
            likes: 0,
            shares: 0,
            comments: 0,
            views: 0
          },
          downloadUrl: response.data.video?.[0] || response.data.video
        }
      };
    }
    
    throw new Error('BOTCAHX ne retourne pas de données valides');
    
  } catch (error) {
    console.error('BOTCAHX - Erreur:', error.message);
    throw error;
  }
}

// 🚀 FONCTION ULTRA-RAPIDE AVEC CACHE DES MÉTADONNÉES
async function getTikTokVideoReal(url) {
  console.log('🚀 Tentative de récupération ultra-rapide pour:', url);
  
  // Vérifier le cache des métadonnées d'abord
  if (metadataCache.has(url)) {
    const cached = metadataCache.get(url);
    console.log(`🚀 Métadonnées trouvées dans le cache pour: ${url}`);
    return cached;
  }
  
  // Résoudre l'URL courte si nécessaire (avec cache)
  let finalUrl = url;
  if (url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com')) {
    finalUrl = await resolveTikTokUrl(url);
  }

  // Utilisation de l'API TikWM avec configuration optimisée
  try {
    console.log('🔍 Tentative avec TikWM (optimisé)...');
    const tikwmResponse = await axios.get(`https://tikwm.com/api?url=${encodeURIComponent(finalUrl)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 12000, // Réduit de 30s à 12s
      httpsAgent: httpsAgent // Keep-alive pour la vitesse
    });

    console.log('📊 Réponse TikWM reçue');
    
    if (tikwmResponse.data && tikwmResponse.data.code === 0 && tikwmResponse.data.data) {
      const data = tikwmResponse.data.data;
      const result = {
        success: true,
        data: {
          id: data.id || Date.now().toString(),
          title: data.title || 'Vidéo TikTok',
          author: {
            username: data.author?.unique_id || 'tiktok_user',
            nickname: data.author?.nickname || 'Utilisateur TikTok',
            avatar: data.author?.avatar || null
          },
          video: {
            url: data.play || data.wmplay,
            duration: data.duration || 0,
            size: data.size || 0,
            quality: 'HD'
          },
          thumbnail: data.cover || data.origin_cover || null,
          stats: {
            likes: data.digg_count || 0,
            shares: data.share_count || 0,
            comments: data.comment_count || 0,
            views: data.play_count || 0
          },
          downloadUrl: data.play || data.wmplay,
          audioUrl: data.music || null
        }
      };
      
      // Mettre en cache les métadonnées
      metadataCache.set(url, result);
      metadataCache.set(finalUrl, result); // Cache aussi pour l'URL résolue
      
      console.log('✅ Métadonnées récupérées et mises en cache');
      return result;
    } else {
      throw new Error(`TikWM a retourné une erreur: ${JSON.stringify(tikwmResponse.data)}`);
    }
  } catch (tikwmError) {
    console.error('❌ Erreur TikWM:', tikwmError.message);
    throw new Error(`Impossible de récupérer la vidéo: ${tikwmError.message}`);
  }
}

// 🎬 FONCTIONS POUR YOUTUBE
// Fonction pour détecter si une URL est YouTube
function isYouTubeUrl(url) {
  return url.includes('youtube.com') || url.includes('youtu.be') || url.includes('m.youtube.com');
}

// 🎬 FONCTION POUR OBTENIR LES MÉTADONNÉES AVEC YT-DLP (FALLBACK POUR ERREUR 429)
/**
 * Obtient les métadonnées d'une vidéo YouTube avec yt-dlp (fallback pour erreur 429)
 * @param {string} url - URL de la vidéo YouTube
 * @returns {Promise<Object>} Métadonnées de la vidéo
 */
async function getYouTubeVideoInfoWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    let ytdlpCommand = 'yt-dlp';
    
    exec('yt-dlp --version', (versionError) => {
      if (versionError) {
        ytdlpCommand = 'python -m yt_dlp';
        exec('python -m yt_dlp --version', (pythonError) => {
          if (pythonError) {
            reject(new Error('yt-dlp n\'est pas accessible'));
            return;
          }
          executeYtDlpGetInfo();
        });
      } else {
        executeYtDlpGetInfo();
      }
    });
    
    function executeYtDlpGetInfo() {
      // Obtenir les métadonnées JSON avec yt-dlp
      const command = `${ytdlpCommand} --dump-json --extractor-args "youtube:player_client=android" "${url}"`;
      
      console.log(`📡 Obtention des métadonnées avec ${ytdlpCommand}...`);
      
      const timeout = setTimeout(() => {
        reject(new Error('yt-dlp timeout (30 secondes)'));
      }, 30000);
      
      exec(command, (error, stdout, stderr) => {
        clearTimeout(timeout);
        
        if (error) {
          if (stderr && !stderr.includes('WARNING')) {
            console.error(`❌ Erreur ${ytdlpCommand}:`, stderr);
          }
          reject(new Error(`${ytdlpCommand}: ${error.message}`));
          return;
        }
        
        try {
          const info = JSON.parse(stdout);
          
          // Extraire le videoId de l'URL
          const videoIdMatch = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
          const videoId = videoIdMatch ? videoIdMatch[1] : info.id || 'unknown';
          
          // Construire la réponse dans le même format que ytdl-core
          const result = {
            success: true,
            data: {
              id: videoId,
              title: info.title || 'Vidéo YouTube',
              type: 'video',
              author: {
                username: info.uploader || info.channel || 'YouTube',
                nickname: info.uploader || info.channel || 'YouTube',
                avatar: info.uploader_thumbnail || info.thumbnail || null
              },
              video: {
                url: null, // yt-dlp gère le téléchargement directement
                duration: info.duration || 0,
                size: info.filesize || (info.duration ? Math.round(info.duration * 500000) : 0),
                quality: '1080p',
                format: null
              },
              thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || null,
              stats: {
                likes: info.like_count || 0,
                shares: 0,
                comments: info.comment_count || 0,
                views: info.view_count || 0
              },
              downloadUrl: null, // Utiliser yt-dlp directement pour télécharger
              audioUrl: null,
              formats: {
                video: null,
                audio: null,
                allFormats: []
              },
              // Flag pour indiquer qu'il faut utiliser yt-dlp pour télécharger
              useYtDlp: true
            }
          };
          
          // Mettre en cache les métadonnées
          metadataCache.set(url, result);
          
          console.log('✅ Métadonnées YouTube récupérées avec yt-dlp');
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Erreur de parsing JSON yt-dlp: ${parseError.message}`));
        }
      });
    }
  });
}

// 🎬 FONCTION POUR OBTENIR L'URL DIRECTE AVEC YT-DLP (STREAMING DIRECT)
/**
 * Obtient l'URL directe d'une vidéo YouTube avec yt-dlp (sans télécharger)
 * @param {string} url - URL de la vidéo YouTube
 * @param {number} preferredItag - Itag préféré (optionnel)
 * @returns {Promise<string>} URL directe de la vidéo
 */
async function getYouTubeDirectUrlWithYtDlp(url, preferredItag = null) {
  return new Promise((resolve, reject) => {
    let ytdlpCommand = 'yt-dlp';
    
    exec('yt-dlp --version', (versionError) => {
      if (versionError) {
        ytdlpCommand = 'python -m yt_dlp';
        exec('python -m yt_dlp --version', (pythonError) => {
          if (pythonError) {
            reject(new Error('yt-dlp n\'est pas accessible'));
            return;
          }
          executeYtDlpGetUrl();
        });
      } else {
        executeYtDlpGetUrl();
      }
    });
    
    function executeYtDlpGetUrl() {
      const formatSelector = preferredItag ? `${preferredItag}/best[ext=mp4]/best` : '18/93/94/95/96/best[ext=mp4]/best';
      const command = `${ytdlpCommand} -f "${formatSelector}" --extractor-args "youtube:player_client=android" --get-url "${url}"`;
      
      console.log(`🔗 Obtention de l'URL directe avec ${ytdlpCommand}...`);
      
      const timeout = setTimeout(() => {
        reject(new Error('yt-dlp timeout (30 secondes)'));
      }, 30000);
      
      exec(command, (error, stdout, stderr) => {
        clearTimeout(timeout);
        
        if (error) {
          if (stderr && !stderr.includes('WARNING')) {
            console.error(`❌ Erreur ${ytdlpCommand}:`, stderr);
          }
          reject(new Error(`${ytdlpCommand}: ${error.message}`));
          return;
        }
        
        const directUrl = stdout.trim();
        if (directUrl && directUrl.startsWith('http')) {
          console.log(`✅ URL directe obtenue: ${directUrl.substring(0, 80)}...`);
          resolve(directUrl);
        } else {
          reject(new Error('Aucune URL directe obtenue'));
        }
      });
    }
  });
}

// 🎬 FONCTION DE FALLBACK AVEC YT-DLP (TÉLÉCHARGEMENT COMPLET - DERNIER RECOURS)
/**
 * Télécharge une vidéo YouTube avec yt-dlp (fallback si ytdl-core échoue)
 * @param {string} url - URL de la vidéo YouTube
 * @param {string} outputPath - Chemin de sortie
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function downloadYouTubeWithYtDlp(url, outputPath) {
  return new Promise((resolve, reject) => {
    // Détecter la commande yt-dlp disponible
    let ytdlpCommand = 'yt-dlp';
    
    // Vérifier d'abord si yt-dlp est accessible directement
    exec('yt-dlp --version', (versionError) => {
      // Si yt-dlp n'est pas dans le PATH, essayer avec python -m yt_dlp
      if (versionError) {
        console.log('⚠️ yt-dlp non trouvé dans PATH, tentative avec python -m yt_dlp...');
        ytdlpCommand = 'python -m yt_dlp';
        
        // Vérifier si python -m yt_dlp fonctionne
        exec('python -m yt_dlp --version', (pythonError) => {
          if (pythonError) {
            console.error('❌ yt-dlp n\'est pas accessible');
            console.error('💡 yt-dlp est installé mais n\'est pas dans le PATH');
            console.error('💡 Solutions:');
            console.error('   1. Ajoutez Python Scripts au PATH: %APPDATA%\\Python\\Python313\\Scripts');
            console.error('   2. Ou utilisez: python -m pip install --upgrade yt-dlp');
            reject(new Error('yt-dlp n\'est pas accessible. Utilisez: python -m yt_dlp ou ajoutez au PATH'));
            return;
          }
          
          // python -m yt_dlp fonctionne, continuer avec cette commande
          executeYtDlpDownload();
        });
      } else {
        // yt-dlp est dans le PATH, continuer
        executeYtDlpDownload();
      }
    });
    
    function executeYtDlpDownload() {
      // Commande yt-dlp pour télécharger en MP4 avec options pour contourner SABR
      // Utiliser le format 18 (360p avec audio) ou les formats m3u8 disponibles
      // --extractor-args pour forcer les formats non-SABR
      const command = `${ytdlpCommand} -f "18/93/94/95/96/best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" --extractor-args "youtube:player_client=android" --merge-output-format mp4 -o "${outputPath}" "${url}"`;
      
      console.log(`📥 Tentative avec ${ytdlpCommand}...`);
      
      const timeout = setTimeout(() => {
        reject(new Error('yt-dlp timeout (5 minutes)'));
      }, 5 * 60 * 1000);
      
      exec(command, (error, stdout, stderr) => {
        clearTimeout(timeout);
        
        if (error) {
          console.error(`❌ Erreur ${ytdlpCommand}:`, error.message);
          if (stderr) {
            console.error(`❌ Stderr ${ytdlpCommand}:`, stderr);
          }
          reject(new Error(`${ytdlpCommand}: ${error.message}`));
          return;
        }
        
        // Vérifier que le fichier existe
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          if (stats.size > 1024) {
            console.log(`✅ Téléchargement ${ytdlpCommand} réussi: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            resolve({
              success: true,
              path: outputPath
            });
          } else {
            reject(new Error('Fichier téléchargé trop petit (corrompu)'));
          }
        } else {
          reject(new Error('Fichier téléchargé introuvable'));
        }
      });
    }
  });
}

// Fonction pour obtenir les métadonnées YouTube avec cache
async function getYouTubeVideoInfo(url) {
  console.log('🎬 Récupération des métadonnées YouTube pour:', url);
  
  // Vérifier le cache d'abord
  if (metadataCache.has(url)) {
    const cached = metadataCache.get(url);
    console.log(`🚀 Métadonnées YouTube trouvées dans le cache pour: ${url}`);
    return cached;
  }
  
  try {
    // Normaliser l'URL YouTube (youtu.be -> youtube.com)
    let normalizedUrl = url;
    if (url.includes('youtu.be/')) {
      const videoId = url.split('youtu.be/')[1].split('?')[0];
      normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log('🔄 URL normalisée:', normalizedUrl);
    }
    
    // Valider l'URL YouTube
    console.log('🔍 Validation de l\'URL YouTube...');
    const isValid = ytdl.validateURL(normalizedUrl);
    console.log('🔍 URL valide?', isValid);
    
    if (!isValid) {
      throw new Error(`URL YouTube invalide: ${normalizedUrl}`);
    }
    
    // Obtenir les informations de la vidéo avec timeout
    console.log('📡 Récupération des infos depuis YouTube...');
    let info;
    try {
      // Utiliser Promise.race pour ajouter un timeout plus court (15s)
      const getInfoPromise = ytdl.getInfo(normalizedUrl, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }
      });
      
      // Timeout plus court pour éviter les blocages
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout: La requête YouTube a pris trop de temps (15s)')), 15000)
      );
      
      console.log('⏳ Attente de la réponse YouTube (timeout: 15s)...');
      
      // Utiliser Promise.race avec un cleanup pour éviter les fuites mémoire
      info = await Promise.race([
        getInfoPromise.catch(err => {
          console.error('❌ Erreur dans getInfoPromise:', err.message);
          throw err;
        }),
        timeoutPromise
      ]);
      console.log('✅ Infos YouTube récupérées, formats disponibles:', info.formats?.length || 0);
      
      // Vérifier que les formats ont des URLs (malgré les warnings ytdl-core)
      const formatsWithUrl = info.formats?.filter(f => f.url) || [];
      console.log(`📊 Formats avec URL valide: ${formatsWithUrl.length} sur ${info.formats?.length || 0}`);
      
      if (formatsWithUrl.length === 0) {
        console.warn('⚠️ Aucun format avec URL disponible - les warnings ytdl-core peuvent être la cause');
        // Les warnings sont normaux, mais on continue quand même
      }
      
      if (!info || !info.formats || info.formats.length === 0) {
        throw new Error('Aucun format disponible pour cette vidéo YouTube');
      }
    } catch (infoError) {
      console.error('❌ Erreur lors de la récupération des infos YouTube:', infoError.message);
      console.error('❌ Stack:', infoError.stack);
      
      // Si erreur 429 (rate limiting), utiliser yt-dlp comme fallback
      if (infoError.message.includes('429') || infoError.message.includes('Status code: 429')) {
        console.log('⚠️ Erreur 429 détectée (rate limiting YouTube), utilisation de yt-dlp comme fallback...');
        
        try {
          // Utiliser yt-dlp pour obtenir les métadonnées et télécharger directement
          return await getYouTubeVideoInfoWithYtDlp(normalizedUrl);
        } catch (ytdlpError) {
          console.error('❌ yt-dlp a aussi échoué:', ytdlpError.message);
          throw new Error(`Impossible de récupérer les informations de la vidéo (429 + yt-dlp échoué): ${infoError.message}`);
        }
      }
      
      throw new Error(`Impossible de récupérer les informations de la vidéo: ${infoError.message}`);
    }
    
    // Trouver le format vidéo de meilleure qualité (HD)
    console.log('🔍 Recherche du meilleur format vidéo HD...');
    // Filtrer uniquement les formats qui ont une URL (nécessaire à cause des warnings ytdl-core)
    const formatsWithUrl = info.formats?.filter(f => f.url) || [];
    const videoFormats = ytdl.filterFormats(formatsWithUrl, 'video');
    const audioFormats = ytdl.filterFormats(formatsWithUrl, 'audioonly');
    
    console.log(`📊 Formats vidéo disponibles: ${videoFormats.length} (avec URL valide)`);
    console.log(`📊 Formats audio disponibles: ${audioFormats.length} (avec URL valide)`);
    
    if (videoFormats.length === 0) {
      throw new Error('Aucun format vidéo avec URL disponible. YouTube a peut-être changé son système de protection.');
    }
    
    // Fonction pour obtenir la valeur numérique de la qualité
    const getQualityValue = (qualityLabel) => {
      if (!qualityLabel) return 0;
      const match = qualityLabel.match(/(\d+)p/);
      return match ? parseInt(match[1]) : 0;
    };
    
    // Prioriser les formats avec vidéo + audio INTÉGRÉ (plus fiable pour le streaming)
    // IMPORTANT: Les formats avec audio intégré évitent les problèmes de corruption
    let bestFormat = videoFormats
      .filter(f => {
        // Filtrer UNIQUEMENT les formats avec vidéo + audio INTÉGRÉ (plus fiable)
        if (!f.hasVideo || !f.hasAudio || !f.url) return false;
        // Accepter toutes les qualités avec audio intégré (même 360p)
        const quality = getQualityValue(f.qualityLabel);
        return quality >= 360; // Minimum 360p si avec audio intégré
      })
      .sort((a, b) => {
        // Trier par qualité décroissante
        const qualityA = getQualityValue(a.qualityLabel);
        const qualityB = getQualityValue(b.qualityLabel);
        if (qualityB !== qualityA) return qualityB - qualityA;
        // Si même qualité, préférer le meilleur bitrate
        return (b.bitrate || 0) - (a.bitrate || 0);
      })[0];
    
    // Si aucun format avec audio intégré, chercher le meilleur format vidéo seul (mais limiter à 720p max)
    // Les formats sans audio peuvent causer des problèmes de corruption
    if (!bestFormat) {
      console.log('⚠️ Aucun format avec audio intégré trouvé, recherche du meilleur format vidéo seul (max 720p)...');
      bestFormat = videoFormats
        .filter(f => {
          if (!f.hasVideo || !f.url) return false;
          const quality = getQualityValue(f.qualityLabel);
          // Limiter à 720p max pour éviter les formats trop lourds sans audio
          return quality >= 480 && quality <= 720;
        })
        .sort((a, b) => {
          const qualityA = getQualityValue(a.qualityLabel);
          const qualityB = getQualityValue(b.qualityLabel);
          if (qualityB !== qualityA) return qualityB - qualityA;
          return (b.bitrate || 0) - (a.bitrate || 0);
        })[0];
    }
    
    // Fallback: accepter n'importe quel format avec vidéo+audio intégré (même basse qualité)
    if (!bestFormat) {
      console.log('⚠️ Aucun format HD trouvé, recherche de n\'importe quel format avec vidéo+audio intégré...');
      bestFormat = videoFormats
        .filter(f => f.hasVideo && f.hasAudio && f.qualityLabel && f.url)
        .sort((a, b) => {
          const qualityA = getQualityValue(a.qualityLabel);
          const qualityB = getQualityValue(b.qualityLabel);
          return qualityB - qualityA;
        })[0];
    }
    
    // Dernier recours: format vidéo avec URL valide (même sans audio)
    if (!bestFormat) {
      console.log('⚠️ Aucun format optimal trouvé, utilisation du premier format vidéo avec URL disponible...');
      bestFormat = videoFormats.find(f => f.hasVideo && f.url);
    }
    
    if (!bestFormat) {
      throw new Error('Aucun format vidéo disponible pour cette vidéo');
    }
    
    const qualityLabel = bestFormat.qualityLabel || 'Inconnue';
    const qualityValue = getQualityValue(qualityLabel);
    console.log(`✅ Format sélectionné: ${qualityLabel} (${qualityValue}p, itag: ${bestFormat.itag}, bitrate: ${bestFormat.bitrate || 'N/A'})`);
    console.log(`🔊 Audio intégré: ${bestFormat.hasAudio ? '✅ Oui' : '❌ Non'} | URL valide: ${bestFormat.url ? '✅ Oui' : '❌ Non'}`);
    console.log(`📦 Taille: ${bestFormat.contentLength ? (parseInt(bestFormat.contentLength) / 1024 / 1024).toFixed(2) + ' MB' : 'Non disponible'}`);
    
    // Meilleur format audio pour téléchargement séparé
    const bestAudio = audioFormats
      .filter(f => f.audioBitrate)
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
    
    const result = {
      success: true,
      data: {
        id: info.videoDetails.videoId,
        title: info.videoDetails.title || 'Vidéo YouTube',
        type: 'video',
        author: {
          username: info.videoDetails.author.name || 'YouTube',
          nickname: info.videoDetails.author.name || 'YouTube',
          avatar: info.videoDetails.author.thumbnails?.[0]?.url || null
        },
        video: {
          url: bestFormat?.url || null,
          duration: parseInt(info.videoDetails.lengthSeconds) || 0,
          size: bestFormat?.contentLength ? parseInt(bestFormat.contentLength) : (bestFormat?.hasVideo && bestFormat?.hasAudio ? Math.round((parseInt(info.videoDetails.lengthSeconds) || 0) * 500000) : (bestFormat?.bitrate && info.videoDetails.lengthSeconds ? Math.round((parseInt(info.videoDetails.lengthSeconds) || 0) * (bestFormat.bitrate / 8)) : 0)), // Estimation basée sur bitrate si contentLength n'est pas disponible
          quality: bestFormat?.qualityLabel || (bestFormat?.hasVideo && bestFormat?.hasAudio ? 'HD' : 'Variable'),
          format: bestFormat?.itag || null
        },
        thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || null,
        stats: {
          likes: parseInt(info.videoDetails.likes) || 0,
          shares: 0,
          comments: parseInt(info.videoDetails.commentCount) || 0,
          views: parseInt(info.videoDetails.viewCount) || 0
        },
        downloadUrl: bestFormat?.url || (bestFormat?.hasVideo ? bestFormat.url : null),
        audioUrl: bestAudio?.url || null,
        formats: {
          video: bestFormat,
          audio: bestAudio,
          allFormats: info.formats
        }
      }
    };
    
    // Mettre en cache les métadonnées
    metadataCache.set(url, result);
    
    console.log('✅ Métadonnées YouTube récupérées et mises en cache');
    return result;
    
  } catch (error) {
    console.error('❌ Erreur YouTube détaillée:');
    console.error('   Message:', error.message);
    console.error('   Type:', error.constructor.name);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    throw new Error(`Impossible de récupérer la vidéo YouTube: ${error.message}`);
  }
}


const app = express();
const PORT = process.env.PORT || 3001;

// Middleware de sécurité
app.use(helmet());

// Configuration CORS pour permettre les requêtes depuis le frontend
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost',
  'http://localhost:80',
  'http://127.0.0.1',
  'http://127.0.0.1:80',
  `http://${LAN_IP}:5173`,
  `http://${LAN_IP}`,
  `http://${LAN_IP}:80`,
  'https://tik-tok-8gsd.onrender.com',
  'https://tik-tok-tau-ten.vercel.app',
];
const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...extraOrigins])];

function isPrivateOrLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  } catch {
    return false;
  }
  return false;
}

app.use(cors({
  origin: function (origin, callback) {
    // Autoriser les requêtes sans origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (isPrivateOrLocalOrigin(origin)) {
      return callback(null, true);
    }
    console.log('CORS: Origin non autorisé:', origin);
    callback(new Error('Non autorisé par CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 200
}));

// Middleware pour parser le JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route de test
app.get('/api/health', async (req, res) => {
  let cobalt = { available: false };
  try {
    const info = await getInstanceInfo();
    cobalt = {
      available: true,
      version: info?.cobalt?.version || null,
      services: info?.cobalt?.services || [],
    };
  } catch (err) {
    cobalt = { available: false, error: err.message };
  }

  res.json({
    status: 'OK',
    message: 'Downloader API opérationnelle',
    timestamp: new Date().toISOString(),
    cobalt,
    cors: {
      origin: req.headers.origin || 'No origin',
      allowed: allowedOrigins
    }
  });
});

function getPublicBase(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwarded || req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

app.get('/api/platforms', async (req, res) => {
  try {
    const info = await getInstanceInfo();
    res.json({
      success: true,
      services: info?.cobalt?.services || [],
      version: info?.cobalt?.version || null,
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      message: 'Instance Cobalt injoignable. Lance `docker compose up -d` dans ~/cobalt.',
      error: err.message,
    });
  }
});

app.get('/api/cobalt/file', async (req, res) => {
  const pageUrl = sanitizeMediaUrl(req.query.url || '');
  const audioOnly = req.query.audio === '1';
  let parsedPage;
  try {
    parsedPage = new URL(pageUrl);
  } catch {
    return res.status(400).json({ error: 'URL invalide' });
  }
  if (!['http:', 'https:'].includes(parsedPage.protocol)) {
    return res.status(400).json({ error: 'URL invalide' });
  }

  try {
    const cobalt = await processUrl(pageUrl, { audioOnly });
    if (!cobalt || cobalt.status === 'error') {
      return res.status(502).json({
        error: 'Cobalt',
        message: mapCobaltError(cobalt),
      });
    }

    const mediaUrl = resolveCobaltTunnelUrl(cobalt.url || cobalt.tunnel?.[0]);
    if (!mediaUrl) {
      return res.status(502).json({ error: 'Cobalt', message: 'Aucun fichier à télécharger' });
    }

    if (isLocalCobaltUrl(mediaUrl)) {
      const target = new URL(mediaUrl);
      const upstreamReq = http.request(
        target,
        { method: 'GET', headers: { Accept: '*/*' } },
        (upstream) => {
          if ((upstream.statusCode || 500) >= 400) {
            res.status(upstream.statusCode || 502).json({
              error: 'Tunnel Cobalt',
              message: `Le fichier n’a pas pu être récupéré (${upstream.statusCode})`,
            });
            upstream.resume();
            return;
          }
          res.status(upstream.statusCode || 200);
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          res.setHeader(
            'Content-Disposition',
            upstream.headers['content-disposition'] ||
              `attachment; filename="${(cobalt.filename || 'media.mp4').replace(/"/g, '')}"`
          );
          res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
          const length = Number(upstream.headers['content-length'] || 0);
          if (length > 0) {
            res.setHeader('Content-Length', String(length));
          }
          upstream.pipe(res);
        }
      );
      upstreamReq.on('error', (err) => {
        console.error('Cobalt file:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Cobalt', message: err.message });
        }
      });
      upstreamReq.setTimeout(180000, () => {
        upstreamReq.destroy();
        if (!res.headersSent) {
          res.status(504).json({ error: 'Cobalt', message: 'Délai dépassé' });
        }
      });
      upstreamReq.end();
      return;
    }

    return res.redirect(302, mediaUrl);
  } catch (err) {
    console.error('Cobalt file:', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Cobalt',
        message: err.message || 'Téléchargement impossible',
      });
    }
  }
});

app.get('/api/cobalt/proxy', (req, res) => {
  const raw = req.query.u;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'URL de tunnel manquante' });
  }
  if (!isLocalCobaltUrl(raw)) {
    return res.status(403).json({ error: 'URL de tunnel non autorisée' });
  }

  let target;
  try {
    target = new URL(resolveCobaltTunnelUrl(raw));
  } catch {
    return res.status(400).json({ error: 'URL de tunnel invalide' });
  }

  const upstreamReq = http.request(
    target,
    {
      method: 'GET',
      headers: { Accept: '*/*' },
    },
    (upstream) => {
      if ((upstream.statusCode || 500) >= 400) {
        res.status(upstream.statusCode || 502).json({
          error: 'Tunnel Cobalt',
          message: `Le fichier n’a pas pu être récupéré (${upstream.statusCode})`,
        });
        upstream.resume();
        return;
      }

      res.status(upstream.statusCode || 200);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (upstream.headers['content-disposition']) {
        res.setHeader('Content-Disposition', upstream.headers['content-disposition']);
      }
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
      const length = Number(upstream.headers['content-length'] || 0);
      if (length > 0) {
        res.setHeader('Content-Length', String(length));
      }
      upstream.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    console.error('Proxy Cobalt:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy Cobalt', message: err.message });
    }
  });
  upstreamReq.setTimeout(120000, () => {
    upstreamReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Proxy Cobalt', message: 'Délai dépassé' });
    }
  });
  upstreamReq.end();
});

app.get('/api/host/file', async (req, res) => {
  const pageUrl = sanitizeMediaUrl(req.query.url || '');
  const audioOnly = req.query.audio === '1';
  const platform = detectPlatform(pageUrl);
  if (!pageUrl || !isHostFallbackPlatform(platform)) {
    return res.status(400).json({ error: 'URL fallback invalide' });
  }

  try {
    const file = await downloadHostFile(pageUrl, { audioOnly, cacheDir: CACHE_DIR });
    sendFile(res, file.path, {
      filename: file.filename,
      contentType: file.contentType,
    });
  } catch (err) {
    console.error('Host file:', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: platform,
        message: err.message || 'Téléchargement hôte impossible',
      });
    }
  }
});

app.get('/api/youtube/file', async (req, res) => {
  const pageUrl = sanitizeMediaUrl(req.query.url || '');
  const audioOnly = req.query.audio === '1';
  if (!pageUrl || !isYouTubeUrl(pageUrl)) {
    return res.status(400).json({ error: 'URL YouTube invalide' });
  }

  const friendlyBotError = (raw) => {
    const msg = String(raw || '');
    if (/not a bot|Sign in|cookies|poToken|login/i.test(msg)) {
      return (
        'YouTube bloque l’IP du serveur (anti-bot). ' +
        'Déploie avec yt-session-generator (docker compose) ou ajoute des cookies YouTube ' +
        '(YTDLP_COOKIES=/cookies/youtube.txt).'
      );
    }
    return msg || 'Téléchargement YouTube impossible';
  };

  // 1) Cobalt + session YouTube (même IP que le VPS, mais avec poToken)
  try {
    const cobalt = await processUrl(pageUrl, { audioOnly });
    const mediaUrl = resolveCobaltTunnelUrl(cobalt?.url || cobalt?.tunnel?.[0]);
    if (cobalt && cobalt.status !== 'error' && mediaUrl && isLocalCobaltUrl(mediaUrl)) {
      const ok = await new Promise((resolve) => {
        const target = new URL(mediaUrl);
        const upstreamReq = http.request(
          target,
          { method: 'GET', headers: { Accept: '*/*' } },
          (upstream) => {
            const status = upstream.statusCode || 500;
            const lengthHeader = upstream.headers['content-length'];
            const length = lengthHeader !== undefined ? Number(lengthHeader) : -1;
            // Cobalt peut streamer sans Content-Length ; on rejette seulement 0 octet explicite.
            if (status >= 400 || length === 0) {
              upstream.resume();
              resolve(false);
              return;
            }
            res.status(status);
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader(
              'Content-Disposition',
              upstream.headers['content-disposition'] ||
                `attachment; filename="${(cobalt.filename || 'youtube.mp4').replace(/"/g, '')}"`
            );
            res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
            if (length > 0) {
              res.setHeader('Content-Length', String(length));
            }
            upstream.pipe(res);
            resolve(true);
          }
        );
        upstreamReq.on('error', () => resolve(false));
        upstreamReq.setTimeout(20000, () => {
          upstreamReq.destroy();
          resolve(false);
        });
        upstreamReq.end();
      });
      if (ok) return;
      console.warn('⚠️ Tunnel Cobalt YouTube vide / KO, fallback yt-dlp…');
    }
  } catch (cobaltErr) {
    console.warn(`⚠️ Cobalt YouTube file: ${cobaltErr.message}`);
  }

  // 2) yt-dlp (marche en local ; en prod souvent cookies requis)
  try {
    const file = await downloadYouTubeFile(pageUrl, { audioOnly, cacheDir: CACHE_DIR });
    sendFile(res, file.path, {
      filename: file.filename,
      contentType: file.contentType,
    });
  } catch (err) {
    console.error('YouTube file:', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'YouTube',
        message: friendlyBotError(err.message),
      });
    }
  }
});

app.get('/api/media/proxy', (req, res) => {
  const raw = req.query.u;
  if (!raw || typeof raw !== 'string' || !isAllowedTwitterMediaUrl(raw)) {
    return res.status(403).json({ error: 'URL média non autorisée' });
  }

  let target;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'URL média invalide' });
  }

  const upstreamReq = https.request(
    target,
    {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': 'Mozilla/5.0',
      },
    },
    (upstream) => {
      if ((upstream.statusCode || 500) >= 400) {
        res.status(upstream.statusCode || 502).json({
          error: 'Média X',
          message: `Le fichier n’a pas pu être récupéré (${upstream.statusCode})`,
        });
        upstream.resume();
        return;
      }

      res.status(upstream.statusCode || 200);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'video/mp4');
      const length = Number(upstream.headers['content-length'] || 0);
      if (length > 0) {
        res.setHeader('Content-Length', String(length));
      }
      res.setHeader('Content-Disposition', 'attachment; filename="x-video.mp4"');
      upstream.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    console.error('Proxy X:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy X', message: err.message });
    }
  });
  upstreamReq.end();
});

// Route de test simple pour vérifier la connectivité
app.get('/api/test-connectivity', async (req, res) => {
  try {
    // Test simple de connectivité
    const response = await axios.get('https://httpbin.org/get', {
      timeout: 5000
    });
    
    res.json({
      success: true,
      message: 'Connectivité internet OK',
      externalApiTest: 'Réussi',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Problème de connectivité',
      error: error.message
    });
  }
});

// Route de test avec une vidéo publique
app.get('/api/test-video', async (req, res) => {
  try {
    // Utiliser une vidéo TikTok publique connue pour tester
    const testUrl = 'https://www.tiktok.com/@tiktok/video/7000000000000000000';
    console.log('Test avec vidéo publique:', testUrl);
    
    // Test direct avec TikWM API
    const response = await axios.get(`https://tikwm.com/api?url=${encodeURIComponent(testUrl)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    res.json({
      success: true,
      message: 'Test réussi - TikWM API accessible',
      tikwmStatus: response.status,
      tikwmData: response.data
    });
  } catch (error) {
    console.error('Erreur de test:', error.message);
    res.status(500).json({
      success: false,
      message: 'Test échoué',
      error: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data
    });
  }
});

// Route de test pour l'API alternative
app.get('/api/test-alternative', async (req, res) => {
  try {
    const testUrl = 'https://www.tiktok.com/@tiktok/video/7000000000000000000';
    console.log('Test API alternative avec:', testUrl);
    
    const result = await getTikTokVideoAlternative(testUrl);
    res.json({
      success: true,
      message: 'Test API alternative réussi',
      data: result
    });
  } catch (error) {
    console.error('Erreur test API alternative:', error.message);
    res.status(500).json({
      success: false,
      message: 'Test API alternative échoué',
      error: error.message
    });
  }
});

// Route de test avec une vraie URL TikTok
app.get('/api/test-real', async (req, res) => {
  try {
    // Utiliser une vraie URL TikTok publique
    const testUrl = 'https://www.tiktok.com/@tiktok/video/7000000000000000000';
    console.log('Test avec vraie URL TikTok:', testUrl);
    
    // Test direct avec TikWM API
    const response = await axios.get(`https://tikwm.com/api?url=${encodeURIComponent(testUrl)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    res.json({
      success: true,
      message: 'Test avec vraie URL réussi',
      tikwmStatus: response.status,
      tikwmData: response.data
    });
  } catch (error) {
    console.error('Erreur test vraie URL:', error.message);
    res.status(500).json({
      success: false,
      message: 'Test vraie URL échoué',
      error: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data
    });
  }
});

// Route de test pour les images TikTok
app.get('/api/test-image', async (req, res) => {
  try {
    // Utiliser une URL d'image TikTok pour tester
    const testUrl = 'https://www.tiktok.com/@tiktok/photo/7000000000000000000';
    console.log('Test avec URL image TikTok:', testUrl);
    
    // Test direct avec TikWM API
    const response = await axios.get(`https://tikwm.com/api?url=${encodeURIComponent(testUrl)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    res.json({
      success: true,
      message: 'Test image TikTok réussi',
      tikwmStatus: response.status,
      tikwmData: response.data,
      isImage: response.data?.data?.images ? true : false
    });
  } catch (error) {
    console.error('Erreur test image TikTok:', error.message);
    res.status(500).json({
      success: false,
      message: 'Test image TikTok échoué',
      error: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data
    });
  }
});

// Route de test (sans FFmpeg)
app.get('/api/test-ffmpeg', (req, res) => {
  try {
    console.log('🧪 Test du système de téléchargement...');
    
    res.json({
      success: true,
      message: 'Système de téléchargement d\'images TikTok fonctionne',
      note: 'FFmpeg non disponible - téléchargement direct des images',
      status: 'OK'
    });
      
  } catch (error) {
    console.error('Erreur test:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur test',
      error: error.message
    });
  }
});

// Route pour obtenir les URLs d'image et audio TikTok
app.post('/api/combine-image-audio', async (req, res) => {
  try {
    const { imageUrl, audioUrl, duration = 10 } = req.body;
    
    if (!imageUrl || !audioUrl) {
      return res.status(400).json({
        success: false,
        message: 'Image URL et Audio URL requis'
      });
    }
    
    console.log('🔄 Préparation des URLs TikTok...');
    console.log('Image:', imageUrl);
    console.log('Audio:', audioUrl);
    console.log('Durée:', duration);
    
    // Retourner les URLs dans la réponse JSON
    res.json({
      success: true,
      message: 'URLs TikTok préparées',
      data: {
        imageUrl: imageUrl,
        audioUrl: audioUrl,
        duration: duration,
        type: 'image_with_audio',
        instructions: {
          frontend: 'Utilisez ces URLs pour afficher l\'image + jouer l\'audio',
          note: 'L\'image TikTok contient déjà le son intégré'
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur préparation URLs:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la préparation des URLs',
      error: error.message
    });
  }
});

// 🚀 Route de statistiques de cache pour monitoring
app.get('/api/cache-stats', (req, res) => {
  try {
    const stats = {
      urlCache: {
        size: urlCache.size,
        entries: Array.from(urlCache.keys())
      },
      metadataCache: {
        size: metadataCache.size,
        entries: Array.from(metadataCache.keys())
      },
      videoCache: {
        files: fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).length : 0,
        totalSize: 0
      },
      performance: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    };

    // Calculer la taille totale du cache vidéo
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      stats.videoCache.totalSize = files.reduce((total, file) => {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        return total + stats.size;
      }, 0);
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Erreur de récupération des stats' });
  }
});

// 🚀 Route pour vider le cache
app.post('/api/clear-cache', (req, res) => {
  try {
    // Vider les caches en mémoire
    urlCache.clear();
    metadataCache.clear();
    videoCache.clear();

    // Supprimer les fichiers de cache vidéo
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      files.forEach(file => {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      });
    }

    res.json({
      success: true,
      message: 'Cache vidé avec succès',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du vidage du cache' });
  }
});

// Route principale pour télécharger les vidéos TikTok et YouTube
app.post('/api/download', async (req, res) => {
  try {
    const { url: rawUrl } = req.body;
    
    // Validation de l'URL
    if (!rawUrl) {
      return res.status(400).json({ 
        error: 'URL requise',
        message: 'Veuillez fournir une URL valide'
      });
    }

    const url = sanitizeMediaUrl(rawUrl);

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({
        error: 'URL invalide',
        message: 'Le lien n’est pas une URL valide'
      });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        error: 'URL invalide',
        message: 'Seuls les liens http(s) sont acceptés'
      });
    }

    // Détecter le type de plateforme
    const isYouTube = isYouTubeUrl(url);
    const isTikTok = url.includes('tiktok.com') || url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com');
    const isTwitter = detectPlatform(url) === 'twitter';
    const isPinterest = detectPlatform(url) === 'pinterest';
    const audioOnly = Boolean(req.body.audioOnly);

    console.log(`Traitement: ${url} (cobalt d’abord${audioOnly ? ', audio' : ''})`);

    try {
      const cobaltResult = await downloadViaCobalt(url, {
        audioOnly,
        publicBase: getPublicBase(req),
      });
      console.log(`✅ Cobalt OK (${cobaltResult.data.platform}, ${cobaltResult.data.cobaltStatus})`);
      return res.json(cobaltResult);
    } catch (cobaltError) {
      console.warn(`⚠️ Cobalt échoué: ${cobaltError.message}`);
      if (isTwitter) {
        try {
          const twitterResult = await downloadViaTwitterFallback(url, {
            audioOnly,
            publicBase: getPublicBase(req),
          });
          console.log('✅ Fallback X / Twitter OK');
          return res.json(twitterResult);
        } catch (twitterError) {
          console.warn(`⚠️ Fallback X échoué: ${twitterError.message}`);
          return res.status(502).json({
            success: false,
            error: 'Twitter',
            message: twitterError.message || cobaltError.message,
          });
        }
      }
      if (isPinterest) {
        try {
          const pinResult = await downloadViaPinterestFallback(url, {
            audioOnly,
            publicBase: getPublicBase(req),
          });
          console.log('✅ Fallback Pinterest OK');
          return res.json(pinResult);
        } catch (pinError) {
          console.warn(`⚠️ Fallback Pinterest échoué: ${pinError.message}`);
          return res.status(502).json({
            success: false,
            error: 'Pinterest',
            message: pinError.message || cobaltError.message,
          });
        }
      }
      if (isYouTube) {
        try {
          const ytResult = await downloadViaYoutubeFallback(url, {
            audioOnly,
            publicBase: getPublicBase(req),
            cacheDir: CACHE_DIR,
          });
          console.log(`✅ Fallback YouTube OK (${ytResult.data.cobaltStatus})`);
          return res.json(ytResult);
        } catch (ytError) {
          console.warn(`⚠️ Fallback YouTube échoué: ${ytError.message}`);
          const msg = String(ytError.message || '');
          const bot = /not a bot|Sign in to confirm|Status code: 429|\b429\b/i.test(msg);
          return res.status(502).json({
            success: false,
            error: 'YouTube',
            message: bot
              ? 'YouTube bloque l’IP du VPS (anti-bot). Vérifie YTDLP_COOKIES=/cookies/youtube.txt ou réexporte les cookies.'
              : msg || cobaltError.message,
          });
        }
      }
      const hostPlatform = detectPlatform(url);
      if (isHostFallbackPlatform(hostPlatform)) {
        try {
          const hostResult = await downloadViaHostFallback(url, {
            audioOnly,
            publicBase: getPublicBase(req),
          });
          console.log(`✅ Fallback hôte OK (${hostPlatform}, ${hostResult.data.cobaltStatus})`);
          return res.json(hostResult);
        } catch (hostError) {
          console.warn(`⚠️ Fallback hôte échoué: ${hostError.message}`);
          return res.status(502).json({
            success: false,
            error: hostPlatform,
            message: hostError.message || cobaltError.message,
          });
        }
      }
      if (audioOnly || (!isYouTube && !isTikTok)) {
        return res.status(502).json({
          success: false,
          error: 'Cobalt',
          message: cobaltError.message || 'Impossible de récupérer ce média via Cobalt',
        });
      }
      console.log('↪️ Fallback vers le moteur TikTok / YouTube historique');
    }

    let data;
    let lastError;
    
    // Traitement selon la plateforme
    if (isYouTube) {
      // 🎬 TRAITEMENT YOUTUBE
      try {
        console.log('🎬 Traitement YouTube...');
        console.log('🎬 URL reçue:', url);
        data = await getYouTubeVideoInfo(url);
        console.log('✅ YouTube réussi, format sélectionné:', data?.video?.quality || 'Inconnu');
      } catch (error) {
        console.error('❌ YouTube échoué - Erreur complète:', error);
        console.error('❌ Stack trace:', error.stack);
        return res.status(500).json({
          error: 'Erreur YouTube',
          message: `Impossible de récupérer la vidéo YouTube: ${error.message}`,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    } else {
      // 📱 TRAITEMENT TIKTOK
      // Système de fallback simplifié et fiable
      try {
        // 1. TikWM API (priorité)
        console.log('🔄 Tentative 1: TikWM API');
        data = await getTikTokVideoTikWM(url);
        console.log('✅ TikWM API réussie');
      } catch (error1) {
        console.log('❌ TikWM échoué:', error1.message);
        lastError = error1;
        
        try {
          // 2. BOTCAHX API locale
          console.log('🔄 Tentative 2: BOTCAHX API locale');
          data = await getTikTokVideoBOTCAHX(url);
          console.log('✅ BOTCAHX API réussie');
        } catch (error2) {
          console.log('❌ BOTCAHX échoué:', error2.message);
          lastError = error2;
          
          try {
            // 3. Fonction de secours
            console.log('🔄 Tentative 3: Fonction de secours');
            data = await getTikTokVideoReal(url);
            console.log('✅ Fonction de secours réussie');
          } catch (error3) {
            console.log('❌ Toutes les APIs ont échoué');
            throw new Error(`Toutes les APIs ont échoué. Dernière erreur: ${lastError.message}`);
          }
        }
      }
    }
    
    if (!data.success && !data.data) {
      throw new Error('Aucune API n\'a pu récupérer les données de la vidéo');
    }

    const videoData = data.data || data;
    console.log('Données vidéo extraites:', videoData);
    
    // Construction de la réponse avec les informations de la vidéo/image
    const responseData = {
      success: true,
      data: {
        id: videoData.id || Date.now().toString(),
        title: videoData.title || videoData.desc || (videoData.type === 'image' ? 'Image TikTok' : isYouTube ? 'Vidéo YouTube' : 'Vidéo TikTok'),
        type: videoData.type || 'video',
        platform: isYouTube ? 'youtube' : 'tiktok',
        source: 'legacy',
        author: {
          username: videoData.author?.unique_id || videoData.author?.username || 'Utilisateur inconnu',
          nickname: videoData.author?.nickname || 'Utilisateur inconnu',
          avatar: videoData.author?.avatar_thumb?.url_list?.[0] || videoData.author?.avatar || null
        },
        video: videoData.video ? {
          url: videoData.video?.download_addr?.url_list?.[0] || videoData.video?.play_addr?.url_list?.[0] || videoData.video?.url || videoData.video?.[0] || videoData.video,
          duration: videoData.video?.duration || videoData.duration || 0,
          size: videoData.video?.size || 0,
          quality: videoData.video?.quality || 'HD',
          format: videoData.video?.format || null
        } : null,
        image: videoData.image ? {
          url: videoData.image?.url || videoData.images?.[0] || videoData.cover,
          width: videoData.image?.width || 0,
          height: videoData.image?.height || 0,
          quality: 'HD'
        } : null,
        // Pour les images TikTok, on fournit les données pour combiner
        combinedVideo: videoData.combinedVideo ? {
          imageUrl: videoData.combinedVideo.imageUrl,
          audioUrl: videoData.combinedVideo.audioUrl,
          duration: videoData.combinedVideo.duration
        } : null,
        // Indique si c'est une vidéo statique (image TikTok avec son)
        isStaticVideo: videoData.isStaticVideo || false,
        thumbnail: videoData.cover?.url_list?.[0] || videoData.video?.cover?.url_list?.[0] || videoData.thumbnail || null,
        stats: {
          likes: videoData.statistics?.digg_count || videoData.stats?.likes || 0,
          shares: videoData.statistics?.share_count || videoData.stats?.shares || 0,
          comments: videoData.statistics?.comment_count || videoData.stats?.comments || 0,
          views: videoData.statistics?.play_count || videoData.stats?.views || 0
        },
        downloadUrl: videoData.downloadUrl || videoData.video?.download_addr?.url_list?.[0] || videoData.video?.play_addr?.url_list?.[0] || videoData.video?.url || videoData.video?.[0] || videoData.video,
        audioUrl: videoData.audioUrl || videoData.music || null,
        // Formats disponibles (pour YouTube)
        formats: videoData.formats || null,
        // Note importante pour le frontend
        frontendNote: videoData.isStaticVideo ? 
          'Image TikTok détectée - traiter comme une vidéo avec <video> tag pour iPhone' : 
          isYouTube ? 'Vidéo YouTube HD' : 'Vidéo TikTok normale'
      }
    };

    // Vérification que l'URL de téléchargement existe
    if (!responseData.data.downloadUrl || responseData.data.downloadUrl === 'undefined') {
      throw new Error('URL de téléchargement non disponible');
    }
    
    console.log('URL de téléchargement validée:', responseData.data.downloadUrl);

    res.json(responseData);

  } catch (error) {
    console.error('❌ Erreur globale lors du téléchargement:', error);
    console.error('   Message:', error.message);
    console.error('   Stack:', error.stack);
    
    // S'assurer qu'une réponse est toujours envoyée
    if (!res.headersSent) {
      // Gestion des erreurs spécifiques
      let errorMessage = 'Erreur lors du téléchargement de la vidéo';
      let statusCode = 500;

      if (error.message.includes('Video not available')) {
        errorMessage = 'Cette vidéo n\'est pas disponible ou a été supprimée';
        statusCode = 404;
      } else if (error.message.includes('Private account')) {
        errorMessage = 'Cette vidéo provient d\'un compte privé';
        statusCode = 403;
      } else if (error.message.includes('Rate limit')) {
        errorMessage = 'Trop de requêtes, veuillez patienter';
        statusCode = 429;
      } else if (error.message.includes('YouTube')) {
        errorMessage = `Erreur YouTube: ${error.message}`;
        statusCode = 500;
      }

      res.status(statusCode).json({
        success: false,
        error: 'Erreur de téléchargement',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else {
      console.error('⚠️ Headers déjà envoyés, impossible de répondre');
    }
  }
});

// 🚀 FONCTION ULTRA-RAPIDE DE RÉSOLUTION D'URLS COURTES AVEC CACHE
async function resolveTikTokUrl(shortUrl) {
  try {
    // Vérifier le cache d'abord
    if (urlCache.has(shortUrl)) {
      const cached = urlCache.get(shortUrl);
      console.log(`🚀 URL courte trouvée dans le cache: ${shortUrl} → ${cached.url}`);
      return cached.url;
    }
    
    console.log(`🔍 Résolution de l'URL courte: ${shortUrl}`);
    
    // Suivre les redirections avec configuration optimisée
    const response = await axios.get(shortUrl, {
      maxRedirects: 3, // Réduit de 10 à 3 pour la vitesse
      timeout: 8000,   // Réduit de 10s à 8s
      httpsAgent: httpsAgent, // Keep-alive pour la vitesse
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const finalUrl = response.request.res.responseUrl || response.config.url;
    
    // Mettre en cache l'URL résolue
    urlCache.set(shortUrl, {
      url: finalUrl,
      timestamp: Date.now()
    });
    
    console.log(`✅ URL résolue et mise en cache: ${finalUrl}`);
    return finalUrl;
  } catch (error) {
    console.log(`❌ Erreur de résolution d'URL: ${error.message}`);
    return shortUrl; // Retourner l'URL originale si la résolution échoue
  }
}

// 🚀 ROUTE ULTRA-RAPIDE DE TÉLÉCHARGEMENT AVEC CACHE VIDÉO (TikTok + YouTube)
app.get('/api/download/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    let { url, platform } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL requise' });
    }

    // Détecter la plateforme si non spécifiée
    if (!platform) {
      platform = isYouTubeUrl(url) ? 'youtube' : 'tiktok';
    }

    console.log(`🚀 Téléchargement proxy ultra-rapide ${platform} pour: ${url}`);

    // Vérifier le cache vidéo d'abord
    const cachedVideoPath = path.join(CACHE_DIR, `${videoId}.mp4`);
    
    if (fs.existsSync(cachedVideoPath)) {
      const stats = fs.statSync(cachedVideoPath);
      
      // Vérifier que le fichier n'est pas corrompu (taille minimale de 1KB)
      if (stats.size < 1024) {
        console.log(`⚠️ Fichier cache corrompu détecté (${stats.size} bytes), suppression...`);
        fs.unlinkSync(cachedVideoPath);
      } else {
        console.log(`🚀 Vidéo trouvée dans le cache local: ${cachedVideoPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${platform}-${videoId}.mp4"`);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache 1h
        
        // Streamer directement depuis le cache
        const fileStream = fs.createReadStream(cachedVideoPath);
        fileStream.pipe(res);
        
        fileStream.on('error', (error) => {
          console.error('❌ Erreur de lecture du cache:', error);
          // Supprimer le fichier corrompu
          try {
            if (fs.existsSync(cachedVideoPath)) {
              fs.unlinkSync(cachedVideoPath);
              console.log('🗑️ Fichier cache corrompu supprimé');
            }
          } catch (unlinkError) {
            console.error('❌ Erreur lors de la suppression du cache:', unlinkError);
          }
          
          if (!res.headersSent) {
            res.status(500).json({ error: 'Erreur de lecture du cache, fichier supprimé. Réessayez.' });
          } else {
            res.end();
          }
        });
        
        fileStream.on('end', () => {
          console.log('✅ Stream depuis le cache terminé');
        });
        
        return;
      }
    }

    if (platform === 'youtube') {
      // 🎬 TRAITEMENT YOUTUBE
      try {
        console.log('🎬 Début du streaming YouTube pour:', url);
        
        // Normaliser l'URL YouTube
        let normalizedUrl = url;
        if (url.includes('googlevideo.com')) {
          normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
          console.log('🔄 URL de téléchargement directe détectée, utilisation du videoId:', videoId);
        } else if (url.includes('youtu.be/')) {
          const videoIdFromUrl = url.split('youtu.be/')[1].split('?')[0];
          normalizedUrl = `https://www.youtube.com/watch?v=${videoIdFromUrl}`;
          console.log('🔄 URL normalisée:', normalizedUrl);
        } else if (!url.includes('youtube.com')) {
          normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
          console.log('🔄 Utilisation du videoId pour construire l\'URL:', normalizedUrl);
        }
        
        // Vérifier si les métadonnées indiquent d'utiliser yt-dlp directement
        // (cas d'erreur 429 ou autre problème avec ytdl-core)
        const metadataKey = normalizedUrl;
        if (metadataCache.has(metadataKey)) {
          const cachedMetadata = metadataCache.get(metadataKey);
          if (cachedMetadata.data?.useYtDlp) {
            console.log('📥 Utilisation de yt-dlp directement (fallback 429 ou autre)...');
            
            try {
              // Télécharger directement avec yt-dlp
              await downloadYouTubeWithYtDlp(normalizedUrl, cachedVideoPath);
              
              // Si succès, streamer le fichier depuis le cache
              const stats = fs.statSync(cachedVideoPath);
              res.setHeader('Content-Type', 'video/mp4');
              res.setHeader('Content-Disposition', `attachment; filename="youtube-${videoId}.mp4"`);
              res.setHeader('Content-Length', stats.size);
              res.setHeader('Cache-Control', 'public, max-age=3600');
              
              const fileStream = fs.createReadStream(cachedVideoPath);
              fileStream.pipe(res);
              
              fileStream.on('end', () => {
                console.log('✅ Téléchargement YouTube HD (yt-dlp) terminé');
              });
              
              fileStream.on('error', (fileError) => {
                console.error('❌ Erreur de lecture du fichier:', fileError);
                if (!res.headersSent) {
                  res.status(500).json({ error: 'Erreur de lecture du fichier' });
                } else {
                  res.end();
                }
              });
              
              return; // Sortir de la fonction
            } catch (ytdlpError) {
              console.error('❌ yt-dlp a échoué:', ytdlpError.message);
              // Continuer avec le traitement normal
            }
          }
        }
        
        // Valider l'URL YouTube
        if (!ytdl.validateURL(normalizedUrl)) {
          console.error('❌ URL invalide:', normalizedUrl);
          throw new Error(`URL YouTube invalide: ${normalizedUrl}`);
        }

        console.log('📡 Récupération des infos YouTube pour le streaming...');
        // Obtenir les informations de la vidéo avec timeout
        const getInfoPromise = ytdl.getInfo(normalizedUrl, {
          requestOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout lors de la récupération des infos YouTube')), 30000)
        );
        
        const info = await Promise.race([getInfoPromise, timeoutPromise]);
        console.log('✅ Infos YouTube récupérées pour streaming');

        // Trouver le meilleur format vidéo HD avec audio INTÉGRÉ
        const formatsWithUrl = info.formats?.filter(f => f.url) || [];
        const videoFormats = ytdl.filterFormats(formatsWithUrl, 'video');
        
        // Fonction pour obtenir la valeur numérique de la qualité
        const getQualityValue = (qualityLabel) => {
          if (!qualityLabel) return 0;
          const match = qualityLabel.match(/(\d+)p/);
          return match ? parseInt(match[1]) : 0;
        };
        
        // Prioriser les formats HD avec vidéo + audio INTÉGRÉ (plus fiable pour le streaming)
        let bestFormat = videoFormats
          .filter(f => {
            // Filtrer les formats avec vidéo + audio INTÉGRÉ
            if (!f.hasVideo || !f.hasAudio || !f.url) return false;
            // Exclure les très basses qualités (144p, 240p)
            const quality = getQualityValue(f.qualityLabel);
            return quality >= 360; // Accepter 360p minimum si avec audio intégré
          })
          .sort((a, b) => {
            // Trier par qualité décroissante
            const qualityA = getQualityValue(a.qualityLabel);
            const qualityB = getQualityValue(b.qualityLabel);
            if (qualityB !== qualityA) return qualityB - qualityA;
            // Si même qualité, préférer le meilleur bitrate
            return (b.bitrate || 0) - (a.bitrate || 0);
          })[0];
        
        // Si aucun format HD avec audio intégré, chercher le meilleur format vidéo seul (mais limiter à 1080p max)
        if (!bestFormat) {
          console.log('⚠️ Aucun format HD avec audio intégré, recherche du meilleur format vidéo seul (max 1080p)...');
          bestFormat = videoFormats
            .filter(f => {
              if (!f.hasVideo || !f.url) return false;
              const quality = getQualityValue(f.qualityLabel);
              // Limiter à 1080p max pour éviter les formats trop lourds sans audio
              return quality >= 480 && quality <= 1080;
            })
            .sort((a, b) => {
              const qualityA = getQualityValue(a.qualityLabel);
              const qualityB = getQualityValue(b.qualityLabel);
              if (qualityB !== qualityA) return qualityB - qualityA;
              return (b.bitrate || 0) - (a.bitrate || 0);
            })[0];
        }
        
        // Fallback: accepter n'importe quel format avec vidéo+audio intégré
        if (!bestFormat) {
          console.log('⚠️ Aucun format HD trouvé, recherche de n\'importe quel format avec vidéo+audio intégré...');
          bestFormat = videoFormats
            .filter(f => f.hasVideo && f.hasAudio && f.qualityLabel && f.url)
            .sort((a, b) => {
              const qualityA = getQualityValue(a.qualityLabel);
              const qualityB = getQualityValue(b.qualityLabel);
              return qualityB - qualityA;
            })[0];
        }
        
        // Dernier recours: format vidéo avec URL valide (même sans audio)
        if (!bestFormat) {
          console.log('⚠️ Aucun format optimal trouvé, utilisation du premier format vidéo avec URL disponible...');
          bestFormat = videoFormats.find(f => f.hasVideo && f.url);
        }

        if (!bestFormat) {
          throw new Error('Aucun format vidéo disponible');
        }

        const qualityLabel = bestFormat.qualityLabel || 'Inconnue';
        const qualityValue = getQualityValue(qualityLabel);
        console.log(`🎬 Format YouTube sélectionné: ${qualityLabel} (${qualityValue}p, itag: ${bestFormat.itag}, bitrate: ${bestFormat.bitrate || 'N/A'})`);
        console.log(`🔊 Audio intégré: ${bestFormat.hasAudio ? '✅ Oui' : '❌ Non'} | URL valide: ${bestFormat.url ? '✅ Oui' : '❌ Non'}`);

        // Streamer la vidéo YouTube directement
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="youtube-${videoId}.mp4"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // Créer un stream de passage pour le cache
        const passThrough = new PassThrough();
        const writeStream = fs.createWriteStream(cachedVideoPath);

        console.log('🎬 Début du streaming YouTube...');
        console.log(`📹 Format sélectionné: ${bestFormat.qualityLabel || 'Inconnu'} (itag: ${bestFormat.itag}), Audio intégré: ${bestFormat.hasAudio ? 'Oui' : 'Non'}`);
        
        // Vérifier que le format a bien une URL
        if (!bestFormat.url) {
          throw new Error('Le format sélectionné n\'a pas d\'URL valide');
        }
        
        // Utiliser ytdl.downloadFromInfo() pour obtenir un stream valide
        // Les URLs directes sont temporaires et liées à l'IP, donc il faut re-télécharger
        console.log('📡 Utilisation de ytdl.downloadFromInfo() pour obtenir un stream valide');
        
        // Streamer depuis YouTube avec headers appropriés et configuration optimisée
        const videoStream = ytdl.downloadFromInfo(info, {
          format: bestFormat,
          quality: 'highest',
          requestOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://www.youtube.com/',
              'Accept': '*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Origin': 'https://www.youtube.com',
              'Accept-Encoding': 'gzip, deflate, br',
              'Connection': 'keep-alive',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'cross-site'
            }
          }
        });

        // Gestion des erreurs AVANT le pipe avec fallback yt-dlp (streaming direct)
        videoStream.on('error', async (error) => {
          console.error('❌ Erreur de stream YouTube avec ytdl-core:', error.message);
          
          // Si erreur 403 ou autre erreur de téléchargement, essayer yt-dlp comme fallback avec streaming direct
          if ((error.statusCode === 403 || error.code === 'ERR_BAD_REQUEST' || error.message.includes('403') || error.message.includes('Forbidden')) && !res.headersSent) {
            console.log('🔄 Tentative de fallback avec yt-dlp (streaming direct)...');
            
            try {
              // Obtenir l'URL directe avec yt-dlp (sans télécharger)
              const ytdlpUrl = await getYouTubeDirectUrlWithYtDlp(normalizedUrl, bestFormat.itag);
              
              if (ytdlpUrl) {
                console.log('✅ URL directe obtenue avec yt-dlp, streaming direct...');
                
                // Streamer directement depuis l'URL (comme TikTok)
                const videoResponse = await axios.get(ytdlpUrl, {
                  responseType: 'stream',
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.youtube.com/',
                    'Origin': 'https://www.youtube.com'
                  },
                  timeout: 45000,
                  httpsAgent: httpsAgent
                });
                
                // Créer un stream de passage pour le cache
                const passThroughYtDlp = new PassThrough();
                const writeStreamYtDlp = fs.createWriteStream(cachedVideoPath);
                
                // Définir les headers pour le téléchargement
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Content-Disposition', `attachment; filename="youtube-${videoId}.mp4"`);
                res.setHeader('Content-Length', videoResponse.headers['content-length'] || '');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                
                // Dupliquer le stream : un vers le client, un vers le cache (comme TikTok)
                videoResponse.data.pipe(passThroughYtDlp);
                videoResponse.data.pipe(writeStreamYtDlp);
                passThroughYtDlp.pipe(res);
                
                // Gestion des erreurs
                videoResponse.data.on('error', (streamError) => {
                  console.error('❌ Erreur de stream yt-dlp:', streamError);
                  if (!res.headersSent) {
                    res.status(500).json({ error: 'Erreur de streaming yt-dlp' });
                  }
                });
                
                writeStreamYtDlp.on('error', (writeError) => {
                  console.error('❌ Erreur d\'écriture du cache yt-dlp:', writeError);
                });
                
                writeStreamYtDlp.on('finish', () => {
                  const finalStats = fs.existsSync(cachedVideoPath) ? fs.statSync(cachedVideoPath) : null;
                  if (finalStats && finalStats.size > 1024) {
                    console.log(`✅ Vidéo YouTube mise en cache via yt-dlp: ${cachedVideoPath} (${(finalStats.size / 1024 / 1024).toFixed(2)} MB)`);
                  } else {
                    if (fs.existsSync(cachedVideoPath)) {
                      fs.unlinkSync(cachedVideoPath);
                    }
                  }
                });
                
                passThroughYtDlp.on('end', () => {
                  console.log('✅ Streaming YouTube via yt-dlp terminé');
                });
                
                return; // Sortir de la fonction
              } else {
                throw new Error('Impossible d\'obtenir l\'URL directe avec yt-dlp');
              }
            } catch (ytdlpError) {
              console.error('❌ yt-dlp streaming a échoué, tentative de téléchargement complet...', ytdlpError.message);
              
              // Dernier recours : téléchargement complet avec yt-dlp
              try {
                await downloadYouTubeWithYtDlp(normalizedUrl, cachedVideoPath);
                
                const stats = fs.statSync(cachedVideoPath);
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Content-Disposition', `attachment; filename="youtube-${videoId}.mp4"`);
                res.setHeader('Content-Length', stats.size);
                res.setHeader('Cache-Control', 'public, max-age=3600');
                
                const fileStream = fs.createReadStream(cachedVideoPath);
                fileStream.pipe(res);
                
                fileStream.on('end', () => {
                  console.log('✅ Stream depuis yt-dlp (téléchargement complet) terminé');
                });
                
                return;
              } catch (finalError) {
                console.error('❌ yt-dlp a complètement échoué:', finalError.message);
              }
            }
          }
          
          // Nettoyer le cache en cas d'erreur
          if (fs.existsSync(cachedVideoPath)) {
            try {
              fs.unlinkSync(cachedVideoPath);
              console.log('🗑️ Cache corrompu supprimé après erreur de stream');
            } catch (unlinkError) {
              console.error('❌ Erreur lors de la suppression du cache:', unlinkError);
            }
          }
          
          if (!res.headersSent) {
            res.status(500).json({ 
              error: 'Erreur de téléchargement YouTube',
              message: error.message 
            });
          } else {
            res.end();
          }
        });

        writeStream.on('error', (error) => {
          console.error('❌ Erreur d\'écriture du cache:', error);
          // Supprimer le fichier partiel en cas d'erreur d'écriture
          if (fs.existsSync(cachedVideoPath)) {
            try {
              fs.unlinkSync(cachedVideoPath);
              console.log('🗑️ Fichier cache partiel supprimé');
            } catch (unlinkError) {
              console.error('❌ Erreur lors de la suppression:', unlinkError);
            }
          }
          // Ne pas arrêter le stream vers le client si le cache échoue
        });

        writeStream.on('finish', () => {
          const finalStats = fs.existsSync(cachedVideoPath) ? fs.statSync(cachedVideoPath) : null;
          if (finalStats && finalStats.size > 1024) {
            console.log(`✅ Vidéo YouTube mise en cache: ${cachedVideoPath} (${(finalStats.size / 1024 / 1024).toFixed(2)} MB)`);
          } else {
            console.log('⚠️ Cache YouTube incomplet ou corrompu, suppression...');
            if (fs.existsSync(cachedVideoPath)) {
              fs.unlinkSync(cachedVideoPath);
            }
          }
        });

        // Dupliquer le stream : un vers le client, un vers le cache
        videoStream.pipe(passThrough);
        videoStream.pipe(writeStream);
        passThrough.pipe(res);
        
        // Gérer la fin du stream
        passThrough.on('end', () => {
          console.log('✅ Streaming YouTube terminé');
        });
        
        // Gérer les erreurs de stream pour nettoyer le cache si nécessaire
        videoStream.on('end', () => {
          // Vérifier l'intégrité du fichier après téléchargement
          setTimeout(() => {
            if (fs.existsSync(cachedVideoPath)) {
              const stats = fs.statSync(cachedVideoPath);
              if (stats.size < 1024) {
                console.log('⚠️ Fichier cache YouTube corrompu détecté après téléchargement, suppression...');
                fs.unlinkSync(cachedVideoPath);
              }
            }
          }, 1000);
        });

        return;

      } catch (error) {
        console.error('❌ Erreur YouTube complète:', error);
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Erreur de téléchargement YouTube',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }
        return;
      }
    } else {
      // 📱 TRAITEMENT TIKTOK (code existant)
      // Résoudre l'URL courte si nécessaire (avec cache)
      if (url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com')) {
        url = await resolveTikTokUrl(url);
      }

      // Utilisation de TikWM avec cache des métadonnées
      let videoUrl;
      if (metadataCache.has(url)) {
        console.log('🚀 Utilisation des métadonnées en cache');
        const cached = metadataCache.get(url);
        videoUrl = cached.data.downloadUrl;
      } else {
        console.log('🔍 Récupération des métadonnées via TikWM...');
        const tikwmResponse = await axios.get(`https://tikwm.com/api?url=${encodeURIComponent(url)}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          timeout: 12000,
          httpsAgent: httpsAgent
        });

        if (tikwmResponse.data && tikwmResponse.data.code === 0 && tikwmResponse.data.data) {
          videoUrl = tikwmResponse.data.data.play || tikwmResponse.data.data.wmplay;
        } else {
          throw new Error('TikWM n\'a pas pu récupérer la vidéo');
        }
      }
      
      if (videoUrl) {
        console.log(`🎬 URL vidéo trouvée: ${videoUrl}`);
        
        // Télécharger la vidéo avec streaming optimisé
        const videoResponse = await axios.get(videoUrl, {
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.tiktok.com/'
          },
          timeout: 45000, // Réduit de 60s à 45s
          httpsAgent: httpsAgent
        });

        // Créer un stream de passage pour le cache
        const passThrough = new PassThrough();
        const writeStream = fs.createWriteStream(cachedVideoPath);
        
        // Définir les headers pour le téléchargement
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="tiktok-${videoId}.mp4"`);
        res.setHeader('Content-Length', videoResponse.headers['content-length'] || '');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // Dupliquer le stream : un vers le client, un vers le cache
        videoResponse.data.pipe(passThrough);
        videoResponse.data.pipe(writeStream);
        passThrough.pipe(res);

        // Gestion des erreurs
        videoResponse.data.on('error', (error) => {
          console.error('❌ Erreur de stream vidéo:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Erreur de téléchargement de la vidéo' });
          }
        });

        writeStream.on('error', (error) => {
          console.error('❌ Erreur d\'écriture du cache:', error);
        });

        writeStream.on('finish', () => {
          console.log(`✅ Vidéo mise en cache: ${cachedVideoPath}`);
        });

      } else {
        throw new Error('Aucune URL vidéo trouvée');
      }
    }

  } catch (error) {
    console.error('❌ Erreur de téléchargement proxy:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Erreur de téléchargement',
        message: 'Impossible de télécharger la vidéo',
        debug: error.message
      });
    }
  }
});

// Gestion des routes non trouvées
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route non trouvée',
    message: 'L\'endpoint demandé n\'existe pas'
  });
});

// Gestion globale des erreurs
app.use((error, req, res, next) => {
  console.error('Erreur serveur:', error);
  res.status(500).json({
    error: 'Erreur interne du serveur',
    message: 'Une erreur inattendue s\'est produite'
  });
});

// Démarrage du serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur TikTok Downloader démarré sur le port ${PORT}`);
  console.log(`💻 Local:     http://localhost:${PORT}/api/health`);
  console.log(`📱 LAN (${LAN_IP}): http://${LAN_IP}:${PORT}/api/health`);
});

module.exports = app;
