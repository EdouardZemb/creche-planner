---
name: staging-poller-watches-gateway-only
description: "CORRIGÉ+MERGÉ (PR #54, `20c226b`) : le poller staging surveillait seulement api-gateway → un merge web-only n'auto-déployait PAS ; il sonde désormais un digest agrégé des 6 images"
metadata:
  node_type: memory
  type: project
  originSessionId: fa65c869-4d95-4e45-8b35-7dfa0cacd3be
---

**CORRIGÉ+MERGÉ dans la PR #54 (squash `20c226b` sur `main`, 2026-06-24).**

Le poller staging (`scripts/staging-poll.mjs`) sonde désormais le digest `--raw` des
**6 images applicatives déployables** (api-gateway, svc-foyer, svc-planification,
svc-referentiel, svc-tarification, web — constante `PROJETS_DEPLOYABLES`) et les agrège
en un digest déterministe via `agregerDigests()` (fonction PURE exportée, testable :
`sha256` de la concaténation triée, ref incluse). Tout changement d'au moins une image
bouge l'agrégat → déploiement. Sémantique inchangée (marqueur écrit même si échec,
`STAGING_FORCE=1`, `IMAGE_TAG`, zéro dépendance, hash des octets bruts). Garde
`import.meta.url` → `main()` ne tourne qu'en lancement direct. `deploy.mjs` inchangé :
son `docker compose pull` (sans filtre de service) tire déjà toutes les images.

**Le bug d'origine (piège vérifié 2026-06-24, avant #54)** : le poller ne comparait que
le digest de `api-gateway:main`. Un merge qui ne touche PAS la gateway (ex. PR web-only
#53, UI mobile) ne reconstruit que l'image `web` via `build-images` (nx affected) ; le
digest `api-gateway:main` restait identique → « ✓ Staging déjà à jour » et staging ne
tirait JAMAIS la nouvelle image web. Les merges web-only n'étaient jamais auto-déployés.

**Débloquer manuellement** (toujours valable) : depuis le poste Windows,
`.\scripts\remote-deploy.ps1 -Environment staging` (SSH sortant → `deploy.mjs` tire les
images `:main`). Ou sur le serveur, forcer un tick : `STAGING_FORCE=1`.

Voir [[prod-deployment-facts]] (Phase 8).
