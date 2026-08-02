---
name: piege-pact-drift-flaky-course-pact-core
description: 'Flaky « request expected but not received » des specs pact consumer en CI = course interne pact-core sous charge CPU, corrigé PR #266 MERGÉE main `b7739ee` 2026-07-30 (fileParallelism CI + retry) ; variante LOCALE : specs pact PROVIDER en « provider non prêt après 40000 ms » quand on lance run-many avec la pile Docker up → baisser à --parallel=2'
metadata:
  node_type: memory
  type: project
  originSessionId: f4491257-2f9a-480a-b44c-bce426969c24
  modified: 2026-08-01T18:35:06.571Z
---

**Symptôme** : job `pact-drift` (et potentiellement `ci`) échoue avec « The following request was expected but not received » sur un spec pact consumer **différent à chaque fois**, vert en local (vu 2026-07-29, run 30480333256, tentatives 1+2).

**Diagnostic prouvé par les logs** : ce n'est NI un conflit de ports NI un fetch perdu. Le mock server logge `Received request … Request matched, sending response`, le test reçoit son 200 conforme (le callback ne lève pas — pact-js v17 relancerait sinon l'erreur du callback, cf. `@pact-foundation/pact/src/v3/pact.js` chemin `if (error) throw error`), mais `mockServerMismatches()` interrogé juste après répond « not received ». Course interne pact-core (enregistrement du match par le worker tokio vs lecture FFI), fenêtre ouverte seulement quand le CPU du runner 2 cœurs est saturé par plusieurs forks vitest + mock servers.

**Correctif (PR #266)** : dans `apps/api-gateway/vitest.config.mts`, `fileParallelism: !process.env['CI']` (sérialisation en CI seulement) + `retry: 1` sur les describes des 5 specs `apps/api-gateway/src/contract/*.pact.spec.ts`. Rejeu sûr : en échec `executeTest` n'écrit pas le pact file et le corps du `it` ré-enregistre l'interaction → aucune dérive (régénération vérifiée identique à l'octet près).

**Variante LOCALE, specs PROVIDER (vue 2026-08-01)** : `nx run-many -t typecheck test build -p <6 apps> --skip-nx-cache --parallel=3` sur la machine de dev **avec la pile Docker complète up** fait tomber 3 specs `*.provider.pact.spec.ts` sur `Error: provider non prêt après 40000 ms (http://localhost:399x/api/health/live)`. Ce n'est ni un port squatté (le préflight les vérifie et ils étaient libres) ni le bundle : rejouées **isolément** elles sont vertes, et la même passe à `--parallel=2` passe intégralement. Indice de saturation dans les logs : un test d'architecture (règle de frontières) qui met **41 s**. Le spec spawne le vrai `dist/main.js` et lui laisse 40 s pour répondre sur `/api/health/live` — budget suffisant en CI, pas quand 6 webpack + 6 vitest coverage + 14 conteneurs se disputent le CPU.

**How to apply** : en local, lancer les passes complètes à `--parallel=2` (ou arrêter les conteneurs applicatifs, en gardant les Postgres — sans base joignable les specs provider se _skippent_ et le vert devient faux). Ne jamais conclure « régression » sur un échec de readiness sans rejeu isolé. Si le symptôme réapparaît malgré ça, ne pas chercher un conflit de ports — regarder la charge (autres tâches nx en parallèle) et envisager de monter le retry ou d'ouvrir une issue upstream pact-reference. Ne pas imbriquer de `projects` dans les configs vitest d'app : le root [[repo-clean-clone-location]] `vitest.config.ts` les consomme déjà comme projets (imbrication non supportée). Piège connexe : `/pacts` doit rester dans `.prettierignore` [[dep-pact-v17-migration]].
