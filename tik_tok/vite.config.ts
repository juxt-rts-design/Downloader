import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173
    // HTTPS désactivé temporairement - à réactiver pour iOS 18 + Brave
    // https: {
    //   key: fs.readFileSync('localhost-key.pem'),
    //   cert: fs.readFileSync('localhost.pem'),
    // }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['tik-tok-8gsd.onrender.com']
  }
})
