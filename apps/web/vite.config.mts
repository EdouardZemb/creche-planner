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
    // React Compiler (stable 1.0) : mémoïsation automatique des composants/hooks.
    // Cible React 19. La mémoïsation manuelle (useMemo/useCallback/memo) ne doit
    // plus être ajoutée par défaut — seulement après profilage.
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Cloudflare (prod) : /cdn-cgi/* (connexion/callback Access, etc.) est
        // géré par l'edge — le SW ne doit jamais y répondre avec la coquille
        // en cache, sinon le flux de reconnexion est avalé hors-ligne aussi.
        navigateFallbackDenylist: [/^\/cdn-cgi\//],
        // Consultation hors-ligne : cache LECTURE des GET de l'API (dashboard,
        // planning, coûts…). NetworkFirst → en ligne, toujours le réseau
        // d'abord (frais) ; hors-ligne ou > 4 s, repli sur le cache. On ne met
        // JAMAIS en cache les écritures (GET only) ni l'`opaqueredirect` d'Access
        // (status 0) : `statuses: [200]` laisse la session expirée déclencher le
        // flux « Session expirée » au lieu de l'avaler hors-ligne.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-lecture-v1',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
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
            purpose: 'any',
          },
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
