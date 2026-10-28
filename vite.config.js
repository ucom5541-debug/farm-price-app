
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Farm Dashboard',
        short_name: 'Farm Dashboard',
        description: 'ระบบจัดการฟาร์มและติดตามราคาพืชผัก',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5faf6',
        theme_color: '#176b42',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        runtimeCaching: []
      }
    })
  ]
})
