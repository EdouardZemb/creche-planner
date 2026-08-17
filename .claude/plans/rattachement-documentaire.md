# Plan d'exécution — SFD 38 « Rattachement documentaire »

> **Statut** : **NE PAS DÉMARRER — arbitrage roadmap PO.** La SFD
> [`docs/38-sfd-rattachement-documentaire.md`](../../docs/38-sfd-rattachement-documentaire.md)
> est un **brouillon v0.2 à valider** ; ce plan en est la traduction en lots, écrite en même
> temps pour que le PO voie ce que la validation engage — pas pour être exécuté.
>
> **Amendé le 2026-08-17 (amendement 1 de la SFD, §7.7 — le transport).** `Q-38-03` est
> **tranchée** : les documents **et leurs métadonnées** ne passent plus par le bord public
> (tunnel Cloudflare) mais par un **second bord Tailscale**. Le plan passe de **5 à 6 lots** — le
> nouveau lot 1 porte ce second bord. Deux questions PO restent bloquantes : `Q-38-01` (type
> médical / cible enfant → position de l'`ADR-0009`) et `Q-38-02` (effacement en cascade) ; une
> troisième oriente le découpage sans le bloquer : `Q-38-07` (repli **a3** plutôt que **a1**).
>
> **Place dans la séquence** : la note de vision (`vision-plateforme-foyer-2026-08.md` §3) situe
> `AM-65` « au plus tôt à l'étape 3 » — après consolidation, après la séquence SFD 31 → 33, avec
> `factures-reelles`. Ce plan ne réclame pas d'être avancé ; il existe pour être **arbitré**.
>
> ⚠️ **Un préalable qui n'appartient pas à ce chantier** : `AM-94` (la porte d'entrée LAN de
> l'application contourne l'authentification, et la route de sous-réseau Tailscale du 2026-08-16
> l'a rendue joignable de partout). Elle est **antérieure et indépendante**, mais le lot 1 pose un
> second bord sur exactement cette frontière : la traiter avant évite de bâtir sur une question
> ouverte.

## 1. Contexte et objectif

Une GED (Paperless-ngx 2.20.6) tourne déjà sur le serveur du foyer, remise en service le
2026-08-16. Elle fait l'ingestion, l'OCR, le classement et la recherche. Ce qui manque est le
**chemin** entre elle et l'application : déposer suppose d'être sur le réseau de la maison,
retrouver suppose de changer d'outil, et rien ne relie un document à l'objet métier qu'il
justifie.

Après ce chantier : un parent dépose depuis son téléphone, cherche en plein texte et consulte
depuis l'app ; un justificatif se voit depuis le contrat, le mois ou l'objet qu'il documente.
**Aucun octet de document n'est stocké par creche-planner** — Paperless reste l'unique coffre —
et **aucun ne transite par un tiers** : le documentaire est servi par le bord tailnet.

## 2. Hypothèses assumées (à corriger par le PO si fausses)

- **H1** — L'instance Paperless reste en **2.20.6** au démarrage ; la migration 3.x est
  indépendante et non bloquante grâce à l'épinglage `Accept: application/json; version=9`
  (SFD §8). ⚠️ Si elle est faite **pendant** le chantier, rejouer le lot 2 de bout en bout : la
  3.0 a réécrit le consommateur et remplacé le moteur de recherche.
- **H2** — Position `ADR-0009` = **(b)** (SFD §7.1) : exemption maintenue par écrit, contrepartie
  = **aucun type médical au catalogue** et **cible `ENFANT` fermée** en v1. Si le PO répond (a),
  ajouter un lot d'amont (base légale, AIPD, droits) **avant** le lot 2. Si (c), plan écarté.
- **H3** — Effacement du foyer : **les rattachements partent, les documents restent** (SFD §7.5).
- **H4 (révisée 2026-08-17) — le transport est le bord tailnet, variante `a1`.** Les routes
  documentaires, métadonnées comprises, sont servies **uniquement** par un second bord Tailscale ;
  le bord public n'expose qu'un compte neutre. ⚠️ **L'ancienne H4 (« transit par la passerelle
  publique accepté ») est retirée** : elle reposait sur une prémisse fausse — « réservé au
  tailnet » n'est pas « réservé à la maison ».
- **H5** — Le rattachement (lot 5) est **engagé**, pas optionnel : sans lui la promesse d'`AM-65`
  n'est pas tenue (SFD §2.1).
- **H6** — Aucune nouvelle dépendance npm : `fetch`, `FormData` et `Blob` natifs.
- **H7** — Le propriétaire du lien Paperless est la **passerelle**, pas un service métier : il n'y
  a rien à persister côté document, seulement à relayer. ⚠️ **Exception au lot 5** : la table
  `rattachement_document` est de la donnée de dossier — elle vit dans un **service**, pas dans la
  passerelle (qui n'a aucune base, doc 37 §0).
- **H8 (nouvelle) — les deux parents sont dans le tailnet.** C'est le **seul geste utilisateur**
  du dispositif, et il conditionne toutes les variantes retenues, y compris le repli `a3`.

## 3. Décisions structurantes

- **D0 (nouvelle) — deux bords, une partition gardée.** Bord public (tunnel, identité par JWT
  Cloudflare Access) = toute l'app **sauf** le documentaire, qui y répond **404**. Bord tailnet
  (Tailscale Serve, identité par en-tête vérifié) = le documentaire et ses métadonnées. La
  partition est tenue par une **porte de CI**, pas par une convention.
- **D0bis — un nœud Tailscale dédié à creche-planner**, avec son adresse et son nom MagicDNS
  propres. Motif vérifié : `paperless-caddy` occupe déjà `0.0.0.0:443`, donc aussi le `:443` de
  l'adresse tailnet du serveur — Serve ne peut pas s'y poser. Un nœud par produit garde en outre
  les deux bords indépendants.
- **D0ter — l'identité tailnet n'est digne de foi que si le service est injoignable autrement.**
  Un en-tête d'identité est trivialement falsifiable par qui peut joindre le service sans passer
  par Serve — c'est la même faute que l'échappatoire `X-Dev-User-Email`, interdite en production.
  **Sonde négative obligatoire** : même requête, même en-tête, autre route ⇒ **refus**.
- **D1 — Le lien passerelle ↔ Paperless est un réseau Docker dédié, `external: true`, à deux
  membres**, créé une fois par l'exploitation, aucun port publié, survivant à un
  `docker compose down` des deux côtés (SFD §7.3). Son absence **arrête le démarrage** de la
  passerelle en nommant le réseau — jamais de dégradation en « recherche indisponible ».
- **D2 — Version d'API épinglée et vérifiée à l'exécution.** `Accept: application/json; version=9`
  sur chaque appel ; `X-Api-Version` de la réponse confronté à l'attendu. Un écart est une
  **erreur de configuration**, pas un avertissement.
- **D3 — Le filtre de foyer est un paramètre structuré, jamais du texte concaténé.** La saisie de
  l'utilisateur va dans `query=`, le foyer va dans `tags__id__all=`. Concaténer serait injectable
  (`RM-38-04`). **Sonde négative obligatoire.**
- **D4 — Le jeton n'est jamais un secret Compose de source `environment:`** sur un service à
  racine immuable (`LE-58`, production cassée le 2026-08-15). Source `file:` ou variable simple ;
  vérification par **redémarrage réel sur la pile qui porte le réglage** (`LE-53`).
- **D5 — Dépendance sortante uniquement.** L'issue d'une ingestion se connaît en **interrogeant**
  `/api/tasks/`, jamais par un rappel entrant. C'est ce qui garde `ADR-0008` §2 fermé (SFD §7.2).
- **D6 — Aucun cache disque, aucun stockage d'octets.** Aperçu et téléchargement sont des flux
  relayés.
- **D7 — L'identifiant Paperless est opaque au web.**
- **D8 — La garde de forme s'appuie sur une capture réelle, régénérée par commande** (`MO-3`).
- **D9 (nouvelle) — hors tailnet, le documentaire est absent et l'écran le dit.** « Vos
  justificatifs sont visibles depuis les appareils du foyer » : pas une erreur, pas un
  chargement infini, pas un écran vide sans explication.

## 4. Conventions transversales

Identiques au plan `versionnement-dates-effet.md` §4. S'y ajoutent :

- **Checklist contrat BFF** pour chaque lot exposant une route relayée : entrée dans
  `libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts` ; oracle « expose exactement les N
  routes attendues » à faire évoluer ; `pnpm nx run web:generate-types` sans diff (job
  `openapi-types-drift`) ; **pas de pact** pour le relais Paperless — ce n'est pas un service du
  dépôt et le registre de contrats (ADR-0005) ne le couvre pas. **Écart à écrire dans la PR**,
  pas un oubli.
- ⚠️ **Le document OpenAPI doit dire quel bord sert quoi.** Une route documentaire y figure comme
  servie par le bord tailnet ; l'oracle de couverture compare le document au graphe de modules
  Nest et ne sait rien des bords — c'est donc une **porte à écrire** (lot 1), pas une propriété
  acquise.
- **Codes d'erreur** au registre `CODES_PROBLEME` (`pnpm problemes` compare l'énumération du
  contrat au registre, dans les deux sens).
- **Piste d'audit** : dépôt et rattachement sont des mutations du dossier → ligne `auditée` en
  doc 37 §7 dès le premier commit (`pnpm acteur` dérive son attendu des contrôleurs). ⚠️ Sans le
  lot 1, une action faite par le bord tailnet s'inscrirait `acteur_type = 'inconnu'`.
- **Sécurité inter-services** : toute route de service neuve porte son scoping dès le premier
  commit (bascule `INTERSERVICE_AUTHZ_ENFORCE=1` à venir).

## 5. Vue d'ensemble des lots

**Découpage révisé le 2026-08-17** (amendement 1) : 5 → **6 lots**. Le second bord se décide
**avant** le client Paperless, parce qu'il fixe qui a le droit d'appeler quoi — le poser après
obligerait à re-partitionner des routes déjà publiées.

| #   | Lot                                                           | Dépend de         | Livre du code ? |
| --- | ------------------------------------------------------------- | ----------------- | --------------- |
| 0   | Les écrits + le lien réseau + le secret + le nœud tailnet     | décisions PO      | Presque pas     |
| 1   | **Le second bord** : identité tailnet + partition gardée      | 0 (+ `AM-94`)     | Oui             |
| 2   | Client Paperless dans la passerelle (sortant, épinglé, gardé) | 1                 | Oui             |
| 3   | Dépôt depuis l'app (route, écran, PWA)                        | 2                 | Oui             |
| 4   | Recherche plein texte + consultation (relais de flux)         | 2                 | Oui             |
| 5   | Rattachement aux objets du dossier                            | 3 + 4 + `Q-38-01` | Oui             |

Ordre : 0 → 1 → 2 → (3 ∥ 4) → 5. Les lots 3 et 4 sont parallélisables **sauf** sur
`gateway.openapi.ts` et l'oracle de routes — merger 3 d'abord. **Les lots 0 et 1 ne se
parallélisent avec rien** : ils décident ce que les autres ont le droit de faire.

### Variante `a3` — le repli, si `Q-38-07` le retient

Si le PO préfère ne pas développer de dépôt ni de recherche dans l'app (SFD §7.7, variante a3) :
Paperless est joint **directement** par le tailnet pour déposer et consulter, et le chantier se
réduit à **lot 0 + lot 1 + lot 5**. Les lots 2 à 4 disparaissent.

C'est **la moitié du travail pour l'essentiel de la valeur** — et c'est la position d'origine de
la note de vision (« la valeur côté app est le **lien** »). Le lot 1 reste nécessaire : sans
identité sur le bord tailnet, le rattachement s'inscrirait sans acteur. `a1` reste livrable
**après** `a3`, sans rien jeter.

---

## Lot 0 — Les écrits, le lien, le secret, le nœud tailnet

**Aucune fonctionnalité.** Ce lot existe parce que des décisions doivent être **écrites** avant
qu'une ligne de code ne les présuppose — le mode de défaillance qu'`ADR-0007` a été créé pour
tuer.

### Périmètre exact

- **`docs/adr/0009-*.md`** — position sur le franchissement du seuil « donnée de santé »
  (SFD §7.1), avec **ses propres seuils de réouverture** (au minimum : « un type médical entre au
  catalogue », « la cible `ENFANT` est ouverte »). ⚠️ `pnpm readme` **dérive son attendu de
  `docs/adr/`** : un ADR neuf non annoncé au README fait rougir la CI.
- **Amendement `ADR-0008` §1** : constater que le premier cas prévu par son seuil de pagination
  est arrivé, et que la réponse est celle qu'il avait écrite (patron de la boîte de réception).
  Amender, pas rouvrir.
- **doc 37** — traitement `T10`, conservation **`⛔` avec sa raison** (Paperless ne purge rien, sa
  suppression est une corbeille, l'effacement effectif laisse des médias orphelins), limite
  d'effacement au §4, et **réécriture de la ligne « Cloudflare » du §2** : elle voit désormais
  qu'il **existe** des justificatifs, jamais ce qu'ils sont (amendement 1).
- **Exploitation** : réseau Docker dédié passerelle ↔ Paperless (D1) ; **nœud Tailscale dédié à
  creche-planner** (D0bis) ; second parent ajouté au tailnet (H8) ; utilisateur Paperless **dédié
  non administrateur** et son jeton ; pose du secret (D4).
- **Hors périmètre** : tout code applicatif ; la garde de démarrage (lot 2) ; l'identité tailnet
  (lot 1).

### Critères d'acceptation

- Depuis le conteneur `api-gateway`, l'API de Paperless répond, **et** l'instance reste
  injoignable depuis l'extérieur du serveur — **les deux moitiés vérifiées**, pas la première.
- Le nœud tailnet de creche-planner répond sur son nom MagicDNS, **sans** entrer en conflit avec
  `paperless-caddy` sur `:443` (le conflit est le motif même de D0bis — le vérifier, pas le
  supposer).
- Depuis le téléphone du second parent, hors du réseau de la maison, le nœud répond.
- `X-Api-Version` de l'instance réelle relevé et **noté dans la PR** : c'est l'attendu du lot 2.
- Le service portant le secret **redémarre réellement** sur la pile de production (`LE-53`), sa
  racine immuable intacte (`LE-58`).
- `pnpm readme`, `pnpm statuts`, `pnpm liens`, `pnpm registre`, `pnpm portabilite`,
  `pnpm retentions` verts.

### Pièges connus

- ⚠️ **`pnpm conteneurs` ne lira jamais le compose de Paperless** : le durcissement de l'autre
  pile est hors de portée de toutes les portes du dépôt — angle mort à déclarer, pas à combler.
- ⚠️ La pile Paperless a ses propres pièges vérifiés (racine immuable + `tmpfs` nu + conteneur
  non-root = écriture refusée **en silence**). Toucher son compose sans les connaître est le
  meilleur moyen de casser une GED qui marche.
- ⚠️ **Ouvrir une route ou un nœud tailnet change l'adresse source des clients** et casse toute
  règle d'accès fondée sur l'adresse — vécu le 2026-08-16 sur le partage Samba, rejeté **avant
  authentification** et sans message clair. Relire chaque règle par adresse avant de conclure à
  une panne.
- ⚠️ **Le pare-feu de l'hôte ne filtre pas le tailnet** : la chaîne Tailscale accepte avant toute
  règle ufw. Le vrai contrôle d'accès est la **politique ACL de la console**, et c'est là qu'il
  faut restreindre.
- Un `docker compose down` d'une des deux piles ne doit pas emporter le réseau : `external: true`,
  vérifié par un `down`/`up` réel des deux côtés.

---

## Lot 1 — Le second bord : identité tailnet et partition gardée

**Dépend du lot 0.** Aucune fonctionnalité documentaire : c'est le lot qui décide **qui** peut
appeler **quoi**, et par **où**.

### Objectif

La passerelle sait établir une identité de personne sur **deux** bords, et une route documentaire
est **structurellement** absente du bord public.

### Périmètre exact

- `apps/api-gateway/src/security/identite.ts` / `identite.guard.ts` : **seconde source
  d'identité**, l'en-tête vérifié posé par Tailscale Serve, acceptée **uniquement** sur le chemin
  qui la produit (D0ter). Le guard actuel pose l'identité sans jamais refuser — la nouvelle source
  suit exactement le même contrat, la décision restant à `AppartenanceGuard`.
- **Partition de routes** : un marqueur déclaratif (dans l'esprit de `@FoyerScope` — un décorateur
  qui rend l'inventaire **visible**) disant qu'une route est documentaire, donc servie par le bord
  tailnet seul ; le bord public rend **404** (`RM-38-02`).
- **Porte de CI** — le cœur du lot : l'ensemble des routes marquées documentaires, **dérivé des
  contrôleurs**, est confronté à ce que le bord public expose. Une route documentaire atteignable
  publiquement fait échouer la CI. Attendu **dérivé**, jamais recopié (`MO-3`).
- Configuration : nom du bord tailnet, en-tête d'identité attendu — dans le `config.ts` de l'app
  et dans `CHAMPS_ENV` (`pnpm environnement`).
- doc 37 §7 : les actions faites par le bord tailnet nomment une **personne**, pas `inconnu`.
- **Hors périmètre** : tout appel à Paperless (lot 2) ; toute UI.

### Critères d'acceptation

- **Sonde négative n°1 (identité)** : même requête, même en-tête d'identité, présentée hors du
  chemin Serve ⇒ **refus**. Sans ce test, le bord tailnet est un en-tête que n'importe qui écrit.
- **Sonde négative n°2 (partition)** : marquer une route comme documentaire et la laisser servie
  par le bord public doit faire **rouge**. Une porte qui reste verte ne garde rien.
- Une action faite par le bord tailnet apparaît dans `journal_audit` avec l'e-mail de la personne,
  pas `acteur_type = 'inconnu'`.
- `pnpm nx run-many -t typecheck test lint -p api-gateway` vert ; `pnpm acteur` vert.

### Pièges connus

- ⚠️ **C'est ici que `AM-94` devient bloquante.** Poser un second bord sur une frontière dont
  personne ne sait ce qu'elle authentifie, c'est bâtir sur une question ouverte. Trancher `AM-94`
  d'abord, ou constater explicitement dans la PR ce que la porte LAN fait réellement.
- ⚠️ Le bord public et le bord tailnet servent **la même application** : une route « oubliée » de
  la partition est publique **par défaut**. C'est le bon défaut (elle ne fuite pas d'un coup), mais
  il faut que l'inventaire soit dérivé, sinon l'oubli est silencieux — motif `MO-1`.
- Le front doit savoir sur quel bord il tourne pour afficher le bon message (D9) sans tenter un
  appel voué au 404.

---

## Lot 2 — Client Paperless dans la passerelle

**Dépend du lot 1.** Aucune route exposée, aucune UI : le client et ses gardes.

### Objectif

La passerelle sait parler à Paperless — bonne version d'API, bon jeton, sans jamais perdre un
champ en silence — et **refuse de démarrer** si l'une de ces conditions manque.

### Périmètre exact

- `apps/api-gateway/src/clients/paperless.client.ts` (+ specs) : dépôt (`post_document`),
  interrogation de tâche (`/api/tasks/?task_id=`), recherche (`/api/documents/?query=` +
  `tags__id__all=`), lecture d'un document, flux d'aperçu / miniature / téléchargement. Réutiliser
  `appel-resilient.ts` — ⚠️ **son dimensionnement est celui du JSON**, les flux de fichiers ont
  leur propre budget.
- **Garde de démarrage** : réseau joignable + `X-Api-Version` conforme + jeton accepté ; un échec
  nomme la cause exacte et **arrête le service**.
- **Fixture de contrat** : capture réelle (document, page de résultats, tâche), commitée,
  **régénérée par commande** (D8), avec sa sonde négative.
- Configuration déclarée dans `config.ts` et `CHAMPS_ENV`.
- **Hors périmètre** : toute route BFF (lots 3/4), toute UI, toute persistance.

### Critères d'acceptation

- Les champs consommés sont **requis** dans le schéma du client : un champ renommé fait échouer,
  pas `undefined` (`LE-48`, `MO-1`).
- **Sonde négative du scoping** (D3) : une recherche dont la saisie contient des opérateurs
  booléens et un terme de champ ne rend **aucun** document hors du tag de foyer. C'est le cœur du
  lot ; sans ce test, le lot n'est pas fini.
- Trois échecs simulés (réseau absent, version divergente, jeton refusé) → trois messages
  distincts, et le service ne démarre dans aucun des trois cas.
- `pnpm nx run-many -t typecheck test lint -p api-gateway` vert ; ratchet de couverture tenu.

### Pièges connus

- ⚠️ **Le dépôt est asynchrone** : `post_document` rend un **identifiant de tâche**, pas un
  document. Tout code supposant l'inverse marche en test et échoue au premier fichier réel.
- ⚠️ Le disjoncteur et le délai d'`appel-resilient` sont taillés pour du JSON court : un envoi de
  plusieurs mégaoctets depuis un téléphone les dépassera, et un dépôt lent **ne doit pas** ouvrir
  le disjoncteur des autres appels.
- Paperless détecte les doublons et **refuse** l'ingestion : résultat métier, pas panne.

---

## Lot 3 — Dépôt depuis l'app

**Dépend du lot 2.** Routes **documentaires** : bord tailnet seul (D0/`RM-38-02`).

### Périmètre exact

- BFF : `POST /api/v1/foyers/:foyerId/documents` (`@FoyerScope('param:foyerId')` **et** marqueur
  documentaire du lot 1), corps multipart ; applique le tag de foyer et le tag de type ; rend un
  identifiant de **suivi**. `GET …/documents/depots/:suivi` pour l'état d'ingestion.
- Catalogue de types (SFD §3.1), **sans type médical** sous H2.
- Web/PWA : écran de dépôt (fichier ou appareil photo, type, date), état « en traitement »
  honnête, messages d'échec actionnables, refus **avant envoi** au-delà de la taille maximale,
  et **message hors tailnet** (D9).
- Piste d'audit ; checklist contrat §4 ; codes d'erreur au registre.

### Critères d'acceptation

- Un dépôt réel apparaît dans Paperless avec ses deux tags, son titre et sa date.
- L'écran n'annonce jamais « déposé » avant que la tâche ne soit aboutie (`CA2`).
- **Depuis le bord public, la route répond 404** — vérifié, pas supposé.
- À 375 px : cibles tactiles conformes, aucun piège au clavier, contrastes tenus en clair et en
  sombre (cible **WCAG 2.2 AA**, doc 11).

### Pièges connus

- ⚠️ Un corps multipart traverse la limite de taille de la passerelle **et** celle de nginx : les
  deux se règlent, et l'une sans l'autre produit une erreur opaque côté navigateur.
- L'audit `axe-core` est vert sur ce qu'il ne regarde pas (focus, bordures, `:disabled`, `opacity`
  d'ancêtre) : balayage à la main en plus.
- Le ratchet ESLint est un **plafond global** vérifié en **CI seulement** : pousser tôt.

---

## Lot 4 — Recherche plein texte et consultation

**Dépend du lot 2.** Parallélisable avec le lot 3, à merger après lui. Bord tailnet seul.

### Périmètre exact

- BFF : `GET …/documents?q=&page=` (**pagination assumée** — l'amendement `ADR-0008` du lot 0 en
  est le fondement) ; `GET …/documents/:id` ; `…/apercu` et `…/telecharger` en **flux relayé**
  (D6). Réponse : `results` bornés + `count` non borné, patron de la boîte de réception.
- Web : écran de recherche, extraits surlignés **affichés tels quels**, jamais interprétés (la
  3.x change de moteur, SFD §8) ; aperçu ; téléchargement ; message hors tailnet (D9).

### Critères d'acceptation

- **Le critère n°1 est négatif** : aucune saisie ne fait apparaître un document hors du foyer, y
  compris avec opérateurs booléens et termes de champ (D3).
- Un identifiant de document hors foyer rend **404**, pas 403.
- Aucune URL de Paperless n'apparaît dans le HTML servi ni dans les requêtes du navigateur —
  vérifié en regardant le trafic réel.
- Le téléchargement d'un fichier volumineux n'est pas mis en mémoire par la passerelle.

### Pièges connus

- ⚠️ Relayer un flux en conservant `Content-Type`, `Content-Length` et le nom de fichier **sans le
  bufferiser** : c'est le point où une implémentation naïve fait exploser la mémoire sur un scan
  de 50 Mo.
- ⚠️ Ne rien construire sur le score ni sur la forme des surlignages (ils changent en 3.x).
- Le cache du client web (`viderCacheAsync` dans les tests) : une clé périmée fait croire à un bug
  de scoping alors que c'est un cache.

---

## Lot 5 — Rattachement aux objets du dossier

**Dépend des lots 3 et 4 (ou du seul lot 1 en variante `a3`), et de `Q-38-01`.** C'est le lot qui
tient la promesse d'`AM-65`.

### Périmètre exact

- **Une table**, `rattachement_document`, dans un service (H7) : foyer, identifiant de document,
  cible typée, type, date, acteur. Relation n-à-n avec les cibles.
- **doc 37 §6** : ligne de classement — `pnpm portabilite` **dérive son attendu des `schema.ts`**,
  une table nouvelle sans ligne fait échouer la CI. Classe proposée : `exportée` (métadonnées et
  cible, jamais le fichier).
- **Effacement du foyer** : la cascade emporte les rattachements, **pas** les documents (H3),
  écrit en doc 37 §4 à côté des deux exceptions déjà documentées.
- Web : encart « justificatifs » sur les objets concernés — **titres et types sur le bord tailnet
  seul**, **compte neutre** sur le bord public (« 3 justificatifs — visibles depuis les appareils
  du foyer », SFD §7.7). État « document introuvable dans le coffre » pour un rattachement
  orphelin.
- Piste d'audit ; checklist contrat §4 ; pact consumer + provider pour les routes du service
  (celles-là, contrairement au relais Paperless, sont couvertes par le registre de contrats).
- **Hors périmètre** : la cible `ENFANT` **si** H2 tient.

### Critères d'acceptation

- Un document rattaché à douze mois apparaît sur les douze, sans duplication.
- Supprimer un rattachement laisse le document intact dans le coffre (`RM-38-05`).
- Effacer le foyer efface les rattachements et **rien d'autre** — vérifié côté Paperless, pas
  seulement côté base.
- **Depuis le bord public, l'encart affiche un compte et aucun titre** — c'est la dernière fuite
  possible, et c'est le seul test qui la ferme.
- `pnpm portabilite`, `pnpm acteur`, `pnpm retentions` verts ; pactes verts.

### Pièges connus

- ⚠️ **Ouvrir la cible `ENFANT` rouvre mécaniquement la qualification du drapeau `pai`.** La
  doc 37 §1 écrit qu'elle est rouverte « si le champ venait à porter un motif ou **une pièce
  jointe** ». Attacher un document à un enfant, c'est la pièce jointe. Si le PO ouvre cette cible,
  l'`ADR-0009` du lot 0 doit être **rouvert dans le même lot**, pas après.
- Un rattachement orphelin est un **état normal** (le coffre se gère hors de l'app) : il
  s'affiche, il ne se corrige pas tout seul, il ne plante rien.

---

## Récapitulatif des actions ops (PO — hors code)

1. **Deux réponses avant tout** : `Q-38-01` (type médical / cible enfant) et `Q-38-02`
   (effacement en cascade). Sans elles, le lot 0 n'a rien à écrire. Une troisième oriente le
   découpage : `Q-38-07` (repli `a3` — moitié du travail, essentiel de la valeur).
2. **Le second parent rejoint le tailnet** (H8) — seul geste utilisateur, prérequis de toutes les
   variantes.
3. **Créer le nœud Tailscale dédié à creche-planner** (D0bis), et vérifier qu'il ne heurte pas le
   `:443` déjà pris par `paperless-caddy`.
4. **Créer le réseau Docker dédié** entre les deux piles, et vérifier **les deux moitiés** :
   joignable depuis `api-gateway`, injoignable depuis l'extérieur du serveur.
5. **Créer un utilisateur Paperless dédié non administrateur** et son jeton ; poser le secret sans
   le rendre incompatible avec la racine immuable (`LE-58`) ; vérifier par **redémarrage réel**
   (`LE-53`).
6. **Relever `X-Api-Version`** sur l'instance réelle : c'est l'attendu de la garde du lot 2.
7. **Revoir la politique ACL du tailnet** — c'est le vrai contrôle d'accès (le pare-feu de l'hôte
   ne filtre pas le tailnet), et c'est elle qui décide qui atteint le bord documentaire.
8. **Décider du moment de la migration Paperless 3.x** — non bloquante (`version=9`), mais elle
   réécrit le consommateur et remplace le moteur de recherche : après le lot 4 plutôt que pendant.
9. **Essai réel de bout en bout depuis les deux téléphones, hors du réseau de la maison** : c'est
   le seul test qui prouve que le chantier sert à quelque chose, et il ne peut pas être automatisé.
