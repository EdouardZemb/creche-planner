# ADR-0010 — Données de santé du dossier : seuil franchi volontairement, et les cinq conditions qui le rendent tenable

- **Statut** : Accepté
- **Date** : 2026-09-01
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Révise** : [ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md) — **sur son seul
  quatrième seuil de révision** (« une donnée de santé au sens de l'article 9 est stockée »). Le
  reste de l'ADR-0007 demeure en vigueur et n'est ni remplacé ni abrogé.
- **Renverse** : la décision PO du 2026-08-17 qui fermait le type médical au catalogue et la cible
  `ENFANT` ([SFD 38](../38-sfd-rattachement-documentaire.md) §0, `Q-38-01`).
- **Déclencheur** : rédaction de la [SFD 44](../44-sfd-inscription-reinscription-pieces.md)
  (dossier d'inscription ABCM) — le dossier annuel exige une fiche sanitaire, une copie des
  vaccins obligatoires et un PAI. Décision PO du 2026-09-01.

## Contexte

L'[ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md) énonçait quatre seuils dont le
franchissement obligeait à le rouvrir. Trois ne sont toujours pas franchis. Le quatrième l'est —
**et il l'est délibérément**, ce qui n'était pas le cas envisagé : l'ADR-0007 le décrivait comme
un accident possible (« un `pai` qui porterait un motif, un document ou un commentaire médical »),
pas comme un choix.

La [SFD 38](../38-sfd-rattachement-documentaire.md) avait traité le sujet le 2026-08-17 en prenant
la position inverse : **ne pas franchir**, avec deux fermetures pour contrepartie — aucun type
médical au catalogue documentaire, cible `ENFANT` fermée. Elle avait aussi nommé la raison
technique de cette prudence : à l'époque, les documents transitaient par le proxy Cloudflare, qui
termine TLS et lit donc tout ce qui passe. Un bulletin de paie y était déjà de trop ; un carnet de
vaccination l'était bien davantage.

Deux choses ont changé depuis, et ce sont elles qui rendent la décision d'aujourd'hui possible :

1. la SFD 38 a retenu la variante **`a1`** — un **second bord Tailscale** sert les routes
   documentaires, le bord public n'en voit qu'un compte neutre. La cause matérielle de la
   fermeture disparaît **si et seulement si** ce bord existe ;
2. le besoin s'est précisé : il ne s'agit pas de stocker « du médical » en général, mais **les
   pièces d'un dossier d'inscription** que la famille remet déjà chaque année, en main propre, à
   une association.

## Décision

**Le stockage des pièces médicales du dossier est autorisé** — fiche sanitaire, copie des vaccins
obligatoires, PAI — **dans la GED du foyer, et nulle part ailleurs**. L'application continue de ne
stocker **aucun octet** de document (`RM-38-01`) : ce qui change est ce que le **coffre** a le droit
de contenir, et ce que l'application a le droit d'en afficher.

La position retenue est la **(a)** du §7.1 de la SFD 38 — « rouvrir et faire le travail » — et non
la (b) qu'elle avait recommandée. L'exemption domestique de l'article 2(2)(c) reste assumée : le
contexte n'a pas changé (un seul foyer, ses propres enfants, un serveur auto-hébergé, aucune
diffusion). **Mais la conséquence d'une fuite, elle, change de nature** : une donnée de santé
d'enfant mineur ne se répare pas, ne se révoque pas et ne se remplace pas.

C'est pourquoi cette autorisation n'est pas une permission simple. Elle est **conditionnée**, et
les conditions ci-dessous sont des **préalables techniques**, pas des intentions : tant qu'elles
ne sont pas toutes réunies, **aucune pièce médicale n'entre dans le coffre**.

## Les cinq conditions — cumulatives, opposables, vérifiables

Chacune est reprise en règle métier opposable dans la
[SFD 44](../44-sfd-inscription-reinscription-pieces.md) §6, avec son critère de vérification.

### (a) Service par le tailnet exclusivement

Les routes qui servent une pièce médicale — liste, aperçu, téléchargement, **et leurs
métadonnées** — ne sont servies **que** par le bord Tailscale. Le bord public répond **404**, pas
403 : l'existence même d'une pièce médicale n'est pas une information à donner à un proxy tiers.

C'est la raison d'être de la fermeture initiale, et donc la condition qui la lève. Elle se garde
par une porte de CI, comme `RM-38-02` l'exige déjà pour le documentaire ordinaire — avec une
exigence de plus : la partition doit être **vérifiée par une sonde négative** (une route médicale
déclarée sur le bord public doit faire échouer la CI).

⚠️ **Elle a un préalable humain que rien ne remplace** : la seconde personne du foyer doit
rejoindre le tailnet. La SFD 38 l'écrivait déjà comme bloquant ; ici, ne pas l'avoir signifierait
qu'un des deux parents n'accède pas au carnet de santé de son propre enfant.

### (b) Chiffrement au repos

**C'est la condition la plus coûteuse, et il faut dire pourquoi.** Paperless-ngx **ne chiffre pas**
ses documents : le projet a **retiré** cette fonction, au motif que la phrase de passe vivait sur
la même machine que les documents et que le texte intégral restait en clair dans la base (SFD 38
§7.7 (c) et (d)). Aucune GED auto-hébergée examinée n'offre mieux **contre ce scénario-là**.

Ce que la condition exige donc concrètement :

- le **volume** qui porte la base et les médias de la GED est chiffré (chiffrement de bloc), et ce
  chiffrement est vérifié par un **redémarrage réel** de la pile qui le porte — jamais par une
  relecture de fichier (`LE-53`, `LE-58`) ;
- les **sauvegardes** hors-site le sont déjà (`age`) : cette moitié est acquise, elle ne compte pas
  comme travail neuf ;
- et la **limite est écrite, pas tue** : un chiffrement de volume protège un disque emporté, il ne
  protège **rien** contre un accès au serveur allumé. Le prétendre serait un faux garde-fou, et un
  faux garde-fou est pire qu'aucun — il fait baisser la garde.

### (c) Accès restreint : le type médical n'est pas au catalogue commun

Un type de pièce médical porte un attribut **restreint**. Conséquences opposables :

- il n'apparaît **pas** dans le catalogue commun des types documentaires (`RM-38-06`) : il faut le
  demander explicitement pour le voir ;
- une recherche plein texte ordinaire **ne le rend jamais** ; il faut une vue dédiée ;
- aucun écran de synthèse, aucun récapitulatif, aucun courriel ne cite un intitulé de pièce
  médicale — au plus « pièce médicale fournie ».

### (d) Consentement des deux parents, tracé

Le stockage d'une pièce médicale n'est ouvert qu'après un **consentement explicite des deux
parents**, horodaté, nommant les catégories concernées, et **révocable**. Une révocation ferme le
dépôt de nouvelles pièces et déclenche la procédure d'effacement de (e).

Ce mécanisme **n'existe pas** dans le produit et n'a d'équivalent nulle part : c'est un
développement à part entière, pas une case à cocher.

### (e) Conservation bornée à la scolarité, avec une purge qui purge vraiment

Une pièce médicale est conservée **le temps de la scolarité de l'enfant dans l'établissement**,
plus l'année scolaire en cours, puis effacée.

⚠️ **La borne ne vaut que si la purge existe.** Dans la GED, une suppression est une **corbeille** ;
un effacement effectif exige un `hard_delete`, après quoi les fichiers médias restent
**orphelins** — seul le vérificateur d'intégrité de la GED les signale (SFD 38 §7.5). Écrire une
durée sans mécanisme produirait exactement la ligne décorative que le registre des traitements
refuse : une durée de conservation doit **nommer la colonne qui la porte**, et cette colonne doit
exister.

## Ce que la décision rend vrai

- Le **quatrième seuil de l'ADR-0007 est franchi**, sciemment et par écrit. Il ne peut plus servir
  de garde-fou : cet ADR le remplace par les cinq conditions ci-dessus.
- La décision PO du 2026-08-17 (`Q-38-01`) est **renversée** : un type médical entre au catalogue,
  et la cible `ENFANT` s'ouvre — **pour ce type-là, et sous ces conditions-là**.
- Le drapeau `pai` change de qualification. La [doc 37](../37-registre-des-traitements.md) le
  tenait pour une **donnée de facturation** au motif que « le code ne stocke ni diagnostic, ni
  document, ni commentaire », en précisant que la qualification serait rouverte s'il venait à
  porter une pièce jointe. C'est le cas. Le registre doit donc être mis à jour **avant le premier
  commit** du lot, pas après.
- Le travail que l'ADR-0007 annonçait en cas de réouverture devient exigible : **base légale,
  analyse d'impact, et droits non outillés**. Il n'est pas fait par cet ADR — il est **rendu dû**
  par lui.

## Ce qu'elle ne change pas

- **L'exemption domestique reste assumée** pour le reste : un seul foyer, ses propres enfants,
  aucune diffusion. Cet ADR ne revendique pas davantage de conformité que l'ADR-0007.
- **L'application ne stocke toujours aucun octet de document** (`RM-38-01`). Le coffre reste le
  coffre.
- **Aucun envoi sortant** ne porte de pièce ni d'intitulé médical, dans aucune version.
- Les trois autres seuils de révision de l'ADR-0007 restent en vigueur, inchangés.

## Risque résiduel — assumé, et nommé

1. **Le chiffrement au repos ne protège qu'un disque emporté.** Sur un serveur allumé, la clé est
   par construction disponible. C'est la limite structurelle de l'auto-hébergement, et c'est
   exactement le raisonnement par lequel la GED a retiré son propre chiffrement.
2. **Cinq conditions font cinq occasions de dériver.** Une partition de routes se contourne par
   inadvertance, un catalogue « restreint » se déclare visible par une valeur par défaut. Chacune
   doit donc avoir sa **sonde négative** ; une garde qui reste verte ne garde rien.
3. **Le consentement de deux personnes qui vivent ensemble est une formalité qui peut se vider de
   son sens.** Il est tracé pour que la décision soit datée et révocable, pas pour prétendre à un
   formalisme qu'un foyer ne pratique pas.
4. **L'enfant est un mineur qui ne consent pas.** Ses parents décident pour lui, ce qui est le cas
   général — mais la donnée le suivra plus longtemps que ce produit.

## Révision

Cet ADR **doit être rouvert** si l'un de ces seuils est franchi :

- **une des cinq conditions cesse d'être vraie en production** — notamment : une route médicale
  répond sur le bord public, ou le volume cesse d'être chiffré. Ce n'est pas une régression à
  corriger tranquillement : c'est la disparition d'un préalable de la décision ;
- une **catégorie médicale nouvelle** entre (un compte rendu, une ordonnance, un suivi) — les
  pièces autorisées sont limitativement énumérées : fiche sanitaire, vaccins, PAI ;
- une **personne hors du foyer** accède au coffre, sous quelque forme que ce soit ;
- l'un des trois autres seuils de l'[ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md)
  est franchi — ils restent en vigueur et se cumulent avec ceux-ci.
