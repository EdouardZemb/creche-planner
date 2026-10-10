# Index des décisions d'architecture (ADR)

> Statut : **Index vivant** · 2026-09-27 — il n'a pas d'état propre, il reflète celui
> des ADR qu'il liste. Chaque ADR porte son propre statut et sa propre date.

Une décision entre ici quand elle a été **réellement contestée** : deux options
défendables, un arbitrage, et des conséquences qu'on accepte — y compris les
inconfortables. Une décision évidente ne mérite pas d'ADR ; un renoncement, si.

**Convention.** Un fichier `NNNN-titre.md` par décision, numéro **jamais réattribué**,
jamais renuméroté (les renvois croisés en dépendent). Un ADR ne se réécrit pas : il se
**remplace** par un ADR suivant qui le supersède. La porte `pnpm readme` refuse qu'un
ADR existe sans être annoncé en page d'accueil, avec son intitulé.

| ADR                                                              | Décision                                                                                                                                                   | Statut  | Date       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| [0001](0001-architecture-microservices.md)                       | **Architecture microservices** pour un outil mono-foyer — exercice d'ingénierie assumé, avec son coût énoncé d'entrée                                      | Accepté | 2026-06-02 |
| [0002](0002-grain-services-et-politiques-tarifaires.md)          | **Grain des services** et tarification multi-modes par stratégies `PolitiqueTarifaire` interchangeables                                                    | Accepté | 2026-06-02 |
| [0003](0003-decisions-de-toolchain.md)                           | **Toolchain** : monorepo Nx, pnpm, setup « TS solution » — et ce qu'il impose au reste                                                                     | Accepté | 2026-06-02 |
| [0004](0004-decentralisation-des-contrats.md)                    | **Contrats décentralisés par contexte** plutôt qu'une bibliothèque de schémas partagée                                                                     | Accepté | 2026-06-04 |
| [0005](0005-registre-de-contrats.md)                             | **Registre de contrats** en pacts fichiers committés + garde `can-i-deploy`, au lieu d'un broker hébergé                                                   | Accepté | 2026-06-04 |
| [0006](0006-preferences-notification-et-desabonnement.md)        | **Préférences de notification** portées par `svc-foyer` + désabonnement one-click (RFC 8058)                                                               | Accepté | 2026-07-01 |
| [0007](0007-exemption-domestique-et-demarche-volontaire.md)      | **Exemption domestique RGPD** assumée, et devoirs de protection des données outillés quand même                                                            | Accepté | 2026-08-11 |
| [0008](0008-ecarts-semantique-http-pagination-et-concurrence.md) | **Écarts de sémantique HTTP** sur la pagination et la concurrence optimiste — nommés, pas dissimulés                                                       | Accepté | 2026-08-14 |
| [0009](0009-nom-du-produit-martha.md)                            | **Le produit s'appelle « Martha »**, renommage d'**affichage seul** : l'identité technique reste `creche-planner`                                          | Accepté | 2026-08-17 |
| [0010](0010-ecosysteme-applications-personnelles.md)             | **Écosystème d'applications personnelles** : un **référentiel de compétences** partagé d'abord, l'identité commune différée derrière une interface étroite | Accepté | 2026-09-29 |
| [0012](0012-peremption-visible.md)                               | **Rendre la péremption visible** : veille différentielle sans état stocké, et exceptions de sécurité à date d'expiration native Trivy                      | Accepté | 2026-10-03 |
| [0013](0013-faits-documentaires-engendres.md)                    | **Les contrôles requis sont engendrés**, pas rédigés — et le relevé reste un geste humain, pour qu'aucune porte ne dépende d'un droit                      | Accepté | 2026-10-03 |

## Par où entrer

- **Comprendre la forme du système** : [0001](0001-architecture-microservices.md) puis
  [0002](0002-grain-services-et-politiques-tarifaires.md).
- **Comprendre comment les services restent découplés** :
  [0004](0004-decentralisation-des-contrats.md) et [0005](0005-registre-de-contrats.md)
  — c'est la paire qui explique `libs/contracts/*` et le dossier
  [`pacts/`](../../pacts/).
- **Comprendre une bizarrerie d'API** :
  [0008](0008-ecarts-semantique-http-pagination-et-concurrence.md) avant d'ouvrir une
  anomalie.
- **Comprendre pourquoi deux noms coexistent à l'écran** :
  [0009](0009-nom-du-produit-martha.md).
- **Ajouter une application à côté de Martha** :
  [0010](0010-ecosysteme-applications-personnelles.md) — ce qui se partage, et ce qui ne
  se partage pas encore.

Cadre amont : [doc 04 — architecture & technologies](../04-architecture-et-technos.md)
et [doc 09 — découplage microservices](../09-spec-decouplage-microservices.md). La
politique documentaire qui régit la forme de ces fiches est en
[doc 35](../35-politique-documentation.md).
