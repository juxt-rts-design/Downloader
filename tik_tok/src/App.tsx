import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  Link2,
  User,
  Heart,
  MessageCircle,
  Share2,
  Eye,
  Clock,
  Loader2,
  Music,
  Play,
  Clipboard,
  X,
  Sparkles,
  Zap,
  Smartphone,
  Image as ImageIcon,
  AudioWaveform,
  Rocket,
  AlertCircle,
} from 'lucide-react'
import { ApiService, type VideoData } from './services/api'
import { config } from './config'
import { DEFAULT_PLATFORM_IDS, PlatformIcon, resolvePlatform } from './platforms'
import './App.css'

// Interface VideoData est maintenant importée depuis le service API

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function sanitizeMediaUrl(value: string): string {
  const text = value.trim()
  const parts = text.split(/(?=https?:\/\/)/i).filter(Boolean)
  if (parts.length > 1 && /^https?:\/\//i.test(parts[0])) {
    return parts[0].trim()
  }
  return text
}

function youtubeThumbnail(pageUrl: string): string | null {
  const match = pageUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/)
  return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : null
}

function triggerFileDownload(href: string, fileName: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  link.rel = 'noopener noreferrer'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

async function downloadViaBlob(href: string, fileName: string) {
  const response = await fetch(href)
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json()
      detail = payload.message || payload.error || ''
    } catch {
      detail = ''
    }
    throw new Error(detail || 'Téléchargement échoué')
  }
  const blob = await response.blob()
  if (blob.size < 1024) {
    throw new Error('Fichier vide (0 octet)')
  }
  const objectUrl = URL.createObjectURL(blob)
  triggerFileDownload(objectUrl, fileName)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
}

function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [videoData, setVideoData] = useState<VideoData | null>(null)
  const [error, setError] = useState('')
  const [performance, setPerformance] = useState({ startTime: 0, endTime: 0, duration: 0 })
  // const [cacheStats, setCacheStats] = useState(null) // Non utilisé pour l'instant
  const [downloading, setDownloading] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const catcherRef = useRef<HTMLInputElement>(null)
  const inputWrapRef = useRef<HTMLDivElement>(null)
  const [isTouch, setIsTouch] = useState(
    () => typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  )

  useEffect(() => {
    setIsTouch(navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  }, [])

  const focusCatcher = () => {
    const el = catcherRef.current
    if (!el) return
    el.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (url || !isTouch) return

    focusCatcher()
    const id = window.setTimeout(focusCatcher, 50)

    const prime = (event: Event) => {
      const wrap = inputWrapRef.current
      const target = event.target
      if (!wrap || !(target instanceof Node) || !wrap.contains(target)) return
      focusCatcher()
    }

    document.addEventListener('touchstart', prime, { capture: true, passive: true })
    document.addEventListener('pointerdown', prime, { capture: true, passive: true })
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('touchstart', prime, true)
      document.removeEventListener('pointerdown', prime, true)
    }
  }, [url, isTouch])

  const applyPastedLink = (raw: string) => {
    const clean = sanitizeMediaUrl(raw)
    if (!clean) return
    setUrl(clean)
    setError('')
    void analyzeLink(clean)
  }

  const handlePaste = async () => {
    try {
      if (!navigator.clipboard?.readText) return
      const text = await navigator.clipboard.readText()
      if (text.trim()) applyPastedLink(text)
    } catch {
      urlInputRef.current?.focus()
    }
  }

  const handleClear = () => {
    setUrl('')
    setVideoData(null)
    setError('')
  }

  const analyzeLink = useCallback(async (raw?: string) => {
    try {
      const cleanUrl = sanitizeMediaUrl(raw ?? url)
      if (cleanUrl !== url) {
        setUrl(cleanUrl)
      }

      if (!cleanUrl) {
        setError('Colle un lien (TikTok, YouTube, Instagram, X…)')
        return
      }

      if (!isHttpUrl(cleanUrl)) {
        setError('Colle une URL http(s) valide')
        return
      }

      // Mesure de performance
      const startTime = Date.now()
      setPerformance({ startTime, endTime: 0, duration: 0 })
      
      setLoading(true)
      setError('')
      setVideoData(null)

      try {
        // Test de connexion au backend d'abord
        const isBackendAvailable = await ApiService.isBackendAvailable()
        if (!isBackendAvailable) {
          setError('Backend non accessible. Vérifiez que le serveur est démarré.')
          return
        }
        
        // Télécharger la vidéo via le service API
        const response = await ApiService.downloadVideo(cleanUrl)

        const endTime = Date.now()
        const duration = Math.round(endTime - startTime)
        
        setPerformance({ startTime, endTime, duration })

        if (response.success && response.data) {
          setVideoData(response.data)
        } else {
          setError(response.message || 'Erreur lors du téléchargement')
        }
      } catch (err: any) {
        console.error('Erreur API:', err)
        if (err.response) {
          // Le serveur a répondu avec une erreur
          const errorMessage = err.response.data?.message || err.response.data?.error || 'Erreur serveur'
          setError(errorMessage)
        } else if (err.request) {
          // La requête a été faite mais pas de réponse
          setError('Le serveur ne répond pas. Vérifiez que le backend est démarré.')
        } else {
          // Erreur lors de la configuration de la requête
          setError('Erreur de connexion au serveur: ' + (err.message || 'Erreur inconnue'))
        }
      } finally {
        setLoading(false)
      }
    } catch (globalErr: any) {
      setError('Erreur inattendue: ' + globalErr.message)
      setLoading(false)
    }
  }, [url])

  const handleDownloadVideo = async () => {
    if (videoData?.source === 'cobalt' && videoData.downloadUrl) {
      setDownloading(true)
      setError('')
      try {
        const fileName = videoData.filename || `${videoData.platform || 'media'}.mp4`
        await downloadViaBlob(videoData.downloadUrl, fileName)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossible de lancer le téléchargement')
      } finally {
        setDownloading(false)
      }
      return
    }

    if (videoData) {
      setDownloading(true)
      setError('')
      
      try {
        // Gestion spéciale pour les images TikTok
        if ((videoData as any).isStaticVideo || (videoData as any).needsCombining) {
          // Pour les images TikTok, obtenir les URLs via l'API backend
          console.log('🖼️ Image TikTok détectée - récupération des URLs...')
          
          try {
            // Appeler l'API backend pour obtenir les URLs
            const combineResponse = await fetch(`${config.backend.baseUrl}/api/combine-image-audio`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                imageUrl: (videoData as any).combinedVideo?.imageUrl || videoData.thumbnail,
                audioUrl: (videoData as any).combinedVideo?.audioUrl || videoData.audioUrl,
                duration: (videoData as any).combinedVideo?.duration || 10
              })
            })

            if (combineResponse.ok) {
              const combineData = await combineResponse.json()
              console.log('🔗 URLs obtenues:', combineData)
              
              if (combineData.success) {
                // Télécharger l'image
                const imageUrl = combineData.data.imageUrl
                const audioUrl = combineData.data.audioUrl
                
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                
                if (isMobile) {
                  // Sur mobile : télécharger l'image
                  const link = document.createElement('a')
                  link.href = imageUrl
                  link.download = `tiktok-image-${videoData.id}.jpg`
                  link.style.display = 'none'
                  
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                  
                  // Afficher un message pour l'audio
                  if (audioUrl) {
                    setError('Image téléchargée ! Pour l\'audio, utilisez le bouton MP3 ci-dessous.')
                    setTimeout(() => setError(''), 5000)
                  }
                  
                  setTimeout(() => setDownloading(false), 500)
                } else {
                  // Sur PC : télécharger l'image
                  const link = document.createElement('a')
                  link.href = imageUrl
                  link.download = `tiktok-image-${videoData.id}.jpg`
                  link.target = '_blank'
                  link.rel = 'noopener noreferrer'
                  link.style.display = 'none'
                  
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                  
                  // Afficher un message pour l'audio
                  if (audioUrl) {
                    setError('Image téléchargée ! Pour l\'audio, utilisez le bouton MP3 ci-dessous.')
                    setTimeout(() => setError(''), 5000)
                  }
                  
                  setDownloading(false)
                }
              } else {
                throw new Error('Erreur lors de la récupération des URLs')
              }
            } else {
              throw new Error('Erreur lors de l\'appel à l\'API backend')
            }
          } catch (apiError) {
            console.error('Erreur API backend:', apiError)
            setError('Erreur lors de la récupération des URLs. Téléchargement direct de l\'image.')
            
            // Fallback : télécharger l'image directement
            const imageUrl = (videoData as any).combinedVideo?.imageUrl || videoData.thumbnail
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            
            if (isMobile) {
              const link = document.createElement('a')
              link.href = imageUrl
              link.download = `tiktok-image-${videoData.id}.jpg`
              link.style.display = 'none'
              
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
              
              setTimeout(() => setDownloading(false), 500)
            } else {
              const link = document.createElement('a')
              link.href = imageUrl
              link.download = `tiktok-image-${videoData.id}.jpg`
              link.target = '_blank'
              link.rel = 'noopener noreferrer'
              link.style.display = 'none'
              
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
              setDownloading(false)
            }
          }
          return
        }
        
        // Utiliser le proxy backend pour TikTok ET YouTube (les URLs YouTube nécessitent des headers spéciaux)
        const proxyUrl = ApiService.getDownloadProxyUrl(videoData.id, url, videoData.platform)
        
        // Détecter si on est sur mobile
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        
        const fileName = videoData.platform === 'youtube' 
          ? `youtube-${videoData.id}.mp4`
          : `tiktok-${videoData.id}.mp4`
        
        if (isMobile) {
          // Sur mobile : téléchargement via proxy sans ouverture d'onglet
          const link = document.createElement('a')
          link.href = proxyUrl
          link.download = fileName
          link.style.display = 'none'
          
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          
          // Retour immédiat à la page
          setTimeout(() => {
            setDownloading(false)
          }, 500)
        } else {
          // Sur PC : comportement normal via proxy
          const link = document.createElement('a')
          link.href = proxyUrl
          link.download = fileName
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.style.display = 'none'
          
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          
          // Simuler un délai pour l'UI
          setTimeout(() => {
            setDownloading(false)
          }, 2000)
        }
        
      } catch (error) {
        setDownloading(false)
        
        // Fallback : téléchargement direct si disponible
        const fallbackUrl = videoData.downloadUrl || videoData.video?.url
        if (fallbackUrl) {
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
          const fileName = videoData.platform === 'youtube' 
            ? `youtube-${videoData.id}.mp4`
            : `tiktok-${videoData.id}.mp4`
          
          if (isMobile) {
            // Sur mobile : téléchargement direct sans ouverture d'onglet
            const link = document.createElement('a')
            link.href = fallbackUrl
            link.download = fileName
            link.style.display = 'none'
            
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            
            setTimeout(() => setDownloading(false), 500)
          } else {
            // Sur PC : comportement normal
            const link = document.createElement('a')
            link.href = fallbackUrl
            link.download = fileName
            link.target = '_blank'
            link.rel = 'noopener noreferrer'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            setDownloading(false)
          }
        } else {
          setError('Impossible de télécharger la vidéo')
        }
      }
    } else {
      setError('Aucune vidéo à télécharger')
    }
  }

  const handleDownloadAudio = async () => {
    if (videoData?.source === 'cobalt' || videoData?.canExtractAudio) {
      setDownloading(true)
      setError('')
      try {
        const response = await ApiService.downloadVideo(sanitizeMediaUrl(url), { audioOnly: true })
        if (response.success && response.data?.downloadUrl) {
          const fileName = response.data.filename || `audio-${response.data.id}.mp3`
          await downloadViaBlob(response.data.downloadUrl, fileName)
        } else {
          setError(response.message || 'Impossible d’extraire l’audio')
        }
      } catch (err: unknown) {
        const message = err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : null
        setError(message || 'Erreur lors de l’extraction audio')
      } finally {
        setTimeout(() => setDownloading(false), 600)
      }
      return
    }

    if (videoData?.audioUrl) {
      try {
        // Détecter si on est sur mobile
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        
        if (isMobile) {
          // Sur mobile : téléchargement direct sans ouverture d'onglet
          const link = document.createElement('a')
          link.href = videoData.audioUrl
          link.download = `tiktok-audio-${videoData.id}.mp3`
          link.style.display = 'none'
          
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
        } else {
          // Sur PC : comportement normal
          const link = document.createElement('a')
          link.href = videoData.audioUrl
          link.download = `tiktok-audio-${videoData.id}.mp3`
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.style.display = 'none'
          
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
        }
      } catch (error) {
        window.open(videoData.audioUrl, '_blank', 'noopener,noreferrer')
      }
    } else {
      setError('Aucun fichier audio à télécharger')
    }
  }

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M'
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }



  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <p className="brand-kicker">Downloader</p>
          <h1 className="logo">HEXARO</h1>
          <p className="subtitle">
            Colle un lien. Le fichier arrive. TikTok, YouTube, Instagram, X et 17 autres.
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        <div className="container">
          <div className="download-section">
            {/* Input Section */}
            <div className="input-group">
              <div className="input-wrapper" ref={inputWrapRef}>
                <Link2 className="input-icon" strokeWidth={2} aria-hidden />
                <input
                  ref={urlInputRef}
                  id="hexaro-url"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void analyzeLink()
                    }
                  }}
                  onPaste={(e) => {
                    const pastedText = e.clipboardData.getData('text')
                    if (pastedText && pastedText.trim()) {
                      e.preventDefault()
                      applyPastedLink(pastedText)
                    }
                  }}
                  placeholder="Colle un lien — l’analyse part toute seule"
                  enterKeyHint="go"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="url-input"
                  disabled={loading}
                />
                {!url && isTouch && (
                  <input
                    ref={catcherRef}
                    className="paste-catcher"
                    type="text"
                    inputMode="url"
                    enterKeyHint="go"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Colle un lien"
                    autoFocus
                    disabled={loading}
                    onTouchStart={focusCatcher}
                    onPaste={(e) => {
                      const pastedText = e.clipboardData.getData('text')
                      if (pastedText.trim()) {
                        e.preventDefault()
                        e.currentTarget.value = ''
                        applyPastedLink(pastedText)
                      }
                    }}
                    onChange={(e) => {
                      const text = e.target.value
                      e.target.value = ''
                      if (!text.trim()) return
                      if (/https?:\/\//i.test(text) || text.length > 15) {
                        applyPastedLink(text)
                      } else {
                        setUrl(text)
                      }
                    }}
                  />
                )}
                <div className={`input-actions${!url && isTouch ? ' input-actions-deco' : ''}`}>
                  {!url && isTouch && (
                    <span className="paste-btn" aria-hidden>
                      <Clipboard size={18} strokeWidth={2} />
                    </span>
                  )}
                  {!url && !isTouch && (
                    <button
                      type="button"
                      onClick={handlePaste}
                      disabled={loading}
                      className="paste-btn"
                      title="Coller depuis le presse-papiers"
                    >
                      <Clipboard size={18} strokeWidth={2} aria-hidden />
                    </button>
                  )}
                  {url && (
                    <button
                      onClick={handleClear}
                      disabled={loading}
                      className="clear-btn"
                      title="Effacer"
                    >
                      <X size={18} strokeWidth={2} aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              {loading && (
                <p className="search-status" aria-live="polite">
                  <Loader2 className="spinner" strokeWidth={2} aria-hidden />
                  Recherche du média…
                </p>
              )}
              {!loading && (
                <p className="search-hint">Pas de bouton : colle, ou appuie sur Entrée.</p>
              )}
            </div>

            <ul className="platform-grid" aria-label="Réseaux pris en charge">
              {DEFAULT_PLATFORM_IDS.map((id) => {
                const meta = resolvePlatform(id)
                return (
                  <li key={id} className="platform-chip" title={meta.label}>
                    <span className="platform-chip-icon" style={{ color: meta.color }}>
                      <PlatformIcon id={meta.id} />
                    </span>
                    <span>{meta.label}</span>
                  </li>
                )
              })}
            </ul>

            {/* Error Message */}
            {error && (
              <div className="error-message" role="alert">
                <AlertCircle className="error-icon" strokeWidth={2} aria-hidden />
                <span className="error-text">{error}</span>
              </div>
            )}


            {/* Video Result */}
            {videoData && (
              <div className="video-result">
                {videoData.picker && videoData.picker.length > 0 && (
                  <div className="picker-grid">
                    {videoData.picker.map((item, index) => (
                      <button
                        key={`${item.url}-${index}`}
                        type="button"
                        className="picker-item"
                        onClick={() =>
                          triggerFileDownload(
                            item.url,
                            `${videoData.platform || 'media'}-${index + 1}.${item.type === 'photo' ? 'jpg' : 'mp4'}`
                          )
                        }
                      >
                        {item.thumb || item.type === 'photo' ? (
                          <img src={item.thumb || item.url} alt="" />
                        ) : (
                          <Play className="play-icon" strokeWidth={1.75} aria-hidden />
                        )}
                        <span>{item.type === 'photo' ? 'Image' : item.type === 'gif' ? 'GIF' : 'Vidéo'}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Video Preview */}
                <div className="video-preview">
                  {/* Gestion des images TikTok avec son */}
                  {(videoData as any).isStaticVideo || (videoData as any).needsCombining ? (
                    <div className="image-tiktok-container">
                      <div className="image-tiktok-badge">
                        <ImageIcon size={14} strokeWidth={2} aria-hidden />
                        <span>Image TikTok</span>
                      </div>
                      <img
                        src={(videoData as any).combinedVideo?.imageUrl || videoData.thumbnail}
                        alt="Image TikTok"
                        className="video-thumbnail"
                      />
                      {/* Audio pour les images TikTok */}
                      <audio
                        src={(videoData as any).combinedVideo?.audioUrl || videoData.audioUrl}
                        controls
                        loop
                        className="image-audio"
                        preload="metadata"
                      />
                      <div className="image-tiktok-note">
                        <ImageIcon size={14} strokeWidth={2} aria-hidden />
                        <span>Image</span>
                        <span className="image-tiktok-note-sep" aria-hidden>
                          +
                        </span>
                        <AudioWaveform size={14} strokeWidth={2} aria-hidden />
                        <span>Audio</span>
                      </div>
                    </div>
                  ) : (
                    // Affichage normal pour les vidéos
                    videoData.platform === 'youtube' ? (
                      youtubeThumbnail(url) || videoData.thumbnail ? (
                        <img
                          src={youtubeThumbnail(url) || videoData.thumbnail || ''}
                          alt="Aperçu YouTube"
                          className="video-thumbnail"
                        />
                      ) : (
                        <div className="video-placeholder">
                          <Play className="play-icon" strokeWidth={1.75} aria-hidden />
                        </div>
                      )
                    ) : videoData.thumbnail ? (
                      <img
                        src={videoData.thumbnail}
                        alt="Aperçu"
                        className="video-thumbnail"
                      />
                    ) : (
                      <div className="video-placeholder">
                        <Play className="play-icon" strokeWidth={1.75} aria-hidden />
                      </div>
                    )
                  )}
                  
                  {/* Overlay */}
                  <div className="video-overlay">
                    <div className="video-overlay-actions">
                      <button
                        type="button"
                        onClick={handleDownloadVideo}
                        className="download-video-btn"
                        disabled={downloading}
                      >
                        <Download strokeWidth={2} aria-hidden />
                        {downloading
                          ? 'Téléchargement…'
                          : (videoData as any).isStaticVideo || (videoData as any).needsCombining
                            ? 'Image'
                            : videoData.platform === 'youtube'
                              ? 'MP4 HD'
                              : 'MP4'}
                      </button>
                      {(videoData.audioUrl || videoData.canExtractAudio) && (
                        <button
                          type="button"
                          onClick={handleDownloadAudio}
                          className="download-audio-btn"
                          disabled={downloading}
                        >
                          <Music strokeWidth={2} aria-hidden />
                          MP3
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Video Info */}
                <div className="video-info">
                  {/* 🚀 Indicateur de performance */}
                  {performance.duration > 0 && (
                    <div className="performance-indicator">
                      <span className="performance-badge">
                        <Zap size={16} strokeWidth={2} aria-hidden />
                        Traité en {performance.duration} ms
                      </span>
                      {performance.duration < 1000 && (
                        <span className="ultra-fast">
                          <Rocket size={14} strokeWidth={2} aria-hidden />
                          Très rapide
                        </span>
                      )}
                    </div>
                  )}
                  
                  {/* Title */}
                  <h3 className="video-title">{videoData.title}</h3>
                  {videoData.platform && (
                    <p className="platform-badge-line">
                      <span className="quality-badge">{videoData.platform}</span>
                      {videoData.source === 'cobalt' && (
                        <span className="file-size">via Cobalt</span>
                      )}
                    </p>
                  )}
                  
                  {/* Author */}
                  {videoData.source !== 'cobalt' && (
                  <div className="author-info">
                    {videoData.author.avatar ? (
                      <img
                        src={videoData.author.avatar}
                        alt={videoData.author.username}
                        className="author-avatar"
                      />
                    ) : (
                      <div className="author-placeholder">
                        <User className="w-6 h-6 text-white" />
                      </div>
                    )}
                    <div>
                      <p className="author-username">@{videoData.author.username}</p>
                      <p className="author-nickname">{videoData.author.nickname}</p>
                    </div>
                  </div>
                  )}

                  {/* Stats */}
                  {videoData.source !== 'cobalt' && (
                  <div className="video-stats">
                    <div className="stat">
                      <div className="stat-header">
                        <Heart className="stat-icon stat-icon--likes" strokeWidth={2} aria-hidden />
                        <span className="text-sm font-medium">Likes</span>
                      </div>
                      <p className="stat-value">{formatNumber(videoData.stats.likes)}</p>
                    </div>
                    <div className="stat">
                      <div className="stat-header">
                        <MessageCircle className="stat-icon stat-icon--comments" strokeWidth={2} aria-hidden />
                        <span className="text-sm font-medium">Comments</span>
                      </div>
                      <p className="stat-value">{formatNumber(videoData.stats.comments)}</p>
                    </div>
                    <div className="stat">
                      <div className="stat-header">
                        <Share2 className="stat-icon stat-icon--shares" strokeWidth={2} aria-hidden />
                        <span className="text-sm font-medium">Shares</span>
                      </div>
                      <p className="stat-value">{formatNumber(videoData.stats.shares)}</p>
                    </div>
                    <div className="stat">
                      <div className="stat-header">
                        <Eye className="stat-icon stat-icon--views" strokeWidth={2} aria-hidden />
                        <span className="text-sm font-medium">Views</span>
                      </div>
                      <p className="stat-value">{formatNumber(videoData.stats.views)}</p>
                    </div>
                    <div className="stat">
                      <div className="stat-header">
                        <Clock className="stat-icon stat-icon--duration" strokeWidth={2} aria-hidden />
                        <span className="text-sm font-medium">Duration</span>
                      </div>
                      <p className="stat-value">{formatDuration(videoData.video.duration)}</p>
                    </div>
                  </div>
                  )}

                  {/* Quality & Size */}
                  <div className="video-quality">
      <div>
                      <span className="quality-badge">{videoData.video.quality}</span>
                    </div>
                    <span className="file-size">
                      {videoData.video.size > 0 
                        ? `${(videoData.video.size / 1024 / 1024).toFixed(1)} MB`
                        : 'Taille inconnue'
                      }
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Features Section */}
          <section className="features" aria-labelledby="features-heading">
            <h2 id="features-heading">Simple, propre, rapide</h2>
            <div className="features-grid">
              <article className="feature">
                <div className="feature-icon-wrap feature-icon-wrap--1">
                  <Sparkles size={26} strokeWidth={1.75} aria-hidden />
                </div>
                <h3>Sans filigrane</h3>
                <p>Fichier net, prêt à garder.</p>
              </article>
              <article className="feature">
                <div className="feature-icon-wrap feature-icon-wrap--2">
                  <Zap size={26} strokeWidth={1.75} aria-hidden />
                </div>
                <h3>Colle et c’est parti</h3>
                <p>Aucun compte, aucun clic en trop.</p>
              </article>
              <article className="feature">
                <div className="feature-icon-wrap feature-icon-wrap--3">
                  <Smartphone size={26} strokeWidth={1.75} aria-hidden />
                </div>
                <h3>Mobile first</h3>
                <p>Conçu pour le pouce, lisible partout.</p>
              </article>
            </div>
          </section>
      </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <div className="footer-content">
            <p>&copy; {new Date().getFullYear()} HEXARO</p>
            <p className="disclaimer">
              Usage personnel uniquement. Respecte les droits d’auteur et les conditions
              des plateformes d’origine.
        </p>
      </div>
        </div>
      </footer>
    </div>
  )
}

export default App