# Image du front web (Phase 8) — SPA statique servie par nginx.
# Étape build : node + pnpm + `nx build web` (sortie dist/apps/web).
# Étape runtime : nginx:alpine sert les assets et proxifie /api vers la gateway.
# (Le Dockerfile générique racine cible les services NestJS `node main.js` ; une
# SPA statique a besoin d'une image distincte.)
FROM --platform=linux/amd64 node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm nx build web --skip-nx-cache

FROM --platform=linux/amd64 nginx:alpine AS runtime
# Durcissement chaîne d'appro (AUD-06, doc 25) : correctifs de sécurité des paquets
# OS du base image Alpine (scan Trivy bloquant sur les CVE corrigibles du pipeline).
RUN apk upgrade --no-cache
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/web /usr/share/nginx/html
EXPOSE 80
