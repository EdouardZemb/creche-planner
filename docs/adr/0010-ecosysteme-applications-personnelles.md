# ADR-0010 — Écosystème d'applications personnelles : un référentiel de compétences avant une identité commune

- **Statut** : Accepté
- **Date** : 2026-09-29
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0001](0001-architecture-microservices.md) (autonomie des services,
  base par service), [ADR-0006](0006-preferences-notification-et-desabonnement.md) (partage par
  projection d'événements plutôt que par écriture croisée),
  [ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md) (seuils qui font sortir un
  produit du cercle domestique).
- **Déclencheur** : décision PO du 2026-09-29, prise en envisageant d'ajouter des applications à
  côté des deux qui existent, puis précisée par un cas d'usage arrivé après coup : une **veille de
  compétences**.
- **Amendement** : 2026-09-29, arbitrages PO sur la première version — e-mail jamais identifiant
  validé, avec sa **dette** côté Martha (`AM-125`) ; démonstration **liée à l'environnement de
  qualification** (§3, avec un [point ouvert](#point-ouvert--quel-environnement-de-qualification))
  ; gates limités au module ajouté à une application existante (§4).

## Contexte

Deux applications personnelles tournent aujourd'hui sur le même serveur, sans rien partager
d'autre que la machine :

- **Martha** (ce dépôt) — l'application du foyer, identifiée par Cloudflare Access et cloisonnée
  **par foyer** ;
- **la veille emploi** — un outil de collecte et de tri d'offres d'emploi, hors de ce dépôt,
  servi sur le tailnet.

Le propriétaire envisage d'en ajouter d'autres et veut raisonner en **système** : reconnaître une
même personne à travers les services, rassembler ce qu'on sait d'elle, et ajouter des
applications autonomes qui se concentrent sur leur métier tout en partageant les données utiles.
Deux faits s'y ajoutent : **un second utilisateur** va se servir de la veille emploi, et le
propriétaire veut pouvoir la **montrer** — l'écosystème sert aussi de vitrine.

### Le cas d'usage qui change la question

La demande de départ portait sur l'identité. Le cas d'usage concret, arrivé ensuite, porte sur
autre chose : repérer dans les annonces les compétences **réellement demandées** sur un domaine,
et en nourrir plus tard une application de **suivi et de montée en compétences**. Une veille
**chronique**, pas un outil jetable lié à une recherche d'emploi en cours.

Or ce cas d'usage ne bute pas sur l'identité. Il bute sur le **vocabulaire**. Tant que « test
d'intégration système », « CSV », « Playwright » ou « GAMP 5 » ne désignent pas la même chose des
deux côtés, une veille qui mesure la demande et une application qui mesure un niveau ne peuvent
pas se parler — même en partageant parfaitement leurs utilisateurs. « CSV » à lui seul désigne,
selon l'annonce, un format de fichier ou la validation des systèmes informatisés d'un secteur
réglementé : deux compétences sans rapport, un seul libellé.

### Ce que les données permettent réellement aujourd'hui

Deux faits mesurés sur la veille emploi, qui conditionnent tout le reste :

- **Les annonces arrivent tronquées.** Sur le gisement réel du propriétaire — alertes par e-mail
  de France Travail et de LinkedIn — **1 annonce sur 162** arrive complète. La moyenne affichée
  de 16 % d'annonces complètes est portée entièrement par une source (Arbeitnow) qui ne couvre
  pas son marché. Mesurer une demande de compétences sur des extraits de trois lignes mesure la
  rédaction des alertes, pas le marché. L'API France Travail donnerait les annonces entières ;
  ses identifiants sont **refusés** à ce jour.
- **L'extraction a déjà une classe de bug connue.** Les sections « compétences » des annonces
  sont recopiées, gonflées, souvent décoratives. La veille a rencontré **quatre variantes d'une
  même erreur** : le bruit était retiré **avant** la reconnaissance des motifs au lieu d'après,
  si bien que le nettoyage détruisait le contexte qui permettait de reconnaître le motif. La
  règle qui en est sortie — **le plus spécifique d'abord, le nettoyage ensuite** — est consignée
  dans le `docs/METHODE.md` de la veille. Une extraction de compétences est exactement le terrain
  où cette erreur se reproduit.

### Ce que le second utilisateur demande vraiment

Le seul besoin d'identité **réel** aujourd'hui : le second utilisateur doit utiliser la veille
**sans voir** les offres du propriétaire, et inversement. C'est un cloisonnement par utilisateur
**à l'intérieur d'une application**. Aucune application n'a besoin, à ce jour, de reconnaître une
personne connue d'une autre.

### Ce que la vitrine impose

La veille contient des planchers de rémunération, des motifs de rejet portant sur des employeurs
nommés et une stratégie de négociation. La montrer telle quelle en entretien est exclu. Et les
données du second utilisateur ne doivent apparaître dans **aucune** démonstration — ni les
siennes montrées par le propriétaire, ni l'inverse.

## Options envisagées

| Option                                                                                             | Verdict                                            | Raison                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Annuaire central d'identité, construit maintenant**                                           | Écartée                                            | Résout un besoin qui n'existe pas : aucune application ne doit reconnaître une personne d'une autre. Il ajouterait un service dont **toutes** les applications dépendent pour démarrer, sur un serveur unique, et deux fournisseurs d'authentification déjà différents (Cloudflare Access pour Martha, identité du tailnet pour la veille) à réconcilier sans cas d'usage pour dire comment. Et il ne débloque pas la veille de compétences |
| **B. Base de données partagée** (une table `users`, ou un schéma commun)                           | Écartée                                            | Défait l'autonomie posée par l'[ADR-0001](0001-architecture-microservices.md) : un changement de schéma par une application casse les autres sans qu'aucun contrat ne l'ait annoncé, et la sauvegarde, la purge et la démonstration ne se découpent plus par application. C'est aussi la voie la plus directe pour que les données du second utilisateur fuient dans une démonstration                                                      |
| **C. Monorepo unique** pour toutes les applications                                                | Écartée                                            | Ce dépôt est **public** ; la veille contient une stratégie personnelle et ne peut pas l'être. Un monorepo force l'un des deux à changer de visibilité. Il lie aussi les cycles : un gate rouge de Martha bloquerait une correction de la veille. Les frontières Nx qu'il apporterait sont déjà obtenues ici par contrat                                                                                                                     |
| **D. Service « référentiel de compétences » séparé, dès maintenant**                               | Écartée — **différée**                             | Il n'y a qu'**un** producteur (la veille) et **aucun** consommateur. Un service partagé sans second consommateur fige un contrat avant d'avoir appris ce qu'il doit porter                                                                                                                                                                                                                                                                  |
| **E. Adopter tel quel un référentiel public** (ROME de France Travail, ESCO européen)              | Écartée comme **source**, retenue comme **renvoi** | Trop grossiers pour ce qu'on veut mesurer : ils nomment des familles de savoir-faire, rarement un outil ou une norme sectorielle précise. Mais ils sont stables, publics, et l'API France Travail étiquette déjà ses annonces en ROME : chaque compétence peut porter un **renvoi** optionnel vers eux, sans en dépendre                                                                                                                    |
| **F. Une nouvelle application dédiée à la veille de compétences**                                  | Écartée                                            | Les annonces, leur collecte et leur tri vivent déjà dans la veille emploi. Une application de plus dupliquerait la collecte, ou créerait la première dépendance inter-applications de l'écosystème pour une fonction qui tient dans un module                                                                                                                                                                                               |
| **G. Référentiel de compétences possédé par la veille, identité différée, partage par événements** | **Retenue**                                        | Voir ci-dessous                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Décision

Cinq règles, par ordre d'importance. Elles valent pour **toute** application de l'écosystème, y
compris celles qui n'existent pas encore.

### 1. La pièce centrale est le référentiel de compétences, pas l'identité

Le référentiel est **possédé par la veille emploi**, qui est aujourd'hui son seul producteur. Il
en sortira vers un service propre le jour — et seulement le jour — où un second consommateur
existe (option D). Quatre questions sont tranchées d'avance, parce que c'est sur elles que
meurent les référentiels :

**Qui crée une compétence.** L'extraction **propose**, un humain **décide**. Un libellé repéré
dans une annonce est d'abord un **libellé observé** en quarantaine ; il ne devient une
compétence qu'une fois rattaché à une entrée existante ou validé comme nouvelle entrée. Chaque
compétence reçoit un identifiant **opaque et stable** : le libellé est un attribut, jamais la
clé. Le libellé observé brut est conservé à côté de son rattachement — on doit toujours pouvoir
refaire le rattachement avec de meilleures règles.

**Comment on fusionne deux libellés.** Par **alias**, jamais par renommage ni suppression. Deux
entrées reconnues identiques : l'une absorbe l'autre, l'absorbée devient un alias qui **redirige**
vers la survivante, et son identifiant n'est **jamais** réutilisé. Un consommateur qui détient
l'ancien identifiant le résout toujours. Le cas inverse — un libellé, plusieurs compétences, comme
« CSV » — se tranche par le **contexte** de l'annonce ; quand le contexte ne suffit pas,
l'observation reste **non rattachée** plutôt que devinée. Pas de hiérarchie de compétences au
départ : c'est la structure qui coûte le plus cher à maintenir, et rien ne la demande encore.

**Comment on traite une compétence qui disparaît du marché.** On ne la supprime pas. Son état —
active, en déclin, plus observée — est **dérivé** des observations datées, pas posé à la main.
L'application d'apprentissage doit pouvoir garder un niveau sur une compétence que le marché ne
demande plus : c'est une information, pas une incohérence.

**Comment on distingue une compétence exigée d'une compétence décorative.** Chaque observation
porte une **force** : `exigée`, `souhaitée`, `décorative`, ou `indéterminée`. La valeur par
défaut est `indéterminée`, **jamais** `exigée`. Les signaux qui la font monter sont explicites
(marqueur d'obligation, durée d'expérience demandée, reprise dans la description de la mission) ;
ceux qui la font descendre aussi (présence dans une seule liste de mots-clés longue, section
recopiée d'une annonce à l'autre). **L'indicateur de demande ne compte que les observations
`exigée`**, et son dénominateur exclut les annonces tronquées : une mesure qui mélange les deux
mesure la rédaction des annonces.

Le référentiel se **publie** par événements versionnés qui portent des identifiants de
compétence, jamais des libellés seuls, et **aucune** donnée personnelle. Le transport n'est pas
fixé par cet ADR : un export de fichier versionné suffit tant qu'il n'y a qu'un consommateur.

### 2. L'identité est différée derrière une interface étroite

- Toute donnée de toute application appartient **dès maintenant** à un **identifiant de
  propriétaire opaque** — un UUID sans signification, généré localement.
- La traduction « personne authentifiée → identifiant opaque » se fait **à un seul endroit** par
  application, derrière une interface qui ne fait que cela. Aujourd'hui, chaque application
  l'implémente seule, avec son propre fournisseur d'authentification.
- **L'adresse e-mail n'est jamais une clé.** Elle est un moyen d'authentification. Si elle
  servait de clé, elle deviendrait l'annuaire central de fait — sans contrat, et en portant une
  donnée personnelle dans chaque table.
- **Martha enfreint cette règle aujourd'hui, et c'est une dette inscrite, pas une règle pour
  plus tard** ([`AM-125`](../34-registre-ameliorations.md)). L'e-mail validé par Cloudflare Access
  y sert de clé d'identité de bout en bout, alors qu'un `parent` porte déjà un identifiant opaque :
  - la passerelle résout les foyers autorisés **par e-mail**
    ([`appartenance.guard.ts`](../../apps/api-gateway/src/security/appartenance.guard.ts)), par
    un appel `GET /api/foyers?parentEmail=…` — l'adresse voyage **dans l'URL** ;
  - l'assertion d'identité propagée aux services porte l'**e-mail**
    ([`contexte-assertion.ts`](../../apps/api-gateway/src/security/contexte-assertion.ts)) ;
  - le rôle d'administrateur est une **liste d'e-mails** (`ADMIN_EMAILS`).

  Conséquence concrète : un parent qui change d'adresse **perd l'accès** à son foyer, et une
  adresse réaffectée hérite de celui de son ancien titulaire. La sortie est de résoudre l'e-mail
  en identifiant **une seule fois**, à la passerelle, puis de ne plus faire circuler que
  l'identifiant.

- Le cloisonnement du second utilisateur est un **filtre par propriétaire à l'intérieur de la
  veille**, pas un service.
- Le jour où deux applications doivent reconnaître la même personne, on remplace
  l'**implémentation** de l'interface — un annuaire, une table de correspondance — sans
  réécrire aucun schéma : les données portent déjà un identifiant opaque.

### 3. Le mode démonstration est une contrainte d'architecture

- Toute application de l'écosystème doit pouvoir tourner **entièrement** sur un jeu de données
  **factice**, versionné avec son code.
- La démonstration est **liée à l'environnement de qualification** que le propriétaire est en
  train de monter — pas une instance isolée de plus. Elle en partage le **chemin** : mêmes images,
  même déploiement, mêmes portes que ce qui part en production, pour que ce qu'on montre soit
  exactement ce qui est livré, et qu'une démonstration ne puisse pas vieillir à part.
- Elle n'en partage **pas les données**. Elle tourne dans son **propre silo** (bases et volumes
  distincts), sur le jeu factice, **sans accès** à aucune base réelle — pas un filtre posé sur des
  données réelles. Un filtre n'est qu'à un bug de la fuite ; un silo sans accès ne l'est pas.
- Quel environnement, et dans quel état : **non tranché** — voir le
  [point ouvert](#point-ouvert--quel-environnement-de-qualification).
- Les données du second utilisateur n'apparaissent dans **aucune** démonstration, jamais. Aucun
  mécanisme d'« anonymisation » de données réelles ne sert de source à la démonstration : le jeu
  factice est **écrit**, pas dérivé. La leçon vient de ce dépôt même, dont la publication a exigé
  d'anonymiser après coup ce qui aurait dû être synthétique dès l'origine.

### 4. Les gates de qualité sont la condition d'entrée

Ce que ce dépôt a de précieux est la norme de toute **nouvelle** application : décisions écrites
en ADR, CI qui **refuse** de passer, tests du domaine avec **mutation testing**, recherche de
secrets, aucune donnée réelle dans le dépôt. La norme porte sur les **familles** de garde-fous,
pas sur l'outillage exact : une application plus petite n'a pas à reproduire la pile Nx.

Pour une application existante, la règle s'applique **au module qu'on y ajoute**, et pas
rétroactivement à toute l'application (arbitrage PO du 2026-09-29) : la veille de
compétences, dans la veille emploi, entre sous ces gates — en particulier le mutation testing de
l'extraction, là où la classe de bug du §Contexte s'est déjà produite quatre fois.

C'est aussi ce qui fait la vitrine : une discipline visible et partagée vaut davantage qu'une
table `users` partagée.

### 5. Le partage se fait par événements et par référentiel commun

Chaque application reste autonome et **propriétaire** de ses données. Elle expose ce qu'elle
partage par des événements versionnés ou des exports, jamais par un accès à sa base. Aucune
application n'écrit chez une autre.

### Séquencement

1. **Cet ADR.** Les règles existent avant le code qu'elles contraignent — sinon le premier module
   écrit les fixe par défaut.
2. **La veille de compétences, à l'intérieur de la veille emploi.** Pas de nouvelle application
   (option F). C'est là que sont les annonces, et c'est là que le référentiel apprend ce qu'il
   doit porter.
3. **L'application de suivi de compétences, seulement si les deux premières servent réellement**,
   et dans sa version la plus pauvre : une compétence, un niveau, une date, une source. Rien
   d'autre tant que cette version n'est pas utilisée.

Deux **dépendances** conditionnent l'étape 2 :

- **Données.** La remise en service de l'API France Travail est un **préalable**, pas un
  correctif de confort. Avec 1 annonce complète sur 162 sur le gisement réel, l'étape 2 ne
  mesurerait rien d'autre que le format des alertes.
- **Qualité d'extraction.** La classe de bug « nettoyer avant de reconnaître » est un **risque
  connu** de l'extraction de compétences. La règle « le plus spécifique d'abord, le nettoyage
  ensuite » s'y applique d'emblée, et un test par variante déjà rencontrée précède la première
  mesure publiée.

## Risque résiduel — assumé

**L'outil qu'on construit à la place d'apprendre.** Une application de suivi de montée en
compétences est typiquement celle qu'on enrichit au lieu de s'en servir. D'où un **critère
d'abandon** écrit d'avance : si la version pauvre de l'étape 3 n'est pas utilisée pendant
**trois mois**, on ne l'enrichit pas — on l'arrête. Le même critère vaut pour l'indicateur de
l'étape 2 : un rapport de compétences que personne ne lit pendant trois mois n'est pas étendu.

**Un référentiel tenu à la main par une seule personne.** La règle « l'extraction propose, un
humain décide » fait du propriétaire le goulot du référentiel. C'est voulu — un référentiel
alimenté sans validation dérive en quelques semaines — mais la quarantaine peut grossir plus
vite qu'elle ne se vide. Ce qui dort en quarantaine n'est pas compté, et la mesure sous-estime
alors la demande sans le dire.

**La force `exigée` est un jugement.** Les signaux listés au §1 réduisent l'arbitraire sans le
supprimer ; deux annonces rédigées différemment pour le même poste peuvent être classées
différemment. L'indicateur est une **tendance** sur un même corpus, pas une vérité sur le marché.

## Point ouvert — quel environnement de qualification

Le §3 lie la démonstration à « l'environnement de qualification en cours de montage ». Cet ADR
**ne sait pas** de quel environnement il s'agit ni où il en est, et ne l'invente pas. Deux
candidats existent dans ce dépôt, et un troisième peut exister hors de lui :

- le **staging** de Martha, livré en phase 8 de la
  [roadmap CI/CD](../exploitation/28-roadmap-ameliorations-cicd.md) : pile isolée sur le serveur,
  joignable en boucle locale seulement, qui déploie et fume chaque `:main` avant promotion ;
- l'**environnement de recette** de la SFD 39 (validée v1.0, **non fusionnée** — PR #358), dont la
  remise en état de ce même staging est le lot 0 ;
- un environnement propre à la veille emploi, dont ce dépôt ne dit rien.

**Une tension à trancher avant de construire quoi que ce soit.** La SFD 39 v1.0 abandonne la
règle « données synthétiques seulement » pour la recette : elle y prévoit une **copie consentie
des données réelles du foyer**, cantonnée à staging. Si la démonstration était liée à cet
environnement **par ses données**, elle montrerait des données réelles — dont celles du second
utilisateur, membre du foyer — ce que le §3 interdit sans exception. La lecture compatible avec
les deux décisions est celle du §3 : même chemin de livraison, **silo de données distinct**, jeu
factice seul. Tant que la question n'est pas tranchée, la règle par défaut s'applique : **aucune
démonstration ne tourne sur un environnement qui contient des données réelles.**

## Conséquences

**Ce que la décision rend vrai :**

- La veille de compétences peut commencer sans qu'aucune autre application ne bouge, et sans
  qu'aucun service partagé n'existe.
- Aucune application n'a de dépendance de démarrage vers une autre.
- Le second utilisateur est protégé deux fois : par le filtre de propriétaire dans la veille, et
  par l'absence de ses données dans toute instance de démonstration.
- Les schémas sont prêts pour une identité commune sans qu'aucune ne soit construite.

**Ce qu'elle coûte, franchement :**

- **Rien n'est partagé aujourd'hui.** Le propriétaire qui voulait « rassembler les informations
  sur une personne » n'obtient, avec cet ADR, aucune vue transverse. C'est le prix explicite de
  l'identité différée.
- **Martha n'est pas concernée par la pièce centrale.** Martha ne manipule aucune compétence ;
  le référentiel lie la veille et une application future, pas les deux applications qui existent.
  Ce que Martha partage avec l'écosystème, à ce jour, c'est la discipline — pas des données.
- **Martha cloisonne par foyer, pas par personne.** La règle du §2 parle d'un « propriétaire
  opaque » précisément pour cela : chez Martha, le propriétaire d'une donnée est le foyer.
- **Martha porte une dette dès aujourd'hui, pas le jour d'une identité commune** (`AM-125`) : son
  identité circule par e-mail de la passerelle jusqu'aux services (§2). Son schéma n'est pas en
  cause — `parent` a déjà un identifiant opaque — mais la passerelle, l'assertion propagée et le
  rôle d'administrateur sont à reprendre, par un lot à part.
- **Deux fournisseurs d'authentification coexistent** (Cloudflare Access, identité du tailnet).
  L'interface étroite les cache ; elle ne les réconcilie pas.
- **Lier la démonstration à la qualification la rend dépendante de cet environnement** : une
  qualification en panne est une démonstration impossible, et c'est un silo de données de plus à
  tenir sur une machine déjà partagée.
- **Maintenir un jeu de données factice a un coût permanent** : chaque évolution de schéma doit
  le faire évoluer, faute de quoi la démonstration casse — et une démonstration cassée pousse à
  « juste montrer les vraies données une fois ».
- **La norme de qualité ralentit le démarrage** de toute nouvelle application. Pour un outil
  personnel, c'est un coût réel ; il est accepté parce que c'est aussi ce qui se montre.
- **Cet ADR vit dans le dépôt de Martha** mais gouverne des applications qui n'y sont pas. Son
  autorité sur la veille dépend de ce que la veille y **renvoie** ; tant qu'elle ne le fait pas,
  cet ADR n'est qu'une intention pour elle.

**Ce qu'elle ne change pas :**

- Aucune application existante n'est modifiée **par ce document**. Martha garde son cloisonnement
  par foyer ; son modèle d'identité ([ADR-0006](0006-preferences-notification-et-desabonnement.md))
  évoluera par le lot qui soldera `AM-125`, pas par cet ADR.
- L'exemption domestique de l'[ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md)
  est une décision **de Martha** ; elle ne s'étend pas d'office aux autres applications.

## Révision

Cet ADR **doit être rouvert** si l'un de ces seuils est franchi :

- **Le [point ouvert](#point-ouvert--quel-environnement-de-qualification) est tranché** :
  l'environnement de qualification est nommé et le §3 est amendé en conséquence, par écrit.

- **Deux applications doivent reconnaître la même personne** pour un besoin réel (pas
  anticipé) : l'interface du §2 reçoit une implémentation commune, et le choix de cette
  implémentation fait l'objet de son propre ADR.
- **Un second consommateur du référentiel existe** : le référentiel sort de la veille vers un
  service ou un paquet propre (option D), avec un contrat.
- **Une application de l'écosystème sert quelqu'un hors du foyer**, ou est proposée à des tiers :
  les seuils de l'[ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md) s'appliquent à
  elle, et la question d'un annuaire se repose sous l'angle des droits des personnes.
- **L'API France Travail reste inaccessible** : l'étape 2 ne démarre pas sur le seul gisement
  d'alertes ; si le blocage devient définitif, la veille de compétences est abandonnée ou
  réorientée par écrit, plutôt que mesurée sur des extraits.
- **Le critère d'abandon du §Risque résiduel est atteint** : l'étape concernée s'arrête, et
  l'arrêt est daté ici.
