import axios, { type AxiosResponse } from 'axios'
import { config } from '../config'

// Types pour les réponses de l'API
export interface HealthResponse {
  status: string
  message: string
  timestamp: string
}

export interface PickerItem {
  type: 'photo' | 'video' | 'gif' | string
  url: string
  thumb?: string | null
}

export interface VideoData {
  id: string
  title: string
  type?: string
  platform?: string
  source?: 'cobalt' | 'legacy'
  filename?: string
  canExtractAudio?: boolean
  cobaltStatus?: string
  picker?: PickerItem[]
  author: {
    username: string
    nickname: string
    avatar: string | null
  }
  video: {
    url: string
    duration: number
    size: number
    quality: string
    format?: any
  }
  thumbnail: string | null
  stats: {
    likes: number
    shares: number
    comments: number
    views: number
  }
  downloadUrl: string
  previewUrl?: string | null
  audioUrl?: string
  formats?: any
  isStaticVideo?: boolean
  combinedVideo?: {
    imageUrl: string
    audioUrl: string
    duration: number
  }
}

export interface DownloadResponse {
  success: boolean
  data?: VideoData
  message?: string
}

export interface CacheStatsResponse {
  videoCache: {
    size: number
    hits: number
    misses: number
    hitRate: number
  }
  apiCache: {
    size: number
    hits: number
    misses: number
    hitRate: number
  }
  totalRequests: number
  averageResponseTime: number
}

export interface TestResponse {
  success: boolean
  message: string
  data?: any
}

// Configuration Axios
const apiClient = axios.create({
  baseURL: config.backend.apiUrl,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Intercepteur pour les erreurs
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Erreur API:', error)
    return Promise.reject(error)
  }
)

// Service API principal
export class ApiService {
  // ===== ROUTES GET (Consultation) =====

  /**
   * Vérifier le statut de l'API
   */
  static async checkHealth(): Promise<HealthResponse> {
    const response: AxiosResponse<HealthResponse> = await apiClient.get('/health')
    return response.data
  }

  /**
   * Tester la connectivité internet
   */
  static async testConnectivity(): Promise<TestResponse> {
    const response: AxiosResponse<TestResponse> = await apiClient.get('/test-connectivity')
    return response.data
  }

  /**
   * Tester l'API TikWM
   */
  static async testVideo(): Promise<TestResponse> {
    const response: AxiosResponse<TestResponse> = await apiClient.get('/test-video')
    return response.data
  }

  /**
   * Tester l'API alternative
   */
  static async testAlternative(): Promise<TestResponse> {
    const response: AxiosResponse<TestResponse> = await apiClient.get('/test-alternative')
    return response.data
  }

  /**
   * Tester avec une vraie URL TikTok
   */
  static async testReal(): Promise<TestResponse> {
    const response: AxiosResponse<TestResponse> = await apiClient.get('/test-real')
    return response.data
  }

  /**
   * Obtenir les statistiques du cache
   */
  static async getCacheStats(): Promise<CacheStatsResponse> {
    const response: AxiosResponse<CacheStatsResponse> = await apiClient.get('/cache-stats')
    return response.data
  }

  // ===== ROUTES POST (Actions) =====

  /**
   * Télécharger une vidéo TikTok
   */
  static async downloadVideo(url: string, options: { audioOnly?: boolean } = {}): Promise<DownloadResponse> {
    const response: AxiosResponse<DownloadResponse> = await apiClient.post('/download', {
      url: url.trim(),
      audioOnly: Boolean(options.audioOnly),
    })
    return response.data
  }

  static async getPlatforms(): Promise<{ success: boolean; services: string[]; version?: string }> {
    const response = await apiClient.get('/platforms')
    return response.data
  }

  /**
   * Vider le cache
   */
  static async clearCache(): Promise<{ success: boolean; message: string }> {
    const response: AxiosResponse<{ success: boolean; message: string }> = await apiClient.post('/clear-cache')
    return response.data
  }

  // ===== ROUTES DE TÉLÉCHARGEMENT DIRECT =====

  /**
   * Obtenir l'URL de téléchargement proxy
   */
  static getDownloadProxyUrl(videoId: string, originalUrl: string, platform?: string): string {
    const platformParam = platform ? `&platform=${platform}` : ''
    return `${config.backend.downloadProxy(videoId, originalUrl)}${platformParam}`
  }

  /**
   * Télécharger directement via le proxy
   */
  static async downloadViaProxy(videoId: string, originalUrl: string): Promise<Blob> {
    const proxyUrl = this.getDownloadProxyUrl(videoId, originalUrl)
    const response = await axios.get(proxyUrl, {
      responseType: 'blob',
      timeout: 60000 // 60 secondes pour les gros fichiers
    })
    return response.data
  }

  // ===== MÉTHODES UTILITAIRES =====

  /**
   * Vérifier si le backend est accessible
   */
  static async isBackendAvailable(): Promise<boolean> {
    try {
      await this.checkHealth()
      return true
    } catch (error) {
      console.error('Backend non accessible:', error)
      return false
    }
  }

  /**
   * Obtenir les informations de performance
   */
  static async getPerformanceInfo(): Promise<{
    backendAvailable: boolean
    healthStatus?: HealthResponse
    cacheStats?: CacheStatsResponse
  }> {
    const backendAvailable = await this.isBackendAvailable()
    
    if (!backendAvailable) {
      return { backendAvailable: false }
    }

    try {
      const [healthStatus, cacheStats] = await Promise.all([
        this.checkHealth(),
        this.getCacheStats()
      ])

      return {
        backendAvailable: true,
        healthStatus,
        cacheStats
      }
    } catch (error) {
      console.error('Erreur lors de la récupération des infos de performance:', error)
      return { backendAvailable: true }
    }
  }

  /**
   * Tester toutes les APIs disponibles
   */
  static async runAllTests(): Promise<{
    health: TestResponse
    connectivity: TestResponse
    video: TestResponse
    alternative: TestResponse
    real: TestResponse
  }> {
    const [health, connectivity, video, alternative, real] = await Promise.allSettled([
      this.checkHealth(),
      this.testConnectivity(),
      this.testVideo(),
      this.testAlternative(),
      this.testReal()
    ])

    return {
      health: health.status === 'fulfilled' 
        ? { success: true, message: health.value.message, data: health.value }
        : { success: false, message: 'Erreur health check' },
      connectivity: connectivity.status === 'fulfilled' ? connectivity.value : { success: false, message: 'Erreur connectivity test' },
      video: video.status === 'fulfilled' ? video.value : { success: false, message: 'Erreur video test' },
      alternative: alternative.status === 'fulfilled' ? alternative.value : { success: false, message: 'Erreur alternative test' },
      real: real.status === 'fulfilled' ? real.value : { success: false, message: 'Erreur real test' }
    }
  }
}

export default ApiService
