# Revue standards industriels — août 2026

## État courant

- **2026-08-10** (session distante) : revue complète de l'application contre les
  standards externes (sécurité, API/observabilité, données/RGPD/frontend). Constats
  consignés `AM-33` → `AM-51` + `LE-29` (doc 34) ; veille pérennisée en doc 36
  (cadence trimestrielle, rituel doc 34 §7) ; plan par lots dans
  `.claude/plans/plan-standards-industriels.md`.
- Lot 0 livré dans la même PR : backoff+jitter+discrimination 4xx
  (`libs/resilience`), HSTS + garde en-têtes (`apps/web/src/nginx-headers.spec.ts`),
  `Retry-After` sur le 429 gateway.
- **2026-08-11 — lot 1 livré (PR #312, branche `feat/rgpd-lot1-registre-et-mentions`).**
  **Décision PO structurante : l'exemption domestique art. 2(2)(c) est ASSUMÉE**
  (ADR-0007) — les livrables sont tenus en **démarche volontaire**, le dépôt ne
  revendique aucune conformité. Cela clôt la contradiction entre le plan de juillet
  (qui écartait le registre) et celui d'août. L'ADR énonce les **4 seuils de
  révision** : plus d'un foyer, accès direct d'un établissement, cadre associatif,
  donnée de santé réelle. Livré : doc 37 (8 traitements, 8 tiers, durées), RPO 24 h /
  RTO 24 h en `sauvegardes.md` §10, page publique `/mentions` + pied de page, pied
  d'information sur les 2 courriels sortants. `AM-46` clos, `AM-36` recadré sur son
  volet outillage, `AM-52` et `LE-30` ouverts.

- **2026-08-12 — lot 2a livré (branche `feat/rgpd-lot2-effacement-foyer`).** Effacement
  du foyer de bout en bout : `DELETE /api/v1/foyers/:id` → cascade SQL → événement
  `foyer.FoyerSupprime.v1` → effacement des copies dans les 3 read-models. **Le lot 2 a
  été scindé** (2a effacement / 2b bornes temporelles) : deux risques sans dépendance
  mutuelle. Trouvaille structurante : **`dead_letter` archive des données personnelles en
  clair** parce que les abonnements n'ont pas de `filter_subject` — consigné `AM-53`, avec
  `AM-54` (index), `LE-31` (`Modale` cassait toute saisie) et `LE-32` (drizzle ne lie pas
  l'opérande d'un `like`).

- **2026-08-12 — lot 2b livré (bornes temporelles).** `PurgeModule` dans
  `libs/nest-commons` : `setInterval` + garde de réentrance, **horloge remontée dans la
  lib** (`CLOCK` vivait dans `svc-notifications` ; le patron partagé était justement celui
  qui appelait `new Date()` en dur), compteurs OTel, une tâche isolée par `try`. Neuf
  bornes dans les 5 services, chaque index posé dans la même migration ; `outbox` et
  `dead_letter` bornées **dans la lib** (prédicat unique, hérité). `AM-01` soldée (index de
  purge + index partiel du backlog).
  **Ce que le lot a vraiment trouvé : deux des huit durées de doc 37 §3 étaient FAUSSES,
  pas difficiles.** T1 ancrait la rétention sur la « date d'effet de la version » — or la
  fin d'une version n'existe pas en base, la dernière reste ouverte, donc la version **en
  vigueur** d'un foyer inactif tombe sous la borne, et l'aval **facture faux sans lever
  d'erreur**. T3bis demandait de purger la preuve d'un désabonnement dont la disparition
  **vaut réabonnement**. Corrigées en doc 37 v1.1, pas outillées.
  Porte née de là : **`pnpm retentions`** — une durée déclarée outillée doit nommer sa
  colonne, et celle-ci doit exister dans tous les schémas déclarant la table. Elle ferme
  `MO-2` à sa 3ᵉ occurrence. Vérifiée en rejouant l'énoncé v1.0 : refusé dans les 2 services.
  Consigné : `AM-55`→`AM-61`, `LE-34`, `LE-35` ; `AM-01` ✅, `AM-03`/`AM-36` avancées.

- **2026-08-12 — lot 3 livré (portabilité, `AM-35` ✅).** `GET /api/v1/foyers/:id/export`
  agrège **trois** services sources (un module `portabilite` par service, même découpage
  que la cascade d'effacement du 2a) en un document à trois sections nommées pour la
  personne. Téléchargement depuis « Ma famille » ; primitive de téléchargement remontée
  de `couts/export.ts` vers `utils/telechargement.ts`.
  **Ce que le lot a vraiment trouvé : deux façons d'exporter juste et de mentir quand
  même.** (a) `preference_notification` — l'absence de ligne **vaut consentement** : les
  lignes brutes auraient présenté les _écarts au défaut_ comme l'état complet ; on exporte
  l'**effectif** via `fusionnerDefauts`. (b) `desabonnement_token.jti` est une **capacité**,
  pas une donnée : il désabonne sans authentification, donc il ne sort pas — sondé par
  `expect(JSON.stringify(vue)).not.toContain(jti)`.
  **Décision de conception à retenir : aucune dégradation gracieuse sur cette route.**
  Partout ailleurs dans la passerelle un amont muet fait perdre un enrichissement ; ici il
  ferait livrer un export **amputé sans le dire**. Les 3 appels sont dans un seul `relayer`.
  Porte née de là : **`pnpm portabilite`** — les 46 tables des 5 services doivent **toutes**
  être classées en doc 37 §6 (exportée / copie / technique / hors périmètre), une table dite
  exportée doit être **réellement lue** par le `portabilite.service.ts` de son service, et une
  `copie` doit nommer une source elle-même exportée. Attendu **dérivé des `schema.ts`** ;
  3 sondes `--autotest`, plus une vraie sonde jouée à la main (ajout d'un `pgTable` réel dans
  un schéma ⇒ refus). Doc 37 passe en v1.2.

- **2026-08-12 — lot 4 livré (erreurs RFC 9457, `AM-37` ✅). MERGÉ (PR #318,
  `1923d67`), non déployé.** `ProblemeFilter` global à la passerelle : toute erreur part
  en `application/problem+json`, contrat et registre des 4 codes métier en
  `contracts-kernel/dto/probleme.ts`, 50 réponses d'erreur de l'OpenAPI qui décrivent
  enfin un corps. Porte `pnpm problemes`.
  **Ce que le lot a vraiment trouvé : le défaut n'était pas le nombre de formats, mais
  qu'aucun ne soit celui que le front lisait.** `extraireErreurs` attendait un tableau
  **à la racine** du corps ; `BadRequestException([{champ,message}])` l'enveloppe.
  **Aucune erreur par champ n'a jamais atteint un écran**, sur les 8 formulaires
  concernés — et **sept tests verts** l'affirmaient, chacun fabriquant son corps à la
  main (`AN-21`, `LE-39`).
  **Décision de conception : traduire au bord, ne pas traverser** (`LE-40`). La forme
  `{statusCode, code, message}` n'était contractuelle **que parce que** `relayer`
  republiait le corps amont tel quel ⇒ le filtre traduit, **aucun pact n'est touché**, et
  la migration « contrat par contrat » que l'énoncé imposait est devenue sans objet. Prix
  assumé : les services gardent leurs 4 formes entre eux (`AM-70`).

- **2026-08-12 — lot 5 livré (validation d'environnement, `AM-44` ✅), PR #319.**
  Trousse partagée `libs/nest-commons/src/lib/config/env.ts` (`champEnv`, `lireEnv`,
  `RegleProduction`) ; un `CHAMPS_ENV` par app, qui **est** l'inventaire de ce qu'elle
  lit ; `loadConfig(env?)` valide et refuse. Convention écrite en CONVENTIONS.md §6.
  **Écart d'énoncé principal : « un schéma zod par app » aurait été six miroirs de la
  même règle de lecture** (`LE-40` appliquée) — ce qui se partage n'est pas le nom, mais
  ce qui compte comme un entier, comme absent, et ce qu'on ose citer dans un refus.
  **Au-delà du `NaN` sur `PORT` annoncé** : `RATE_LIMIT_MAX=cent` ⇒ `NaN` ⇒
  `recents.length >= NaN` **toujours faux**, donc rate-limit **désactivé en silence** ;
  **trois specs affirmaient ce `NaN`**, motivé en commentaire — le défaut avait rang de
  contrat (`LE-41`) ; il y avait **trois** `verifierConfigProduction()` homonymes, pas
  deux, et trois services sans aucun garde-fou ; et `INTERSERVICE_AUTHZ_ENFORCE` était
  posée sur `api-gateway`, qui **signe** les assertions et ne les vérifie jamais (ligne
  inerte, retirée).
  Porte **`pnpm environnement`** (9 sondes) : aucune lecture de `process.env` hors
  `config.ts`, aucun réglage de compose inerte, aucune variable déclarée sans ligne de
  compose de production ni motif écrit. Refus **prouvé sur le bundle réel**
  (`refus-config.e2e.spec.ts`, code de sortie non nul + `stderr` qui nomme le champ).
  `AM-30` est rendue **visible**, pas fermée. Consigné : `AM-71`/`AM-72`,
  `LE-41`/`LE-42`/`LE-43`, `EM-12`.

- **2026-08-15 — `AM-82` et `AM-83` soldées (décisions PO), hors lot.** Volumes nommés
  pour `nats` (magasin JetStream, avec `-sd /data`), `prometheus` (TSDB) et
  `alertmanager` (silences) ; les **trois exemptions de racine inscriptible tombent**,
  29/29 services en `read_only`, `RACINES_INSCRIPTIBLES` est vide. Motif PO : la semaine
  d'observation qui précède la bascule INTERSERVICE exige une TSDB qui survive aux
  déploiements. Plugin Grafana Infinity installé par `GF_PLUGINS_PREINSTALL` dans le
  compose de **base**, version épinglée sur celle de la production (`3.11.1`).
  **Les deux énoncés du lot 8 étaient partiellement faux (`LE-56`)** : (a)
  `GF_INSTALL_PLUGINS` n'est pas inerte sur Grafana 13 — le lot 8 avait lu le répertoire
  de plugins **trop tôt**, l'installation est asynchrone (~9 s) — et la production avait
  bien son plugin ; (b) Prometheus et Alertmanager avaient depuis toujours un volume
  **anonyme** hérité de leur image (`VOLUME` du Dockerfile amont), qui survit à
  `up -d --force-recreate` et se perd au premier `down`/`up` : leur exemption de
  `read_only` était infondée. Vérifié sur la pile réelle en trois temps (démarrage,
  redémarrage, recréation, `LE-53`). Ouvert : `AM-84` (personne ne surveille la version
  épinglée du plugin), `AM-85` (le durcissement fait échouer la mise à jour des plugins
  embarqués de Grafana à chaque démarrage).

- **Une sonde `--autotest` qui ne mute rien accuse la porte** (lot 5) : une mutation
  écrite sur un `\n` littéral ne remplace RIEN dans un fichier CRLF (tout l'arbre de
  travail sous Windows), la porte lit le fichier intact et le verdict affiché dit « la
  porte ne mord plus ». Toute mutation passe par une garde qui **lève si le texte est
  inchangé**.
- **Une spec en `NODE_ENV=production` doit poser un environnement de production
  complet** (lot 5) : `loadConfig()` refuse en production une URL amont restée à son
  repli `localhost`, et les guards relisent la config **à chaque requête**.
- **Un secret entouré d'espaces refuse le démarrage** (lot 5) : le rogner changerait la
  clé HMAC en silence. Si un secret de `.env.server.enc` en porte, le prochain
  déploiement refuse de démarrer **en nommant la variable**.

## Ce que la revue a établi (résumé)

- **Angle mort n° 1 : RGPD** — aucune des obligations (art. 13/17/20/30) n'était
  traitée hors droit d'opposition (ADR-0006), alors que l'app stocke mineurs et
  revenus. Cause racine en `LE-29` : les revues confrontaient le processus, jamais le
  produit, aux référentiels externes.
- Solide et confirmé : OTel complet, liveness/readiness disciplinés, supply chain CI
  (SHA-pinning, SBOM, cosign), sauvegardes avec restauration prouvée.
- Détail des faits par domaine : voir les critères des lignes `AM-33`…`AM-51`.

## Pièges pour les lots suivants

- **L'absence d'une ligne porte du sens ici — une purge est alors un changement de
  comportement, pas de l'hygiène (`LE-35`).** Quatre tables l'encodent : `processed_event`
  (absente ⇒ rejeu), `preference_notification` (absente ⇒ consentement, donc
  réabonnement), `notification_hebdo` (absente ⇒ action en attente effacée) et
  `envoi_etablissement` **côté sortant** (absente ⇒ second courriel réel vers une crèche —
  l'endpoint d'envoi n'est borné par aucune date et le front réarme son bouton à chaque
  montage). D'où l'**anonymisation en place** plutôt que la suppression sur cette dernière.
  Avant de borner une table : chercher qui interprète son **absence**, pas qui la lit.
- **Les sondes du registre écrites sur un littéral se périment en silence.** Trois ont
  cessé de mordre pendant ce lot, en touchant `MO-2` et en closant `AM-01` ; seule la garde
  « la mutation n'a rien changé » de `--autotest` l'a dit. Les 4 sondes qui visaient une
  propriété **mutable** sont désormais dérivées. **Rejouer `--autotest`, pas seulement la
  porte**, dès qu'on touche au registre.
- **Drizzle lie une borne `Date` en chaîne ISO**, pas en `Date` : les assertions de
  paramètre d'une purge se sondent (`.toISOString()`), elles ne se supposent pas.

- ~~RFC 9457 (lot 4) : migration contrat par contrat~~ — **réfuté par le lot 4**
  (`LE-40`). La forme `{ statusCode, code, message }` n'était figée dans les pacts que
  parce que `relayer` republiait le corps amont tel quel. Traduire **au bord** a coupé
  ce lien : aucun pact touché, aucune traversée. Avant d'accepter le découpage prudent
  d'un énoncé, chercher **ce qui crée le couplage** qu'il contourne.
- Effacement (lot 2) : les read models aval portent des copies des données foyer —
  l'effacement doit voyager en événement d'intégration, pas en `DELETE` local.
  🔑 **Le mécanisme existe DÉJÀ et n'est pas à inventer** : `retirerEnfant`
  (`svc-foyer/src/foyer/foyer.service.ts`) est un `DELETE` réel suivi d'un événement
  `EnfantRetire` — même chose pour contrat et établissement. Le lot 2 généralise ce
  patron au foyer entier ; il ne part pas de zéro. Corollaire : la lecture « aucune
  suppression n'existe » (énoncé d'`AM-34`) est **trop grossière**, seule la purge
  liée au temps et l'effacement d'ensemble manquent.
- **Tout ajout au corps d'un courriel doit être réapposé côté serveur.**
  `RelectureEnvoi` envoie **toujours** le texte réécrit par le parent, qui remplace
  le corps rendu **en entier** : ce qui n'est ajouté qu'au gabarit ne part jamais
  dans un vrai message (constaté au lot 1, réglé dans `EnvoiService`).
- **Ne pas informer par la seule page web.** L'agent d'établissement et les enfants
  n'ouvrent jamais l'application ; la collecte les concernant est **indirecte**. Le
  pied de courriel est le seul canal qui les atteigne.
