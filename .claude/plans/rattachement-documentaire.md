# Plan d'exécution — SFD 38 « Rattachement documentaire »

> **Statut** : **NE PAS DÉMARRER — arbitrage roadmap PO.** La SFD
> [`docs/38-sfd-rattachement-documentaire.md`](../../docs/38-sfd-rattachement-documentaire.md)
> est un **brouillon v0.1 à valider** ; ce plan en est la traduction en lots, écrite en même
> temps pour que le PO voie ce que la validation engage — pas pour être exécuté.
> **Trois décisions PO conditionnent le lot 0**, et le lot 0 conditionne tout le reste :
> `Q-38-01` (type médical / cible enfant → position de l'`ADR-0009`), `Q-38-02` (effacement en
> cascade), `Q-38-03` (transit en clair au niveau du proxy Cloudflare). Sans elles, le lot 0 n'a
> rien à écrire.
>
> **Place dans la séquence** : la note de vision (`vision-plateforme-foyer-2026-08.md` §3) situe
> `AM-65` « au plus tôt à l'étape 3 » — après consolidation, après la séquence SFD 31 → 33, avec
> `factures-reelles`. Ce plan ne réclame pas d'être avancé ; il existe pour être **arbitré**.
>
> **Ce qui a changé depuis la note de vision** : elle posait comme condition « le solde du passif
> RGPD (`AM-33`/`AM-34`/`AM-36`) ». Ce passif est **largement soldé** depuis (registre des
> traitements doc 37, effacement du foyer, export de portabilité, bornes de rétention — lots 1 à
> 3 du plan standards). La condition n'est donc plus bloquante ; ce qui la remplace est plus
> précis, et plus lourd : les **seuils de révision** des ADR-0007 et 0008 (SFD §7).

## 1. Contexte et objectif

Une GED (Paperless-ngx 2.20.6) tourne déjà sur le serveur du foyer, remise en service le
2026-08-16. Elle fait l'ingestion, l'OCR, le classement et la recherche. Ce qui manque est le
**chemin** entre elle et l'application : déposer suppose d'être sur le réseau local, retrouver
suppose de changer d'outil, et rien ne relie un document à l'objet métier qu'il justifie.

Après ce chantier : un parent dépose depuis son téléphone, cherche en plein texte et consulte
depuis l'app ; un justificatif se voit depuis le contrat, le mois ou l'objet qu'il documente. Et
**aucun octet de document n'est stocké par creche-planner** — Paperless reste l'unique coffre.

## 2. Hypothèses assumées (à corriger par le PO si fausses)

- **H1** — L'instance Paperless reste en **2.20.6** au démarrage du chantier ; la migration 3.x
  est indépendante et non bloquante grâce à l'épinglage `Accept: application/json; version=9`
  (SFD §8). ⚠️ Si la migration 3.x est faite **pendant** le chantier, rejouer le lot 1 de bout en
  bout contre la nouvelle instance : la 3.0 a réécrit le consommateur et remplacé le moteur de
  recherche.
- **H2** — Position `ADR-0009` = **(b)** (SFD §7.1) : exemption maintenue par écrit, contrepartie
  = **aucun type médical au catalogue** et **cible `ENFANT` fermée** en v1. Si le PO répond (a),
  ajouter un lot d'amont (base légale, AIPD, droits) **avant** le lot 1. Si (c), ce plan est
  écarté.
- **H3** — Effacement du foyer : **les rattachements partent, les documents restent** (SFD §7.5,
  option ii).
- **H4** — Transit par la passerelle accepté (`Q-38-03`). Un refus vide le chantier de son
  intérêt : il faudrait restreindre l'accès au LAN/tailnet, c'est-à-dire renoncer au « depuis
  n'importe où ».
- **H5** — Le rattachement (lot 4) est **engagé**, pas optionnel : sans lui la promesse d'`AM-65`
  n'est pas tenue (SFD §2.1). Il peut être livré plus tard, il ne peut pas être abandonné en
  silence.
- **H6** — Aucune nouvelle dépendance npm : les appels sortants se font en `fetch` natif et
  `FormData`/`Blob` natifs (patron des clients existants de la passerelle).
- **H7** — Le propriétaire du lien est la **passerelle**, pas un service métier. Motif : il n'y a
  rien à persister côté document, seulement à relayer ; y intercaler un service ajouterait un
  saut réseau, un contrat et un pact pour zéro donnée. ⚠️ **Exception au lot 4** : la table
  `rattachement_document` est de la donnée de dossier — elle vit dans un **service**, pas dans la
  passerelle (qui n'a aucune base, doc 37 §0).

## 3. Décisions structurantes

- **D1 — Le lien réseau est un réseau Docker dédié, `external: true`, à deux membres**
  (`api-gateway` ↔ `webserver` Paperless), créé une fois par l'exploitation, aucun port publié,
  survivant à un `docker compose down` des deux côtés (SFD §7.3). Son absence **arrête le
  démarrage** de la passerelle en nommant le réseau — jamais de dégradation en « recherche
  indisponible ».
- **D2 — Version d'API épinglée et vérifiée à l'exécution.** `Accept: application/json; version=9`
  sur chaque appel ; l'en-tête `X-Api-Version` de la réponse est confronté à l'attendu. Un écart
  est une **erreur de configuration**, pas un avertissement.
- **D3 — Le filtre de foyer est un paramètre structuré, jamais du texte concaténé.** La saisie de
  l'utilisateur va dans `query=`, le foyer va dans `tags__id__all=` : deux paramètres distincts
  que Paperless combine en ET. Concaténer les deux serait injectable (`RM-38-04`). **Sonde
  négative obligatoire** : une saisie contenant des opérateurs booléens ne doit **jamais** faire
  sortir un document d'un autre foyer.
- **D4 — Le jeton n'est jamais un secret Compose de source `environment:`** sur un service à
  racine immuable (`LE-58`, production cassée le 2026-08-15). Source `file:` ou variable simple ;
  vérification par **redémarrage réel sur la pile qui porte le réglage** (`LE-53`).
- **D5 — Dépendance sortante uniquement.** L'issue d'une ingestion se connaît en **interrogeant**
  `/api/tasks/`, jamais par un rappel entrant. C'est ce qui garde `ADR-0008` §2 fermé (SFD §7.2).
- **D6 — Aucun cache disque, aucun stockage d'octets.** Aperçu et téléchargement sont des flux
  relayés. Un cache serait une copie, donc un magasin de plus à inventorier, à borner et à
  effacer.
- **D7 — L'identifiant Paperless est opaque au web** : le front ne connaît que les routes de la
  passerelle (`RM-38-07`).
- **D8 — La garde de forme s'appuie sur une capture réelle, régénérée par commande.** Une fixture
  écrite à la main serait un attendu produit par la même main que l'observé (`MO-3`).

## 4. Conventions transversales

Identiques au plan `versionnement-dates-effet.md` §4 (corepack pnpm, typecheck + test, pactes à
blanc, migrations au boot, ratchet, langage parent). S'y ajoutent :

- **Checklist contrat BFF** pour chaque lot exposant une route relayée : entrée dans
  `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` (document manuel) ; oracle « expose
  exactement les N routes attendues » à faire évoluer ; `pnpm nx run web:generate-types` sans
  diff (job `openapi-types-drift`) ; **pas de pact** ici — Paperless n'est pas un service du
  dépôt et le registre de contrats (ADR-0005) ne le couvre pas. C'est un **écart à écrire dans la
  PR**, pas un oubli.
- **Codes d'erreur** : tout code métier en majuscules posé dans un corps d'erreur passe par le
  registre `CODES_PROBLEME` — `pnpm problemes` compare l'énumération du contrat OpenAPI au
  registre, dans les deux sens.
- **Piste d'audit** : dépôt et rattachement sont des mutations du dossier → ligne `auditée` en
  doc 37 §7 **dès le premier commit**, jamais `différée` (`pnpm acteur` dérive son attendu des
  contrôleurs).
- **Sécurité inter-services** : la bascule `INTERSERVICE_AUTHZ_ENFORCE=1` arrivera pendant ces
  chantiers — toute route de service neuve porte son scoping dès le premier commit.

## 5. Vue d'ensemble des lots

| #   | Lot                                                           | Dépend de         | Livre du code ? |
| --- | ------------------------------------------------------------- | ----------------- | --------------- |
| 0   | Les trois écrits + le lien réseau + le secret (aucune UI)     | décisions PO      | Presque pas     |
| 1   | Client Paperless dans la passerelle (sortant, épinglé, gardé) | 0                 | Oui             |
| 2   | Dépôt depuis l'app (route, écran, PWA)                        | 1                 | Oui             |
| 3   | Recherche plein texte + consultation (relais de flux)         | 1                 | Oui             |
| 4   | Rattachement aux objets du dossier                            | 2 + 3 + `Q-38-01` | Oui             |

Ordre : 0 → 1 → (2 ∥ 3) → 4. Les lots 2 et 3 sont parallélisables **sauf** sur
`gateway.openapi.ts` et l'oracle de routes — merger 2 d'abord. **Le lot 0 ne se parallélise avec
rien** : il décide ce que les autres ont le droit de faire.

---

## Lot 0 — Les écrits, le lien, le secret

**Aucune fonctionnalité.** Ce lot existe parce que trois décisions doivent être **écrites** avant
qu'une ligne de code ne les présuppose — c'est exactement le mode de défaillance qu'`ADR-0007` a
été créé pour tuer (« écrire un registre sans trancher aurait empilé une troisième position »).

### Objectif

Les seuils franchis sont décidés et datés ; le lien réseau existe et se prouve ; le jeton est
posé sans rejouer `LE-58`.

### Périmètre exact

- **`docs/adr/0009-*.md`** — position sur le franchissement du seuil « donnée de santé »
  (SFD §7.1), avec **ses propres seuils de réouverture**, dont au minimum « un type médical entre
  au catalogue » et « la cible `ENFANT` est ouverte ». ⚠️ Le README de la racine annonce la plage
  d'ADR et leur intitulé, et `pnpm readme` **dérive son attendu de `docs/adr/`** : un ADR neuf non
  annoncé fait rougir la CI.
- **Amendement `ADR-0008` §1** (SFD §7.2) : constater que le premier cas prévu par son propre
  seuil de pagination est arrivé, et que la réponse est celle qu'il avait écrite (patron de la
  boîte de réception). Ne pas rouvrir l'ADR : l'amender.
- **doc 37** — traitement `T10`, ligne de conservation **`⛔` avec sa raison** (Paperless ne purge
  rien, sa suppression est une corbeille, et l'effacement effectif laisse des médias orphelins),
  limite d'effacement écrite au §4, et **réécriture de la ligne « Cloudflare » du §2** (il verra
  désormais des documents en clair).
- **Exploitation** : création du réseau Docker dédié (D1) ; jeton Paperless d'un utilisateur
  **dédié non administrateur** ; pose du secret côté creche-planner (D4).
- **Hors périmètre** : tout code applicatif ; la garde de démarrage (lot 1).

### Critères d'acceptation

- Depuis le conteneur `api-gateway`, l'API de Paperless répond, **et** l'instance reste
  injoignable depuis l'extérieur du serveur — les deux moitiés vérifiées, pas la première seule.
- `X-Api-Version` de la réponse est relevé et **noté dans la PR** : c'est la valeur que la garde
  du lot 1 confrontera.
- Le service portant le secret **redémarre réellement** sur la pile de production (`LE-53`), et
  sa racine immuable n'est pas défaite pour l'occasion (`LE-58`).
- `pnpm readme`, `pnpm statuts`, `pnpm liens`, `pnpm registre`, `pnpm portabilite`,
  `pnpm retentions` verts.

### Pièges connus

- ⚠️ **`pnpm conteneurs` ne lira jamais le compose de Paperless.** Le durcissement de l'autre pile
  est hors de portée de toutes les portes du dépôt — angle mort à déclarer, pas à combler.
- ⚠️ La pile Paperless a ses propres pièges vérifiés sur cette machine (racine immuable + `tmpfs`
  nu + conteneur non-root = écriture refusée **en silence**). Toucher à son compose sans les
  connaître est le meilleur moyen de casser une GED qui marche.
- Un `docker compose down` d'une des deux piles ne doit pas emporter le réseau : `external: true`,
  vérifié par un `down`/`up` réel des deux côtés.

---

## Lot 1 — Client Paperless dans la passerelle

**Dépend du lot 0.** Aucune route exposée, aucune UI : le client et ses gardes.

### Objectif

La passerelle sait parler à Paperless — sur la bonne version d'API, avec le bon jeton, sans
jamais perdre un champ en silence — et **refuse de démarrer** si l'une de ces conditions n'est
pas réunie.

### Périmètre exact

- `apps/api-gateway/src/clients/paperless.client.ts` (+ specs) : dépôt (`post_document`),
  interrogation de tâche (`/api/tasks/?task_id=`), recherche (`/api/documents/?query=` +
  `tags__id__all=`), lecture d'un document, flux d'aperçu / miniature / téléchargement.
  Réutiliser `appel-resilient.ts` (timeout, disjoncteur, erreurs typées) — ⚠️ **son
  dimensionnement est celui du JSON** : les flux de fichiers ont leur propre budget (voir pièges).
- **Garde de démarrage** : réseau joignable + `X-Api-Version` conforme + jeton accepté. Un échec
  nomme la cause exacte (réseau / version / jeton) et **arrête le service**, patron de la
  validation d'environnement déjà en place.
- **Fixture de contrat** : capture réelle d'une réponse Paperless (document, page de résultats,
  tâche), commitée, **régénérée par commande** (D8), avec sa sonde négative — retirer un champ de
  la fixture doit faire **rouge**.
- Configuration : URL interne, jeton, version d'API attendue, taille maximale de dépôt — déclarées
  dans le `config.ts` de l'app et dans `CHAMPS_ENV` (`pnpm environnement` refuse une variable
  posée par un compose et non déclarée).
- **Hors périmètre** : toute route BFF (lots 2/3), toute UI, toute persistance.

### Critères d'acceptation

- Les champs consommés sont **requis** dans le schéma du client : un champ renommé fait échouer,
  pas `undefined` (`LE-48`, `MO-1`).
- **Sonde négative du scoping** (D3) : une recherche dont la saisie contient des opérateurs
  booléens et un terme de champ ne rend **aucun** document hors du tag de foyer. Ce test est le
  cœur du lot ; s'il n'existe pas, le lot n'est pas fini.
- Garde de démarrage : trois échecs simulés (réseau absent, version divergente, jeton refusé) →
  trois messages distincts, et le service ne démarre dans aucun des trois cas.
- `pnpm nx run-many -t typecheck test lint -p api-gateway` vert ; ratchet de couverture tenu.

### Pièges connus

- ⚠️ **Le dépôt est asynchrone.** `post_document` rend un **identifiant de tâche**, pas un
  document : il n'y a pas d'identifiant de document à la réponse. Tout code qui suppose l'inverse
  marche en test et échoue au premier fichier réel.
- ⚠️ Le disjoncteur et le délai d'`appel-resilient` sont taillés pour des réponses JSON courtes.
  Un envoi de plusieurs mégaoctets depuis un téléphone en 4G les dépassera : budget distinct, et
  un dépôt lent **ne doit pas** ouvrir le disjoncteur des autres appels.
- Paperless détecte les doublons et **refuse** l'ingestion : ce n'est pas une panne, c'est un
  résultat métier à traduire en message.
- `verbatimModuleSyntax` côté web ; `noUncheckedIndexedAccess` sur les accès indexés.

---

## Lot 2 — Dépôt depuis l'app

**Dépend du lot 1.**

### Objectif

`US-38-01` : un parent dépose un document depuis son téléphone, avec un type et une date, et
l'écran ne dit « déposé » que lorsque c'est vrai.

### Périmètre exact

- BFF : `POST /api/v1/foyers/:foyerId/documents` (`@FoyerScope('param:foyerId')`), corps
  multipart ; applique le tag de foyer et le tag de type ; rend l'identifiant de **suivi**.
  `GET …/documents/depots/:suivi` pour l'état d'ingestion.
- Catalogue de types (SFD §3.1) : donnée paramétrée, avec ses cibles admissibles. **Sans type
  médical** sous l'hypothèse H2.
- Web/PWA : écran de dépôt (choix de fichier ou appareil photo, type, date), état
  « en traitement » honnête, messages d'échec actionnables, refus **avant envoi** au-delà de la
  taille maximale.
- Piste d'audit : action de dépôt inscrite (doc 37 §7, classe `auditée`).
- Checklist contrat §4 ; codes d'erreur au registre `CODES_PROBLEME`.
- **Hors périmètre** : recherche (lot 3), rattachement (lot 4).

### Critères d'acceptation

- Un dépôt réel apparaît dans Paperless avec ses deux tags, son titre et sa date.
- L'écran n'annonce jamais « déposé » avant que la tâche ne soit aboutie (`CA2`) ; un échec
  d'ingestion est affiché avec son motif.
- À 375 px : cibles tactiles conformes, aucun piège au clavier, contrastes tenus en clair et en
  sombre (la cible du dépôt est **WCAG 2.2 AA**, doc 11).
- `pnpm nx run-many -t typecheck test lint -p api-gateway web` vert.

### Pièges connus

- ⚠️ Un corps multipart traverse la limite de taille de la passerelle **et** celle de nginx : les
  deux se règlent, et l'une sans l'autre produit une erreur opaque côté navigateur.
- L'audit `axe-core` est vert sur des choses qu'il ne regarde pas (focus, bordures, `:disabled`,
  `opacity` d'ancêtre — fiche `a11y-axe-angles-morts`) : le balayage se fait à la main en plus.
- Le ratchet ESLint est un **plafond global** vérifié en **CI seulement** : pousser tôt.

---

## Lot 3 — Recherche plein texte et consultation

**Dépend du lot 1.** Parallélisable avec le lot 2, à merger après lui (collision sur
`gateway.openapi.ts` et l'oracle de routes).

### Objectif

`US-38-02` / `US-38-03` : chercher dans le contenu depuis l'app, ouvrir un aperçu, télécharger —
sans jamais exposer Paperless au navigateur.

### Périmètre exact

- BFF : `GET /api/v1/foyers/:foyerId/documents?q=&page=` (recherche, **pagination assumée** —
  l'amendement `ADR-0008` du lot 0 en est le fondement) ; `GET …/documents/:id` ;
  `GET …/documents/:id/apercu` et `…/telecharger` en **flux relayé** (D6).
- Forme de réponse : `results` bornés + `count` non borné, patron de la boîte de réception.
- Web : écran de recherche (saisie, résultats avec titre/type/date, extraits surlignés **affichés
  tels quels**, jamais interprétés — la 3.x change de moteur, SFD §8), aperçu, téléchargement.
- **Hors périmètre** : rattachement (lot 4) ; toute écriture sur le coffre (`RM-38-05`).

### Critères d'acceptation

- **Le critère n°1 est négatif** : aucune saisie ne fait apparaître un document hors du foyer,
  y compris avec opérateurs booléens et termes de champ (D3, sonde du lot 1 rejouée de bout en
  bout).
- Un identifiant de document hors foyer rend **404**, pas 403 (`CA2` de `US-38-03`).
- Aucune URL de Paperless n'apparaît dans le HTML servi ni dans les requêtes du navigateur —
  vérifié en regardant le trafic réel, pas le code.
- Le téléchargement d'un fichier volumineux n'est pas mis en mémoire par la passerelle (flux, pas
  tampon).

### Pièges connus

- ⚠️ Relayer un flux en conservant `Content-Type`, `Content-Length` et le nom de fichier, sans le
  bufferiser — c'est le point où une implémentation naïve fait exploser la mémoire de la
  passerelle sur un scan de 50 Mo.
- ⚠️ La recherche de Paperless **classe** les résultats ; ne rien construire sur le score ni sur
  la forme des surlignages (ils changent en 3.x).
- Le cache du client web (`viderCacheAsync` dans les tests) : une clé de recherche périmée fait
  croire à un bug de scoping alors que c'est un cache.

---

## Lot 4 — Rattachement aux objets du dossier

**Dépend des lots 2 et 3, et de `Q-38-01`.** C'est le lot qui tient la promesse d'`AM-65`.

### Objectif

`US-38-04` : depuis un contrat, un mois facturé ou un objet du dossier, voir et attacher les
justificatifs qui le documentent.

### Périmètre exact

- **Une table**, `rattachement_document`, dans un service (H7) : foyer, identifiant de document,
  cible typée, type de document, date, acteur. Relation n-à-n avec les cibles (`CA2`).
- **doc 37 §6** : ligne de classement de la table — `pnpm portabilite` **dérive son attendu des
  `schema.ts`**, donc une table nouvelle sans ligne fait échouer la CI. Classe proposée :
  `exportée` (métadonnées et cible, jamais le fichier).
- **Effacement du foyer** : la cascade emporte les rattachements, **pas** les documents (H3) —
  et cette limite est écrite en doc 37 §4, à côté des deux exceptions déjà documentées.
- Web : encart « justificatifs » sur les objets concernés ; rattachement depuis la recherche ;
  état « document introuvable dans le coffre » pour un rattachement orphelin (`CA3`).
- Piste d'audit sur la mutation ; checklist contrat §4 ; pact consumer + provider pour les routes
  du service (celles-là, contrairement au relais Paperless, sont couvertes par le registre de
  contrats).
- **Hors périmètre** : la cible `ENFANT` **si** H2 tient (elle rouvrirait la qualification du
  drapeau `pai`, doc 37 §1 — voir pièges).

### Critères d'acceptation

- Un document rattaché à douze mois apparaît sur les douze, sans duplication de document.
- Supprimer un rattachement laisse le document intact dans le coffre (`RM-38-05`).
- Effacer le foyer efface les rattachements et **rien d'autre** — vérifié côté Paperless, pas
  seulement côté base.
- `pnpm portabilite`, `pnpm acteur`, `pnpm retentions` verts ; pactes verts.

### Pièges connus

- ⚠️ **Ouvrir la cible `ENFANT` rouvre mécaniquement la qualification du drapeau `pai`.** La
  doc 37 §1 écrit que cette qualification « est rouverte si le champ venait à porter un motif ou
  une pièce jointe ». Attacher un document à un enfant, c'est la pièce jointe. Si le PO ouvre
  cette cible, l'`ADR-0009` du lot 0 doit être **rouvert dans le même lot**, pas après.
- Un rattachement orphelin est un **état normal** (le coffre est géré hors de l'app) : il
  s'affiche, il ne se corrige pas tout seul et il ne plante rien.

---

## Récapitulatif des actions ops (PO — hors code)

1. **Trois réponses avant tout** : `Q-38-01` (type médical / cible enfant), `Q-38-02`
   (effacement en cascade), `Q-38-03` (transit des documents au niveau du proxy Cloudflare). Sans
   elles, le lot 0 n'a rien à écrire.
2. **Créer le réseau Docker dédié** entre les deux piles, et vérifier **les deux moitiés** :
   joignable depuis `api-gateway`, injoignable depuis l'extérieur du serveur.
3. **Créer un utilisateur Paperless dédié non administrateur** et son jeton ; poser le secret
   sans le rendre incompatible avec la racine immuable (`LE-58`), et vérifier par **redémarrage
   réel** sur la pile de production (`LE-53`).
4. **Relever `X-Api-Version`** sur l'instance réelle et le noter : c'est l'attendu de la garde de
   démarrage.
5. **Décider du moment de la migration Paperless 3.x** — non bloquante grâce à l'épinglage
   `version=9`, mais elle réécrit le consommateur et remplace le moteur de recherche : après le
   lot 3 plutôt que pendant.
6. **Essai réel de bout en bout depuis un téléphone**, hors du réseau de la maison : c'est le seul
   test qui prouve que le chantier sert à quelque chose, et il ne peut pas être automatisé.
