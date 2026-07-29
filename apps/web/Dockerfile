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

# Runtime NON-ROOT (lot A6) : nginx-unprivileged = nginx officiel dont le master
# tourne déjà en user `nginx` (uid 101), pid et fichiers temporaires déplacés vers
# /tmp (écrivables sans root). On CONSERVE l'écoute sur le port 80 : le mapping du
# tunnel Cloudflare (dashboard Zero Trust → http://web:80), le Caddyfile
# (`reverse_proxy web:80`) et les ports publiés dev/staging (4200:80, 4210:80)
# restent inchangés. Un process non-root PEUT se lier au port 80 en conteneur :
# Docker ≥ 20.10 pose net.ipv4.ip_unprivileged_port_start=0 dans le netns de
# chaque conteneur (vérifié en prod, Docker 29.5.3).
FROM --platform=linux/amd64 nginxinc/nginx-unprivileged:alpine AS runtime
# Durcissement chaîne d'appro (AUD-06, doc 25) : correctifs de sécurité des paquets
# OS du base image Alpine (scan Trivy bloquant sur les CVE HIGH/CRITICAL corrigibles).
# Le tag `nginx-unprivileged:alpine` est mouvant et le cache de couche buildx (gha,
# scope `web`) peut figer cet `apk upgrade` sur d'anciens paquets → l'image scannée
# reste vulnérable même si le correctif est publié en amont. `OS_PATCH` (jeton daté
# référencé dans le RUN) invalide cette couche quand une CVE base image doit être
# repassée ; l'incrémenter à la prochaine occurrence. 2026-07-08 : libexpat 2.8.2-r0
# corrige CVE-2026-56131/56407/56408 (repo Alpine v3.23 main, build 2026-06-29).
# 2026-07-10 : c-ares 1.34.8-r0 corrige CVE-2026-33630 (use-after-free, HIGH).
# 2026-07-14 : curl/libcurl 8.20.0-r0 corrige CVE-2026-5773 (mauvais transfert
# de fichier via réutilisation de connexion SMB) et CVE-2026-6276 (fuite de
# cookie en réutilisation de connexion), tous deux HIGH.
# `apk upgrade` exige root → USER root le temps du patch, puis retour à 101.
USER root
ARG OS_PATCH=2026-07-14
RUN echo "os-patch ${OS_PATCH}" && apk upgrade --no-cache
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/web /usr/share/nginx/html
USER 101
EXPOSE 80
