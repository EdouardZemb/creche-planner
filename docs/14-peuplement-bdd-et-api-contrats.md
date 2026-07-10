# 14 — Peuplement de la base (jeu de données de référence) & consommation de l'API par le front

|               |                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Objet**     | Amorcer la base avec le **jeu de données de référence** (foyer type à deux enfants) et faire en sorte que le front lise ses contrats **depuis l'API** (au lieu du `sessionStorage`). |
| **Date**      | 2026-06-06                                                                                                                                                                           |
| **Périmètre** | `scripts/seed-demo.mjs`, `svc-planification`, `api-gateway`, contrat OpenAPI, `apps/web`, `Dockerfile`.                                                                              |

---

## 1. Peuplement du jeu de référence

### Données

- **Foyer** : RFR **72 705 €**, **3 parts** ; ressources CAF **6 716,92 €/mois**, **2 enfants à charge** ⇒ tranche ABCM **3**.
- **Enfants** : Zoé (née 12/03/2023), Mia (née 08/12/2024).
- **Contrats crèche PSU** (« Les Hirondelles ») : du **01/01/2026 au 31/07/2026**, 7 mensualités, tarif horaire 3,47 € — semaine type indicative par contrat.
- **ABCM** (année scolaire 2026/2027) : Zoé en maternelle ABCM, cantine + périscolaire soir. Jours de présence indicatifs.

### Script

`scripts/seed-demo.mjs` — Node ESM, `fetch` natif, **zéro dépendance**, **idempotent**.

```bash
docker compose up -d                 # stack + amorçage référentiel (grilles/barème/fermetures 2026)
node scripts/seed-demo.mjs           # ou: pnpm seed:demo
node scripts/seed-demo.mjs --verify  # + contrôle des coûts calculés
```

- Cible le BFF `/api/v1` (variable `SEED_BASE_URL`, défaut `http://localhost:3000/api/v1`).
- Idempotence via `scripts/.seed-demo-state.json` (ignoré par git, lié à l'instance de base) : réutilise le foyer s'il existe (`GET /foyers/:id`), sinon recrée ; contrats en PUT, plannings en upsert.
- Crée : 1 foyer + 2 enfants, 2 contrats crèche PSU, **2 contrats ABCM** pour Zoé (CANTINE + PERISCOLAIRE — voir §4, marqués `premiereInscription: true` : la 1ʳᵉ année ABCM est portée par le contrat depuis le lot 4b des Coûts, plus par une année codée en dur), plannings mensuels nominaux.

### Résultat vérifié (coûts recalculés par le moteur)

| Mois            | Coût                       | Détail                                                  |
| --------------- | -------------------------- | ------------------------------------------------------- |
| jan→juil 2026   | **851,16 €/mois**          | crèche Zoé 412,20 € + Mia 438,96 €                      |
| août 2026       | 0,00 €                     | hors période (crèche finie, ABCM pas commencé)          |
| dès sept. 2026  | cantine + péri + **436 €** | frais fixes ABCM (cotisation 286 + 1ʳᵉ inscription 150) |
| **annuel 2026** | **≈ 7 186 €**              |                                                         |

---

## 2. Le front consomme l'API pour les contrats

Avant, les pages Contrats/Planning lisaient le `sessionStorage` (le BFF n'exposait pas de liste de
contrats), donc les contrats seedés via l'API n'apparaissaient pas. Ajout d'un endpoint de bout en bout :

**`GET /api/v1/contrats?foyer=<uuid>`** → liste des contrats du foyer, **config mode-spécifique incluse**
(`semaineType` / `semaineAbcm` / `heuresAnnuellesContractualisees` / `nbMensualites`).

- `svc-planification` : `listerContrats(foyerId)` + `GET /api/contrats?foyer=` (vue `ContratDetailVue`).
- `api-gateway` : client `listerContrats` (passthrough des champs riches) + route BFF `GET /api/v1/contrats?foyer=`.
- Contrat OpenAPI (`libs/contracts/kernel/.../gateway.openapi.ts`) : nouveau path — propagé au typecheck web via l'interpréteur de types (pas de codegen).
- `apps/web` : `api.listerContrats`, `useContrats` branché sur l'API, `ContratsPage` + `PlanningPage` adaptés.

> Le front choisit le foyer actif via `localStorage['creche:foyerId']`, **écrit uniquement à la création
> via le formulaire**. Après un seed par l'API, ouvrir directement `/foyers/<id>/contrats`
> (ou positionner cette clé), sinon la racine `/` redirige vers un éventuel id périmé.

---

## 3. Correctifs front (UX & calendrier)

- **Calendrier crèche — jours gardés** : un jour n'est « gardé » que s'il porte **au moins une plage
  horaire**. Le service exige les 7 jours dans `semaineType` ; les jours non gardés (week-end…) ont un
  tableau vide `[]` qui ne doit pas être marqué (`CalendrierCreche.tsx`). `CalendrierAbcm` était déjà
  correct (teste le drapeau cantine/periMatin/periSoir). Les coûts n'étaient pas affectés.
- **Planning — onglet par défaut** : la page s'ouvre sur le contrat **valide pour le mois affiché**
  (pas le premier par ordre alphabétique), évitant un calendrier vide trompeur (ex. cantine ABCM
  démarrant en septembre alors qu'on affiche juin).

---

## 4. Modèle ABCM : un contrat = un mode

Dans `svc-planification`, le `mode` d'un contrat sélectionne **un seul** générateur de prestations
(CANTINE → cantine, PERISCOLAIRE → péri, ALSH → alsh). Pour facturer **cantine ET périscolaire** à un
même enfant, il faut donc **deux contrats** ABCM distincts (c'est ce que fait le seed pour Zoé).

---

## 5. Déblocage du build Docker (régression Phase 11)

Les images des services NestJS ne démarraient plus après le découplage Phase 11 :

1. Le `package.json` élagué par `@nx/js:prune-lockfile` ne porte pas le champ `packageManager` →
   `corepack` basculerait sur le dernier pnpm. **Fix** : `Dockerfile` (stage `deps`) épingle la **même
   version que le workspace** pour rester compatible avec le format du lockfile élagué.
   _MàJ AUD-11 (doc 25, 2026-06-10)_ : workspace passé en **pnpm 10.34.2** + lockfile **v9** → l'épinglage
   est désormais `pnpm@10.34.2` (un pnpm 8 ne sait pas lire un lockfileVersion 9). L'ancien
   `ERR_PNPM_IGNORED_BUILDS` de pnpm 10 a été relâché en simple _warning_ dans les versions récentes
   (vérifié sur 10.34.2 : install `--prod` exit 0, seul `protobufjs` est signalé, inoffensif au runtime).
2. `prune-lockfile` ne propage pas les dépendances **transitives** des libs workspace (`file:`). Les
   dépendances OpenTelemetry (lib `observability`) et `zod` (gateway) n'étaient donc pas installées dans
   l'image → crash runtime `Cannot find module …`. **Fix** : déclarer ces dépendances tierces
   directement dans chaque `apps/*/package.json` (convention du repo : chaque app liste ses deps
   concrètes).

---

## 6. Reliquats (non bloquants)

- Helpers contrat `sessionStorage` de `apps/web/src/utils/store.ts` désormais inutilisés (à nettoyer).
- Pas de test **pact** pour `GET /api/v1/contrats` (couverture additive).
- Métrique de repli tarification (DEC-05) toujours en suspens — voir `docs/06`.
