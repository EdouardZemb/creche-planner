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
RUN pnpm install --no-frozen-lockfile
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
ARG APP
ENV NODE_ENV=production
ENV APP=$APP
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/$APP/dist ./
# Démarre le bundle du service ciblé (main.js à la racine de l'image).
CMD ["node", "main.js"]
