# 38 — SFD Rattachement documentaire : la GED du foyer branchée sur l'app

> Statut : **Brouillon — à valider PO** · Version 0.1 · 2026-08-17
> Instruit la piste `AM-65` ([doc 34](34-registre-ameliorations.md)) et la décision laissée
> ouverte par la note de vision (`.claude/plans/vision-plateforme-foyer-2026-08.md` §2 :
> « probablement via l'API de la GED, décision à instruire le moment venu »).
> **Rouvre `ADR-0007` et amende `ADR-0008`** — c'est le point dur de cette spécification, et il
> est traité au §7, pas renvoyé à l'exécution.

## 1. Contexte & problème

Le foyer possède déjà une GED : **Paperless-ngx**, auto-hébergée sur le même serveur que
l'application, remise en service le 2026-08-16 (dépôt par partage Samba, OCR, classement,
recherche plein texte). Elle fait très bien son métier, et la note de vision a tranché : **on ne
reconstruit pas une GED dans l'app.**

Ce qui manque n'est pas le stockage, c'est le **chemin entre les deux**. Aujourd'hui :

- déposer un document suppose d'être sur le réseau local (partage Samba, ou glisser-déposer dans
  l'interface web de Paperless) — l'application, elle, est jointe de partout par tunnel ;
- retrouver un justificatif suppose d'ouvrir un **autre** outil, avec **une autre
  authentification**, sur **un autre nom de domaine** ;
- et rien ne relie un document à l'objet métier qu'il justifie : la facture de crèche ne sait pas
  quel mois elle documente, le bulletin de paie ne sait pas quel revenu il prouve, l'avis
  d'imposition ne sait pas quel RFR il fonde.

Cette spécification décrit l'app comme **client** de Paperless : elle dépose, elle cherche, elle
affiche. **Paperless reste l'unique coffre** — aucun octet de document n'est stocké par
creche-planner, ni en base, ni sur disque.

### Ce qui rend ce chantier différent des autres

Les SFD 30 → 33 ajoutent des données que l'application connaît et contraint. Celle-ci ouvre une
porte vers un magasin dont **le contenu est décidé par la personne, pas par le schéma**. Un foyer
y met des factures, des bulletins de paie — et aussi des certificats médicaux, des ordonnances,
un PAI. C'est ce fait, et lui seul, qui déclenche les réouvertures du §7.

## 2. Périmètre

### Dans le périmètre (v1)

- **Dépôt** d'un document depuis l'app (web + PWA, les deux parents du foyer), transmis à
  Paperless par son API, avec métadonnées : foyer, type de document, date du document.
- **Recherche plein texte et consultation** depuis l'app : liste de résultats, aperçu,
  téléchargement — **toujours relayés par la passerelle**, jamais par un accès direct à Paperless.
- **Rattachement** d'un document à un objet métier du foyer (contrat, mois facturé, enfant) —
  candidat au **report en lot ultérieur** (voir §2.1).

### Hors périmètre (v1) — et pourquoi

| Écarté                                                             | Raison                                                                                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR, classement automatique, correspondants, règles de traitement  | Métier de Paperless. L'app ne fait que **nommer** ce qu'elle dépose.                                                                                           |
| Édition d'un document, suppression depuis l'app                    | Le coffre se gère depuis le coffre. L'app est en **écriture d'ajout seul** (`POST`) et en lecture.                                                             |
| Rappel entrant de Paperless vers l'app (webhook, workflow sortant) | **Décision structurante** : un client machine qui écrirait sur une route de mutation de l'app déclencherait le seuil de révision d'`ADR-0008` (§7.2).          |
| Import automatique des bulletins de paie                           | Déjà au backlog de la [SFD 32](32-sfd-travail-conges-revenus.md) §2 ; il consommera ce socle, il ne le précède pas.                                            |
| Partage d'un document hors du foyer (lien public Paperless)        | Un lien de partage agit **sans authentification** : même famille de risque que le `jti` de désabonnement, exclu de l'export pour la même raison (doc 37 §6.2). |

### 2.1 Un avertissement sur l'ordre de la valeur

La note de vision situait la valeur d'`AM-65` dans **le lien** (« la facture consultable depuis
le mois facturé »), et le dépôt/la recherche du côté de l'outil dédié. Le périmètre ci-dessus
inverse cet ordre : il livre d'abord le dépôt et la recherche, et met le lien en dernier.

Cet écart est **assumé mais doit être décidé**, pas subi. Les deux lectures se défendent :

- **dépôt/recherche d'abord** — c'est ce qui se sert tous les jours, depuis le téléphone, et ça
  ne dépend d'aucun autre chantier ;
- **lien d'abord** — c'est la seule moitié que Paperless ne sait pas faire, et elle s'emboîte
  dans `factures-reelles` et la SFD 32 ; livrer le reste sans elle, c'est offrir un deuxième
  écran pour un outil qui en a déjà un.

**Recommandation** : garder l'ordre ci-dessus (dépôt → recherche → lien), parce que les deux
premiers lots posent le **lien réseau, le secret et le scoping** que le troisième exige de toute
façon, et qu'ils sont livrables sans attendre `factures-reelles`. Mais le lot 3 ne doit pas être
présenté comme optionnel : sans lui, ce chantier n'a pas tenu la promesse d'`AM-65`.

## 3. Abstractions & modèle

```
Foyer ──< RattachementDocument            ← la SEULE table nouvelle côté creche-planner
              ├─ documentGedId (entier Paperless)
              ├─ cible : { type: 'CONTRAT'|'MOIS_FACTURE'|'ENFANT'|'AUCUNE', id?, mois? }
              ├─ typeDocument (catalogue paramétré : facture, bulletin, avis d'imposition…)
              ├─ dateDocument (date du document, pas de la dépose)
              └─ deposeLe / deposePar (e-mail de l'acteur)

Paperless-ngx (coffre)                     ← aucune donnée de creche-planner n'y est maître
              ├─ document (fichier, OCR, miniature)
              ├─ tag « foyer:<uuid> »      ← porté par CHAQUE document déposé par l'app
              └─ tag « type:<slug> »       ← miroir du typeDocument, pour l'usage hors app
```

Trois principes qui découlent de « Paperless reste l'unique coffre » :

1. **L'app ne stocke aucun octet.** Ni fichier, ni miniature, ni texte OCR, ni cache disque. Un
   aperçu est un **flux relayé**, pas une copie.
2. **L'app n'est pas la source de vérité du document.** Un document supprimé dans Paperless rend
   un rattachement orphelin : l'écran doit le dire (« document introuvable dans le coffre »), pas
   planter ni le masquer.
3. **Le tag `foyer:<uuid>` est le seul mécanisme d'isolation côté coffre**, et il n'est pas
   suffisant seul — voir `RM-38-04`.

### 3.1 Le catalogue de types de documents est une donnée

`facture`, `bulletin de paie`, `avis d'imposition`, `attestation`, `certificat`… sont des
**instances de paramétrage**, jamais des branches de code (principe doc 30 §4, `RM-32-01`).
Ajouter un type = ajouter une ligne, pas coder. Chaque type déclare : son libellé, son slug de
tag Paperless, et les **cibles de rattachement** qu'il accepte (`RM-38-06`).

## 4. Acteurs

| Acteur         | Rôle                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Parent**     | Dépose, cherche, consulte, rattache. Les **deux** parents du foyer voient les mêmes documents (modèle de confiance actuel, `RM-32-05`).   |
| **Passerelle** | Seul point de contact avec Paperless : porte le jeton, force le filtre de foyer, relaie les flux, ne stocke rien.                         |
| **Paperless**  | Coffre : ingestion, OCR, index plein texte, conservation. **Jamais joint directement par un navigateur** — ni depuis l'app, ni via l'app. |

## 5. User stories

### US-38-01 — Déposer un document depuis l'app

En tant que parent, depuis mon téléphone, je dépose un document (photo ou PDF) en lui donnant un
type et une date, sans ouvrir la GED ni être sur le réseau de la maison.

- **CA1** : le document apparaît dans Paperless avec le tag de foyer, le tag de type, le titre et
  la date fournis.
- **CA2** : l'ingestion étant **asynchrone** côté Paperless (l'API rend un identifiant de tâche,
  pas un document), l'écran dit « en cours de traitement » et **ne ment pas** : il n'affiche
  « déposé » que lorsque la tâche est aboutie, ou « échec » avec le motif rendu par le coffre.
- **CA3** : un dépôt qui échoue (coffre injoignable, fichier refusé, doublon détecté par
  Paperless) rend un message actionnable et **ne laisse aucun rattachement orphelin**.
- **CA4** : un fichier trop volumineux est refusé **avant** d'être transmis, avec la limite
  annoncée dans le message.

### US-38-02 — Retrouver un document

En tant que parent, je cherche « avis imposition 2025 » depuis l'app et je retrouve le document,
sans changer d'outil ni d'authentification.

- **CA1** : la recherche porte sur le **contenu** (texte OCR), pas seulement sur le titre.
- **CA2** : les résultats sont **bornés à l'affichage** avec un compte total non borné à côté —
  patron de la boîte de réception, explicitement désigné par `ADR-0008` comme celui à reprendre.
- **CA3** : aucun document d'un autre foyer ne peut apparaître, **quelle que soit la chaîne de
  caractères saisie** (`RM-38-04`).

### US-38-03 — Consulter un document

En tant que parent, j'ouvre l'aperçu d'un document depuis l'app, ou je le télécharge.

- **CA1** : l'aperçu et le téléchargement passent par la passerelle ; aucune URL de Paperless
  n'est exposée au navigateur, y compris dans le HTML servi.
- **CA2** : un document dont l'identifiant n'appartient pas au foyer rend **404**, jamais 403 —
  l'existence d'un document d'un autre foyer n'est pas une information à donner.

### US-38-04 — Rattacher un document à un objet du dossier — **lot 3**

En tant que parent, depuis un contrat, un mois facturé ou un enfant, je vois les justificatifs
qui le documentent, et j'en rattache un.

- **CA1** : depuis l'objet métier, la liste de ses documents s'affiche avec titre, type et date.
- **CA2** : un même document peut documenter plusieurs objets (une facture annuelle couvre douze
  mois) — le rattachement est une relation, pas un champ.
- **CA3** : un rattachement dont le document a disparu du coffre est **signalé**, jamais masqué.

## 6. Règles métier

- **RM-38-01 — Paperless reste l'unique coffre.** Aucun octet de document n'est écrit par
  creche-planner, nulle part. Ce qui est stocké ici est une **référence** et son contexte métier.
- **RM-38-02 — Aucune exposition directe du coffre.** Paperless n'est joignable ni depuis
  Internet, ni depuis le navigateur du parent : le seul chemin est
  `navigateur → tunnel → passerelle → Paperless`, sur un lien réseau serveur-à-serveur (§7.3).
- **RM-38-03 — Version d'API épinglée et vérifiée.** Chaque appel porte
  `Accept: application/json; version=9`, et la réponse est confrontée à son en-tête
  `X-Api-Version`. Un écart **arrête le service au démarrage** au lieu de dégrader (§7.4).
- **RM-38-04 — Le filtre de foyer n'est jamais concaténé à la requête de l'utilisateur.** Il est
  transmis comme **paramètre structuré distinct** (`tags__id__all`), jamais inséré dans la chaîne
  `query=`. Une composition textuelle serait injectable : la syntaxe de recherche de Paperless
  accepte des opérateurs booléens et des termes de champ, donc une saisie bien choisie sortirait
  du filtre. C'est la règle de sécurité centrale de cette spécification.
- **RM-38-05 — Dépôt en ajout seul.** L'app ne modifie ni ne supprime un document du coffre. La
  suppression d'un rattachement ne touche pas le document (§7.5).
- **RM-38-06 — Le catalogue de types dit ce qui peut être rattaché à quoi.** Un type déclare ses
  cibles admissibles ; l'app ne propose que celles-là. C'est le point de contrôle du §7.1 : un
  type « certificat médical » n'existe que si le PO décide qu'il existe.
- **RM-38-07 — L'identifiant de document est opaque au web.** Le front ne compose jamais d'URL
  Paperless ; il ne connaît que les routes de la passerelle.
- **RM-38-08 — Traçabilité.** Le dépôt et le rattachement sont des mutations du dossier : elles
  s'inscrivent à la piste d'audit acteur (doc 37 §7) dès leur premier commit, pas en `différée`.

## 7. Les points durs — décisions à prendre avant d'écrire du code

### 7.1 `ADR-0007` (exemption domestique) — le seuil « donnée de santé » est franchi

L'[ADR-0007](adr/0007-exemption-domestique-et-demarche-volontaire.md) énonce quatre seuils de
réouverture. Trois ne sont **pas** franchis, et il faut le dire pour qu'on ne le redécouvre pas :

| Seuil                                        | Franchi ? | Pourquoi                                                                                                                                                                                                                                   |
| -------------------------------------------- | :-------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plus d'un foyer réel                         |    Non    | Inchangé.                                                                                                                                                                                                                                  |
| Un **établissement** obtient un accès direct |    Non    | Le seuil cite « dépôt de documents » — mais il vise **l'établissement**, pas les parents. Ici, seuls les deux parents déposent. Proximité de vocabulaire, pas de franchissement : écrit ici pour qu'aucune relecture ne conclue l'inverse. |
| Cadre professionnel ou associatif            |    Non    | Inchangé.                                                                                                                                                                                                                                  |
| **Une donnée de santé (art. 9) est stockée** |  **Oui**  | Voir ci-dessous.                                                                                                                                                                                                                           |

La doc 37 §1 qualifie le drapeau `pai` de **donnée de facturation** au motif que « le code ne
stocke ni diagnostic, ni document, ni commentaire », et précise que cette qualification « est
rouverte si le champ venait à porter un motif ou **une pièce jointe** ». L'ADR-0007 dit la même
chose dans ses seuils, mot pour mot.

Or une GED de foyer contient des documents de santé — c'est certain, pas probable. Et la
[SFD 32](32-sfd-travail-conges-revenus.md) §3.2 exige déjà un **certificat** pour qualifier une
absence maladie : le premier justificatif que ce chantier rendra utile est un document médical.
Le seuil n'est pas franchi par le mécanisme d'intégration ; il est franchi par **ce que la
personne y mettra**, et l'application ne peut pas l'en empêcher.

**Trois positions possibles, à trancher par le PO — c'est la décision n°1 de cette SFD :**

- **(a) Rouvrir et faire le travail.** Un `ADR-0009` remplace la position d'`ADR-0007` : base
  légale, analyse d'impact, et les droits non outillés. Coût réel, mais c'est la seule position
  qui reste vraie si le produit sort du foyer un jour.
- **(b) Rouvrir et re-décider à la baisse, par écrit.** Un `ADR-0009` constate le franchissement,
  et décide que l'exemption tient quand même parce que le coffre est **auto-hébergé, mono-foyer,
  et alimenté par les personnes concernées elles-mêmes** — avec la contrepartie que le catalogue
  de types (`RM-38-06`) n'offre **aucun** type médical et qu'aucune cible `ENFANT` n'accepte de
  document en lot 3. Position tenable, mais elle repose sur une discipline d'usage, pas sur une
  garde.
- **(c) Ne pas intégrer.** Le coffre reste séparé ; `AM-65` est écartée avec sa raison.

**Recommandation de rédaction** : **(b)**, avec deux exigences non négociables — l'`ADR-0009`
est écrit **avant** le lot 1 (pas après), et il énonce ses propres seuils de réouverture, dont
au minimum « un type médical entre au catalogue » et « la cible `ENFANT` est ouverte ».

⚠️ Ce que (b) **ne** rend **pas** vrai : le drapeau `pai` reste sans pièce jointe **seulement
tant que la cible `ENFANT` reste fermée**. Le lot 3 rouvre mécaniquement la qualification de la
doc 37 §1 s'il ouvre cette cible.

### 7.2 `ADR-0008` (pagination, concurrence) — un seuil franchi, un évité

L'[ADR-0008](adr/0008-ecarts-semantique-http-pagination-et-concurrence.md) décide « aucune
pagination » et « aucune concurrence optimiste », et nomme ses seuils de réouverture.

**Pagination — franchi, et l'ADR a déjà écrit la réponse.** Son seuil est « une collection réelle
dépasse quelques centaines de lignes ». Une recherche documentaire les dépasse dès la première
année d'usage, et l'API de Paperless est **elle-même paginée** (`page`, `page_size`, enveloppe
`{ count, next, previous, results }`). La passerelle ne peut donc pas « rendre la collection
entière » : elle recevrait déjà une page.

L'ADR-0008 désigne nommément le patron à reprendre : celui de la boîte de réception —
« borner l'affichage, et publier à côté un compte qui ne l'est pas ». L'enveloppe de Paperless le
fournit littéralement (`results` borné, `count` non borné). **Il ne s'agit donc pas de rouvrir la
décision, mais de l'amender** : un paragraphe ajouté à `ADR-0008` §1 constatant que le premier
cas prévu par son propre seuil est arrivé, et que la réponse est celle qu'il avait écrite. C'est
la décision n°2.

**Concurrence optimiste — évité, et c'est un choix de conception.** Le seuil est « un client
machine ou une automatisation écrit sur une route de mutation ». Il **ne serait franchi que si**
Paperless rappelait l'app (webhook, workflow sortant). Le §2 l'exclut pour cette raison : le
sens de la dépendance est **sortant uniquement**, y compris pour connaître l'issue d'une
ingestion (l'app **interroge** `/api/tasks/`, elle n'attend pas d'être appelée). Le jour où un
rappel entrant serait souhaité, `AM-41` se rouvre **avec** lui, pas après.

### 7.3 Le lien réseau — deux piles volontairement isolées

Aujourd'hui les deux piles Docker sont séparées sur le même hôte, et Paperless n'écoute que sur
`127.0.0.1` (plus son propre Caddy en LAN strict). Les rapprocher est un geste d'exploitation à
faire **exprès** :

| Option                                                  | Verdict                                                                                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Republier le port de Paperless sur l'hôte               | ⛔ Élargit l'exposition pour tout ce qui tourne sur la machine — l'inverse de l'intention.                                                                                                            |
| Joindre l'hôte depuis le conteneur (`host-gateway`)     | ⛔ Ne marche pas contre une écoute `127.0.0.1`, et la faire écouter plus large revient à l'option précédente.                                                                                         |
| Fusionner les deux composes                             | ⛔ Couple les cycles de vie de deux produits indépendants ; un `down` de l'un arrête l'autre.                                                                                                         |
| **Réseau Docker dédié, `external: true`, deux membres** | ✅ **Retenu.** Un réseau nommé, créé une fois par l'exploitation, rejoint uniquement par `api-gateway` et le `webserver` de Paperless. Aucun port publié. Un `docker compose down` ne le détruit pas. |

Trois conséquences à écrire dans le plan, pas à découvrir :

1. `deploy.mjs` est la **seule** voie de déploiement : la création du réseau est une étape
   d'exploitation documentée, et son absence doit faire **échouer le démarrage** de la passerelle
   avec le nom du réseau dans le message — jamais dégrader en « recherche indisponible ».
2. Le lien est **sortant seulement** : rien dans la pile Paperless n'a de raison de joindre
   creche-planner (§7.2).
3. Le durcissement en vigueur (CIS, `pnpm conteneurs`) s'applique aux deux côtés ; la porte lit
   les composes de creche-planner et **ne verra jamais** celui de Paperless. C'est un angle mort
   déclaré, pas couvert.

### 7.4 Le secret d'API — et le piège `LE-58`

L'accès se fait par **jeton** (`Authorization: Token <jeton>`), obtenu depuis Paperless pour un
utilisateur **dédié, non administrateur**, créé pour cet usage.

⚠️ **`LE-58` s'applique directement.** Un secret Compose de source `environment:` est
**matérialisé dans le conteneur** par Compose : il est donc incompatible avec une racine
`read_only`, et c'est exactement ce qui a cassé la production le 2026-08-15 sans qu'aucune pile de
CI puisse le voir. Deux conséquences :

- le jeton arrive par une source **`file:`** (montage), ou par variable d'environnement simple —
  **jamais** par un secret Compose `environment:` sur un service à racine immuable ;
- la vérification se fait par **redémarrage réel sur la pile qui porte le réglage**, pas par une
  relecture du fichier (`LE-53`). La pile de CI ne prouve rien ici.

À décider aussi : la **rotation**. Un jeton Paperless ne porte pas d'échéance ; sa rotation est
un geste manuel des deux côtés. La spécification retient : jeton dédié, révocable depuis
Paperless, et sa révocation doit produire un **échec bruyant** de l'app (message explicite), pas
une recherche silencieusement vide.

### 7.5 RGPD — un dixième traitement, et l'effacement qui ne cascade pas

**Un traitement `T10` entre à la [doc 37](37-registre-des-traitements.md)** — « Documents
administratifs du foyer ». Sa particularité, qui n'a d'équivalent nulle part ailleurs dans le
registre : **ses catégories de données sont ouvertes**. Les neuf autres traitements décrivent des
colonnes ; celui-ci décrit un contenant. C'est cela qu'il faut écrire, plutôt que de faire
semblant d'énumérer.

Quatre points à trancher :

1. **Où vivent les données.** Base et médias de Paperless, **hors des cinq bases** de
   creche-planner. Le registre doit donc nommer un magasin qu'aucune porte du dépôt ne sait lire
   (`pnpm retentions`, `pnpm portabilite` dérivent leur attendu des `schema.ts` : ils ne verront
   jamais Paperless). Angle mort déclaré.
2. **Conservation.** Paperless ne purge rien, et une suppression y est une **corbeille** : un
   effacement effectif exige un `hard_delete`, après quoi les fichiers médias restent
   **orphelins** — seul son propre vérificateur d'intégrité les signale. Une durée de
   conservation écrite ici serait une intention sans ancre : la ligne `T10` du §3 doit être
   **`⛔` avec sa raison**, comme `T1bis` ou `T2`, et non un chiffre décoratif.
3. **Effacement du foyer — la question qui doit être décidée.** `DELETE /foyers/:id` efface
   aujourd'hui dans cinq bases et propage par événement. Paperless est un **sixième magasin
   qu'aucun événement n'atteint**. Trois options :
   - **(i)** cascader jusqu'au coffre (`hard_delete`) — irréversible, et laisse des médias
     orphelins ;
   - **(ii)** n'effacer que les **rattachements**, laisser les documents dans le coffre ;
   - **(iii)** refuser l'effacement tant qu'un document est rattaché.

   **Recommandation : (ii), écrite explicitement en doc 37 §4.** Le coffre est le classeur du
   foyer, antérieur et extérieur à l'app ; l'app efface ce qu'elle possède — les liens. Effacer
   des documents que la personne a rangés elle-même, parce qu'elle supprime un dossier
   applicatif, serait une destruction qu'elle n'a pas demandée. Mais cette limite doit être
   **visible**, pas implicite : c'est exactement la forme des deux exceptions déjà écrites
   (`outbox`, `processed_event`).

4. **Portabilité.** La table `rattachement_document` devra porter une ligne au §6 du registre —
   `pnpm portabilite` **dérive son attendu des `schema.ts`** : une table nouvelle sans ligne fait
   échouer la CI. Classe proposée : **exportée** (titre, type, date, cible — jamais le fichier :
   l'export rend ce que l'effacement emporte, et l'effacement n'emporte pas le coffre).

**Et le tiers le plus exposé n'est pas Paperless.** La doc 37 §2 classe **Cloudflare** comme le
tiers qui voit le plus : la terminaison TLS a lieu chez lui, donc **tout le trafic applicatif en
clair**. Faire transiter les documents du foyer par la passerelle les fait donc transiter **en
clair au niveau de son proxy**. Aujourd'hui Cloudflare voit des prénoms, des plannings et des
revenus ; demain il verrait des bulletins de paie et des avis d'imposition. **C'est la
conséquence la plus lourde de ce chantier, et elle est structurelle** : elle ne dépend d'aucun
choix d'implémentation, seulement de la décision d'intégrer. La ligne « Ce qu'il voit » de
Cloudflare devra être réécrite en même temps que `T10`.

### 7.6 Le relais ne doit rien perdre en silence — `MO-1` / `LE-48`

Le motif le plus fréquent du dépôt (37 occurrences) est « la porte existe, on la croit large,
elle n'évalue pas ce qu'on pense ». Sa forme locale ici est connue et documentée : **un `z.object`
strippe les clés qu'il ne connaît pas**, donc un champ oublié à une étape du relais disparaît
**sans erreur**. La chaîne compte quatre couches (Paperless → client passerelle → vue BFF →
`z.object` du client web).

Trois exigences, à tenir dès le premier lot :

1. les champs réellement consommés sont déclarés **requis** dans le schéma du client, jamais
   optionnels « par prudence » : un champ renommé par une version d'API doit faire **rouge**, pas
   `undefined` ;
2. la garde de forme s'appuie sur une **capture réelle** de réponse Paperless, commitée en
   fixture et **régénérée par commande**, jamais recopiée à la main (`MO-3` : l'attendu se
   dérive, il ne s'écrit pas de la même main que l'observé) ;
3. la sonde négative du lot est explicite : **retirer un champ de la fixture doit faire échouer**
   la garde. Une garde qui reste verte ne garde rien.

## 8. Prérequis et point de décision : la version de Paperless

L'instance réelle est en **2.20.6**, épinglée, et une **migration 3.x est en attente** — elle a
notamment **réécrit le consommateur**, revu la recherche et supprimé la compatibilité de l'API v1.

Le fait qui décide, et qui n'est pas intuitif :

- **2.20.6 sert la version 1 de l'API quand aucune version n'est demandée** (compatibilité des
  vieux clients) ;
- **3.0 supprime la compatibilité v1 et ne sert plus les versions inférieures à 9.**

Un client écrit aujourd'hui **sans en-tête `Accept` explicite** fonctionnerait donc parfaitement
contre l'instance actuelle et **cesserait entièrement de fonctionner** au jour de la migration —
sans qu'aucun test du dépôt puisse le prévoir, puisqu'ils tourneraient tous contre 2.20.6.

**Décision retenue (`RM-38-03`) : épingler `version=9`.** C'est la **seule** valeur que les deux
versions acceptent (2.20.6 documente les versions 1 à 9 ; 3.x accepte 9 et 10). Ce que cela
implique de connaître :

| Version | Ce qu'elle change, et pourquoi ça compte ici                                                                               |
| :-----: | -------------------------------------------------------------------------------------------------------------------------- |
|    7    | Les champs personnalisés de type « sélection » rendent des objets `{ id, label }` et non des chaînes.                      |
|    9    | Le champ `created` d'un document devient une **date** et non un horodatage — c'est le champ « date du document » de l'app. |
|   10    | Réorganisations d'endpoints ; **hors de portée** tant que l'instance est en 2.x.                                           |

**Le point de décision PO** : migrer Paperless en 3.x **avant** ou **après** ce chantier ?

- **Recommandation : indépendamment, et sans bloquer.** L'épinglage `version=9` rend le client
  compatible des deux côtés, donc la migration cesse d'être un prérequis.
- **Réserve** : la 3.0 remplace le moteur de recherche plein texte. La **syntaxe de requête, le
  classement et la forme des extraits surlignés** peuvent bouger. L'app ne doit donc **rien
  construire sur le score ni sur la forme des surlignages** — au plus les afficher tels quels. Si
  la recherche de l'app venait à dépendre d'une syntaxe avancée, la migration redeviendrait un
  prérequis.

## 9. Questions ouvertes

- **Q-38-01** — Le catalogue de types comporte-t-il un type médical, et la cible `ENFANT`
  est-elle ouverte ? C'est la question qui décide de la position `ADR-0009` (§7.1) : y répondre
  « oui » impose la position (a) ; « non » permet la position (b).
- **Q-38-02** — L'effacement d'un foyer doit-il emporter ses documents du coffre ? (§7.5, option
  proposée : **non**, seuls les rattachements partent.)
- **Q-38-03** — Faire transiter les documents du foyer en clair au niveau du proxy Cloudflare
  est-il accepté ? (§7.5 dernier paragraphe.) Si non, la seule autre voie connue est un accès
  réservé au réseau local ou au tailnet — ce qui retire au chantier son intérêt principal
  (déposer depuis n'importe où).
- **Q-38-04** — Ordre de la valeur : dépôt/recherche d'abord, ou lien d'abord ? (§2.1 ;
  recommandation : dépôt/recherche, à condition que le lot 3 reste engagé.)
- **Q-38-05** — Quelle taille maximale de dépôt ? Elle contraint le corps accepté par la
  passerelle, ses délais et le disjoncteur de son client résilient, dimensionnés aujourd'hui pour
  du JSON. Valeur à proposer par défaut, à confirmer par un essai réel depuis un téléphone.
- **Q-38-06** — Le tag `foyer:<uuid>` est-il lisible tel quel dans l'interface de Paperless, ou
  faut-il un libellé lisible par un humain ? (Le coffre continue d'être utilisé directement, hors
  de l'app.)

## 10. Ce que cette spécification engage

- Trois écrits d'architecture **avant** le premier commit de code : `ADR-0009` (§7.1), un
  amendement à `ADR-0008` §1 (§7.2), et l'entrée `T10` à la doc 37 (§7.5).
- Un geste d'exploitation irréversible en pratique : le lien réseau entre deux piles jusqu'ici
  isolées (§7.3).
- Un changement de nature du risque : les documents les plus sensibles du foyer transitent par la
  passerelle, donc par le tiers le plus exposé du registre (§7.5).
- Aucun octet de document stocké par creche-planner, dans aucune version (`RM-38-01`).
