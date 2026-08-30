const isDevelopment = import.meta.env.DEV
const isProduction = import.meta.env.PROD

const envBackend = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '')

function getDefaultBackendUrl(): string {
  if (isDevelopment) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    return `http://${host}:3001`
  }
  // Prod Docker / VPS : même origine (nginx proxy /api → backend)
  return ''
}

export const BACKEND_URL = envBackend !== undefined ? envBackend : getDefaultBackendUrl()

export const API_URL = BACKEND_URL ? `${BACKEND_URL}/api` : '/api'

export const config = {
  backend: {
    baseUrl: BACKEND_URL,
    apiUrl: API_URL,
    healthCheck: `${API_URL}/health`,
    testConnectivity: `${API_URL}/test-connectivity`,
    testVideo: `${API_URL}/test-video`,
    testAlternative: `${API_URL}/test-alternative`,
    testReal: `${API_URL}/test-real`,
    cacheStats: `${API_URL}/cache-stats`,
    download: `${API_URL}/download`,
    clearCache: `${API_URL}/clear-cache`,
    downloadProxy: (videoId: string, url: string) =>
      `${API_URL}/download/${videoId}?url=${encodeURIComponent(url)}`,
  },
  frontend: {
    isDevelopment,
    isProduction,
  },
}

console.log('Configuration chargée:', {
  environment: isDevelopment ? 'development' : 'production',
  backendUrl: BACKEND_URL,
  apiUrl: API_URL,
})
