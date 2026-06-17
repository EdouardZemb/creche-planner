/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// App web (Phase 8) — front React PWA, ESM/Vite. Ne parle qu'au BFF (/api/v1).
// Le dev server proxifie /api vers la gateway (localhost:3000) pour éviter le CORS.
export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  server: {
    port: 4200,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4200,
    host: true,
  },
  build: {
    outDir: '../../dist/apps/web',
    emptyOutDir: true,
    reportCompressedSize: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Cloudflare (prod) : /cdn-cgi/* (connexion/callback Access, etc.) est
        // géré par l'edge — le SW ne doit jamais y répondre avec la coquille
        // en cache, sinon le flux de reconnexion est avalé hors-ligne aussi.
        navigateFallbackDenylist: [/^\/cdn-cgi\//],
      },
      manifest: {
        name: 'Crèche Planner',
        short_name: 'Crèche',
        description:
          'Planifier la garde des enfants et lire le coût mensuel consolidé.',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
