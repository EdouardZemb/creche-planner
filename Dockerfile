# Image multi-stage **par service** des services NestJS du monorepo (DEC-09).
# Le service ciblé est passé via l'argument de build APP (ex. api-gateway,
# svc-tarification). Au lieu d'embarquer tout le workspace construit, on ne
# transporte vers l'image finale que le bundle du service (`dist/main.js`, libs
# workspace déjà inlinées par webpack) + un `node_modules` **élagué** installé à
# partir du lockfile produit par le target `prune` (`@nx/js:prune-lockfile`).

# --- Stage 1 : build + prune ------------------------------------------------
# Construit le service et génère son artefact élagué dans apps/$APP/dist :
#   - main.js (bundle ; libs @creche-planner/* inlinées),
#   - database/migrations (assets),
#   - package.json + pnpm-lock.yaml élagués (deps tierces du seul service),
#   - workspace_modules/ (libs locales, référencées en file: par le lockfile).
FROM --platform=linux/amd64 node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
# `--frozen-lockfile` : l'arbre construit ici doit être EXACTEMENT celui que la CI
# a audité (`pnpm audit --prod`, Trivy). En `--no-frozen-lockfile`, un manifeste
# désynchronisé se « corrige » silencieusement en re-résolvant des versions — les
# portes de sécurité validaient alors un arbre qui n'est pas celui livré (LE-27).
# Le stage 2 garde son `--no-frozen-lockfile`, pour la raison écrite juste au-dessus
# de lui : il installe à partir d'un package.json qu'on vient délibérément de réécrire.
RUN pnpm install --frozen-lockfile
ARG APP
RUN pnpm nx prune "$APP" --skip-nx-cache

# --- Stage 2 : dépendances de production élaguées ---------------------------
# N'installe QUE les dépendances tierces du service ciblé, à partir du lockfile
# élagué. `workspace_modules` doit être présent (références file:) ; les libs y
# sont déjà inlinées dans main.js, mais le lockfile les exige à l'installation.
FROM --platform=linux/amd64 node:24-slim AS deps
WORKDIR /app
RUN corepack enable
# Le package.json élagué (généré par `nx prune`) ne porte PAS le champ
# `packageManager` : sans épinglage, corepack basculerait sur le dernier pnpm.
# On fige la MÊME version que le workspace (AUD-11, doc 25) pour rester COMPATIBLE
# avec le lockfile v9 élagué produit au stage build : pnpm 8 ne sait PAS lire un
# lockfileVersion 9.0. L'install `--prod` ci-dessous ne tire que des deps runtime
# pures-JS (nest/drizzle/postgres/pino/nats) → aucun build script natif à exécuter,
# donc le durcissement « build scripts ignorés » de pnpm 10 est sans effet ici.
RUN corepack prepare pnpm@10.34.2 --activate
ARG APP
COPY --from=build /app/apps/$APP/dist/package.json ./package.json
COPY --from=build /app/apps/$APP/dist/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/apps/$APP/dist/workspace_modules ./workspace_modules
# Réinjecte les `pnpm.overrides` de la racine dans le package.json élagué.
# `@nx/js:prune-lockfile` recopie bien le bloc `overrides` dans le lockfile
# élagué mais PAS dans le package.json. L'install ci-dessous verrait alors un
# lockfile qui déclare un override absent du manifeste et, sous
# `--no-frozen-lockfile`, le « corrigerait » en re-résolvant la version d'origine
# (ex. multer 2.1.1, CVE-2026-5079 DoS HIGH — bloque le scan Trivy) au lieu de la
# version forcée (2.2.0). On recopie donc les overrides racine pour que manifeste
# et lockfile concordent et que le forçage tienne dans l'image finale. Générique :
# tout override racine (présent ou futur) est propagé, sans dépendance YAML (node natif).
COPY --from=build /app/package.json ./root-package.json
RUN node -e "const fs=require('fs');const root=require('./root-package.json');const pkg=require('./package.json');if(root.pnpm&&root.pnpm.overrides){pkg.pnpm=Object.assign({},pkg.pnpm,{overrides:Object.assign({},pkg.pnpm&&pkg.pnpm.overrides,root.pnpm.overrides)});fs.writeFileSync('./package.json',JSON.stringify(pkg,null,2));}" \
  && rm root-package.json
RUN pnpm install --prod --no-frozen-lockfile

# --- Stage 3 : runtime minimal ----------------------------------------------
# Ne copie que le bundle du service + ses node_modules élagués. Aucune trace du
# reste du workspace (autres services, sources, outillage de build).
FROM --platform=linux/amd64 node:24-slim AS runtime
WORKDIR /app
# Durcissement chaîne d'appro (AUD-06, doc 25) : on applique les correctifs de
# sécurité des paquets OS du base image (ex. libgnutls30 deb12u6→u7, CVE HIGH/
# CRITICAL corrigibles) que `node:24-slim` n'a pas encore intégrés. Le scan Trivy
# du pipeline est bloquant sur les CVE corrigibles → sans ce patch, le build casse.
RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/*
# Durcissement chaîne d'appro : RETIRER npm du runtime de production. On démarre
# via `node main.js` (jamais npm/npx) ; or npm — livré avec node:24-slim — embarque
# sa PROPRE copie d'undici (6.25.0) sous /usr/local/lib/node_modules/npm, qui porte
# CVE-2026-12151 (HIGH, DoS) → scan Trivy bloquant. L'undici INTERNE de Node
# (process.versions.undici, ≥ 7.28.0 sur node 24.17) n'est PAS concerné. Retirer npm
# supprime la CVE ET réduit la surface d'attaque du runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ARG APP
ENV NODE_ENV=production
ENV APP=$APP
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/$APP/dist ./
# Défense en profondeur : le runtime tourne sans root DANS l'image (uid/gid 1000
# = user `node` de node:24-slim). Rien n'exige root ici : les services écoutent
# sur 3000+, n'écrivent aucun fichier (logs sur stdout, migrations lues depuis
# l'image) et /app copié par root reste lisible en lecture seule — c'est
# d'ailleurs pourquoi les composes peuvent les lancer en `read_only` (AM-48).
# NB (corrigé au lot 8 des standards) : cette ligne annonçait « en plus du
# `user: 1000` du compose serveur ». Ce `user:` n'a JAMAIS existé dans
# docker-compose.server.yml — l'image est la seule à porter le non-root, et le
# compose n'a rien à redire tant qu'elle le fait.
USER 1000:1000
# Sonde de vie embarquée (lot A6) : l'état de santé suit l'image même hors des
# healthchecks Compose (docker run nu, staging). Compose la surcharge par service
# avec le même patron ; le port vient de l'env PORT injecté au run (repli 3000).
HEALTHCHECK --interval=5s --timeout=3s --retries=10 --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Démarre le bundle du service ciblé (main.js à la racine de l'image).
CMD ["node", "main.js"]
