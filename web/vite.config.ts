import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import checker from 'vite-plugin-checker'

// Allow overriding the backend API origin/port for dev proxy.
// Defaults to the server's default port (8787).
const API_ORIGIN =
  process.env.AWRAPPER_API_ORIGIN ||
  process.env.API_ORIGIN ||
  `http://127.0.0.1:${process.env.AWRAPPER_API_PORT || process.env.API_PORT || 8787}`

export default defineConfig({
  build: {
    sourcemap: true,
  },
  plugins: [
    react(),
    checker({
      typescript: true,
      eslint: {
        // Use the project-local ESLint config to lint TS/TSX and enforce hooks rules
        lintCommand: 'pnpm run lint',
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Ensure new SW takes control ASAP so new bundles are served immediately
        clientsClaim: true,
        skipWaiting: true,
      },
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
      '/sessions': API_ORIGIN,
      '/browse': API_ORIGIN,
      '/client-log': API_ORIGIN,
    },
  },
})
