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
# OS du base image Alpine (scan Trivy bloquant sur les CVE HIGH/CRITICAL corrigibles).
# Le tag `nginx:alpine` est mouvant et le cache de couche buildx (gha, scope `web`)
# peut figer cet `apk upgrade` sur d'anciens paquets → l'image scannée reste
# vulnérable même si le correctif est publié en amont. `OS_PATCH` (jeton daté
# référencé dans le RUN) invalide cette couche quand une CVE base image doit être
# repassée ; l'incrémenter à la prochaine occurrence. 2026-07-08 : libexpat 2.8.2-r0
# corrige CVE-2026-56131/56407/56408 (repo Alpine v3.23 main, build 2026-06-29).
# 2026-07-10 : c-ares 1.34.8-r0 corrige CVE-2026-33630 (use-after-free, HIGH).
# 2026-07-14 : curl/libcurl 8.20.0-r0 corrige CVE-2026-5773 (mauvais transfert
# de fichier via réutilisation de connexion SMB) et CVE-2026-6276 (fuite de
# cookie en réutilisation de connexion), tous deux HIGH.
ARG OS_PATCH=2026-07-14
RUN echo "os-patch ${OS_PATCH}" && apk upgrade --no-cache
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/web /usr/share/nginx/html
EXPOSE 80
