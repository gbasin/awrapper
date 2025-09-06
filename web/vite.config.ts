import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'awrapper',
        short_name: 'awrapper',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/sessions': 'http://localhost:3000',
      '/browse': 'http://localhost:3000',
      '/client-log': 'http://localhost:3000',
    },
  },
})
