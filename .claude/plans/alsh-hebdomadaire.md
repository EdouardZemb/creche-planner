# ALSH hebdomadaire bout-en-bout (chantier « Contrats & besoins », lot 1)

> **Statut au 2026-07-29** : ✅ **FAIT** (re-vérifié sur code le 2026-07-30) — PR A #162 mergée (commit `ef21611` : `JourAlshHebdo` + `ExceptionJour.alsh` présents dans `inscription-abcm.ts`, zod svc-planification, passthrough gateway `semaine-besoins.ts` laisse passer `alsh`) et PR B #163 mergée (front : hack `InscriptionsJourEtendue` supprimé — 0 occurrence dans `apps/web/src`, `bff.ts` porte `alsh` hebdo + `ExceptionAbcm.alsh`).
> Déployé en prod `0.9.0` (2026-07-05) ; prod actuelle `0.14.0`. Reste uniquement le smoke ALSH live (action humaine PO).

## Problème

La colonne « Inscrit ALSH » du formulaire contrat (`apps/web/src/foyer/ContratForm.tsx`,
hack `InscriptionsJourEtendue`) écrit une clé `alsh` **hors contrat de données** :
`inscriptionsJourSchema` (zod, svc-planification) l'élimine silencieusement à la
validation. Le parent coche, enregistre, et sa saisie est perdue sans erreur.
Côté domaine (`libs/planification/domain/inscription-abcm.ts`), la génération ALSH
(`genererPrestationsAlsh`) ne lit QUE les `joursAlsh` saisis par date — la semaine
type est ignorée pour ce mode.

Décision PO (2026-07-04) : **modéliser l'ALSH hebdomadaire bout-en-bout** (pas de
retrait de la case).

## Modèle retenu

- `InscriptionsJour.alsh?: JourAlshHebdo` avec
  `interface JourAlshHebdo { readonly type: TypeAlsh; readonly repas?: boolean }`
  → la coche hebdo porte la **formule** (journée/demi) et le **repas**, car la
  grille tarifaire ALSH distingue les trois compteurs.
- `ExceptionJour.alsh?: boolean` — surcharge datée symétrique de cantine/péri :
  `false` retire un jour hebdo, `true` ajoute (config du jour de semaine, défaut
  `{ type: 'COMPLETE' }`), absent = héritage semaine type.
- `genererPrestationsAlsh` : jours effectifs du mois =
  1. `joursAlsh` explicites (dans le mois, dans la période, hors non-facturables) —
     **prioritaires par date** (leur type/repas gagne) ;
  2. - jours facturables du mois dont `inscriptionsEffectives` (semaine type +
       exception `alsh`) donnent un ALSH actif, **hors dates déjà couvertes en 1**.
       → pas de double comptage vacances (un mercredi de vacances réservé explicitement
       ne compte qu'une fois).
- Jours non facturables (fériés/fermetures, Référentiel) exclus comme aujourd'hui.
- **100 % additif** : `semaine_abcm` est du JSONB, aucun contrat existant modifié,
  aucune migration SQL. Un contrat ALSH « par dates uniquement » reste valide.

## Découpage

### PR A — socle domaine + API (backend, additif)

- `libs/planification/domain/src/lib/inscription-abcm.ts` : types + fusion
  exceptions + génération (dedup explicite > exception > semaine type).
- `generation-prestations.ts` : `ExceptionJourJson.alsh` + mapping.
- Tests : `inscription-abcm.spec.ts` (cas nominaux, dedup, exception retrait,
  hors période, non facturable), `inscription-abcm.mbt.spec.ts` si invariants touchés.
- `apps/svc-planification/src/planification/planification.dto.ts` :
  `inscriptionsJourSchema` += `alsh` (objet type/repas), `exceptionAbcmSchema` +=
  `alsh: z.boolean().optional()` ; specs dto.
- `apps/api-gateway/src/bff/semaine-besoins.ts` : `semaineAbcmSchema` local doit
  laisser passer `alsh` (sinon la vue besoins la perd) ; spec.
- Pact BFF→planification (`planification.consumer.pact.spec.ts`) : interaction
  contrat ALSH avec `semaineAbcm` portant `alsh` (additif, can-i-deploy doit rester vert).

### PR B — front (saisie + lecture cohérente)

- `apps/web/src/types/bff.ts` : `InscriptionsJour.alsh`, `ExceptionAbcm.alsh` ;
  suppression du hack `InscriptionsJourEtendue` dans `ContratForm.tsx`.
- `ContratForm.tsx` (mode ALSH) : par jour, coche « Inscrit » + formule
  (journée/demi) + repas — divulgation progressive, cibles 44 px.
- `apps/web/src/dashboard/jourFoyer.ts` : état `alsh` dérivé aussi de la semaine
  type + exceptions (aujourd'hui : uniquement `joursAlsh[0]`).
- `apps/web/src/planning/CalendrierAbcm.tsx` : afficher les jours hebdo générés ;
  clic sur un jour hebdo = exception (retrait/réactivation), portée durable
  réutilisée pour « tous les mercredis » ; explicites inchangés.
- `apps/web/src/notifications/EditeurContratSemaine.tsx` : même logique sur la
  semaine notifiée.
- Tests unitaires + e2e stack impactés (libellés planning → `*.stack.e2e.spec.ts`).
- Si trop gros : B1 = ContratForm + jourFoyer + bff.ts ; B2 = calendrier/éditeur semaine.

## Vérification

- `corepack pnpm@10.34.2 nx run-many -t typecheck test -p planification-domain svc-planification api-gateway web`
- Pact + can-i-deploy via CI (aucune rupture attendue : additif).
- Vérif UI locale : stack docker + seed puis Vite :4200 (cf. mémoire
  verif-ui-locale-stack) — contrat ALSH hebdo → planning → dashboard → coûts.

## Pièges connus

- `nx test web` ne typecheck pas → lancer typecheck explicitement.
- Builder `contracts-kernel`/`shared-semaine` avant `nx test web`.
- `/pacts` dans `.prettierignore` ; ESLint 9 strict (`ReadonlyArray<T>` → `readonly T[]`).
- Le provider exige les 7 jours présents dans `semaineType` crèche ; `semaineAbcm`
  est un record partiel (pas d'exigence 7 jours) — ne pas « corriger » ça au passage.
