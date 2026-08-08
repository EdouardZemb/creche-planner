# 34 — Politique de documentation

> Statut : **Établi** · 2026-08-08 · Revue : à chaque ajout de porte documentaire
> Ce que ce dépôt attend d'un document, quelles normes il emprunte, et ce que
> l'outillage garantit **réellement** — par opposition à ce qu'il recommande.

## 1. Pourquoi ce document existe

Le 2026-08-08, le README annonçait « en production, version `0.8.0`, 8 trains de
release ». Le réel : `0.15.0`, 16 trains. Ce n'était pas la première fois — la
session de gouvernance documentaire du 2026-07-02 avait déjà relevé le même
document « périmé : Phase 9, React 18, 4 services », et l'avait rafraîchi.
**Deux dérives en six semaines sur le document que lit un arrivant en premier.**

Un rafraîchissement manuel qui se répète tous les mois et demi n'est pas une
politique, c'est un symptôme. La cause est structurelle et elle a un nom dans ce
dépôt : la **recopie**. Chacun de ces faits — version, liste des services, ports,
versions de la chaîne d'outils — vit déjà quelque part, écrit par un outil
(`package.json`, `services.json`, `docker-compose*.yml`, les `CHANGELOG.md`
produits par `nx release`). Le document en tenait une copie à la main.

La leçon est celle qui revient dans ce dépôt depuis les lots D2, C5, D4, B7, D6
et D8 : **un document n'est pas tenu par la discipline de celui qui l'écrit, il
est tenu par ce qui refuse de le laisser mentir.** Cette politique emprunte donc
aux normes leur vocabulaire et leurs gabarits, et met l'effort sur les portes.

## 2. Normes retenues, et ce qu'on en prend

Aucune n'est adoptée en bloc : chaque ligne dit ce qu'on emprunte et à quoi ça
sert ici. Ce qui n'est pas dans ce tableau n'est pas une référence du dépôt.

| Norme / cadre                          | Ce qu'on en prend                                                                                                                                        | Où ça s'applique                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **ISO/IEC/IEEE 29148:2018**            | Les caractéristiques d'une exigence : nécessaire, non ambiguë, **vérifiable**, singulière, traçable. Et la traçabilité bidirectionnelle exigence ↔ test  | [doc 01](01-spec-fonctionnelle.md), SFD 30 → 33                                                                   |
| **EARS** (syntaxe, pas une norme)      | Les 5 patrons de phrase (`WHEN` / `WHILE` / `IF-THEN` / `WHERE` / ubiquitaire) : une exigence phrasée ainsi est lisible par une machine                  | SFD encore à l'état de brouillon                                                                                  |
| **ISO/IEC 25010:2023**                 | Le modèle de qualité produit, pour ranger les exigences NON fonctionnelles au lieu de les éparpiller                                                     | a11y (WCAG AA), perf (p95), RGPD, résilience                                                                      |
| **ISO/IEC/IEEE 42010:2022**            | Parties prenantes → préoccupations → **points de vue** → vues ; et la décision d'architecture comme artefact de plein droit                              | [doc 04](04-architecture-et-technos.md), [ADR](adr/)                                                              |
| **arc42**                              | Le gabarit libre qui opérationnalise 42010, comme grille de relecture — pas comme plan imposé                                                            | docs 04 et [09](09-spec-decouplage-microservices.md)                                                              |
| **C4 model**                           | Les niveaux contexte / conteneurs / composants, pour ne pas mélanger deux altitudes dans un même schéma                                                  | schémas d'architecture                                                                                            |
| **ISO/IEC/IEEE 26511 / 26514 / 26515** | Le **processus** : qui revoit quoi, à quelle échéance, et le cycle de revue d'un document (26515 pour le rythme agile)                                   | §4 ci-dessous                                                                                                     |
| **Diátaxis**                           | Les 4 quadrants — tutoriel / how-to / **référence** / explication — et la règle qui en découle : un document, un quadrant                                | §3 ci-dessous                                                                                                     |
| **ISTQB (CT-MBT, CTAL-TM) / TMMi**     | Déjà appliqué : c'est le domaine documentaire le plus sain du dépôt, et ce n'est pas un hasard — c'est le seul qui a une norme externe **et** des portes | docs [18](18-audit-gestion-tests-ctal-tm-tmmi.md), [20](20-plan-de-test.md), [21](21-politique-strategie-test.md) |

## 3. Un document, un quadrant (Diátaxis)

Les quatre natures ne se mélangent pas dans un même fichier — mélanger, c'est ce
qui rend un document impossible à tenir à jour :

| Quadrant        | Ce que c'est                   | Ici                                                                 |
| --------------- | ------------------------------ | ------------------------------------------------------------------- |
| **Référence**   | L'état des choses, consultable | README, docs 02 (formules), OpenAPI/AsyncAPI, docs 20/21            |
| **How-to**      | Une tâche, une procédure       | `docs/exploitation/` (runbooks), CONTRIBUTING                       |
| **Explication** | Pourquoi c'est ainsi           | [ADR](adr/), docs 04 et 09                                          |
| **Journal**     | Ce qui s'est passé, daté       | [doc 06](06-etat-davancement.md), `.claude/memory/`, `CHANGELOG.md` |

Le journal n'est pas un quadrant Diátaxis : c'est un ajout assumé, parce que ce
dépôt en produit beaucoup (relevés d'incident, plans clos). Il a une propriété
que les trois autres n'ont pas — **il ne périme jamais**, puisqu'il relate une
date. C'est ce qui justifie que les portes ci-dessous le traitent à part.

> **Dette connue, et nommée** : `docs/06` est à la fois journal, référence d'état
> et guide de reprise — 2 221 lignes, et un en-tête (« Phase 11 réalisée ») que
> son propre §18 contredit. C'est exactement la panne que Diátaxis prédit. Le
> découpage est un lot à part entière, hors du périmètre de ce document.

## 4. Ce qu'un document doit porter

- **Un statut daté** (outillé : `pnpm statuts`). Trois formes sont acceptées,
  parce qu'elles ont été **relevées** dans le dépôt plutôt que décrétées : le
  bandeau `> Statut : **<état>** · <date>`, la liste d'en-tête des ADR
  (`- **Statut** :` + `- **Date** :`) et le tableau d'en-tête (`| **Statut** |`).
  Un statut sans date ne se relit pas : rien ne dit s'il vaut encore. La date est
  celle où le statut a été **affirmé**, pas celle de la dernière modification du
  fichier — cette dernière est déjà dans git, et la recopier serait précisément
  ce que §4 interdit.
- **Un quadrant identifiable** (§3). Un document qui en mélange deux se scinde.
- **Aucun fait recopié** qu'un outil écrit déjà — cf. §5. Si un fait DOIT être
  cité (lisibilité), il entre dans le registre de la porte, qui le confronte à
  sa source.
- **Les liens internes plutôt que les chemins en prose** : un lien est vérifié
  par la CI, une phrase « voir le fichier X » ne l'est pas.

> **Deux mesures, dont une correction.** La première version de ce document
> annonçait « 26 fichiers sans en-tête de statut » : c'était faux, parce que la
> mesure ne cherchait qu'UNE des trois formes. Le compte réel sur 48 documents :
> **32 portaient déjà statut et date**, 16 n'avaient pas de statut — 14 après
> retrait de l'index et du gabarit Nx, tous complétés depuis. La porte est donc
> verte, et la leçon est celle du dépôt : une mesure trop étroite accuse à tort
> aussi sûrement qu'elle rassure à tort.
>
> **Reste une question qui n'appartient pas à la machine** : **14 documents**
> portent un statut « à valider » — docs 01, 02, 03, 04, 07, 08, 09, 10, 11, 12
> et les SFD 30 → 33. Pour les SFD 31 → 33, c'est exact : elles attendent le PO.
> Pour les onze autres, le contenu est **livré et en production** (la SFD 30 est
> déployée depuis le 2026-07-29). Une machine peut constater l'absence d'un
> statut, elle ne peut pas décider qu'une validation a eu lieu : **c'est un geste
> du propriétaire du produit**, et il est nommé ici pour ne plus être invisible.

## 5. Ce que l'outillage garantit

Quatre portes, toutes **bloquantes** dans le job `ci`, toutes jouables en moins
d'une seconde et sans réseau :

| Porte              | Ce qu'elle refuse                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm liens`       | Un lien interne mort : cible inexistante, ou **ancre** ne correspondant à aucun titre du document visé (l'ancre suit le texte du titre)                   |
| `pnpm faits`       | Une valeur citée qui contredit sa source : version coupée, projets Nx de l'arborescence, ports publiés par la pile locale, chaîne d'outils                |
| `pnpm statuts`     | Un document de `docs/` qui n'annonce ni ce qu'il est, ni depuis quand (ISO/IEC/IEEE 26511)                                                                |
| `pnpm tracabilite` | Une exigence définie que nul test ne nomme, ou un test qui cite une exigence que plus aucune spécification ne définit (ISO/IEC/IEEE 29148, les deux sens) |

Elles s'ajoutent à `pnpm frontieres` (frontières Nx et miroirs de vocabulaire) et
`pnpm pieges` (pièges morts recopiés), déjà en place.

**Ce que `pnpm tracabilite` est, honnêtement** : un **cliquet**, pas une
découverte. Les deux familles sont complètes au jour où elle est écrite — `CT`
18/18 (la numérotation saute simplement 09 et 19, qui n'existent dans aucune
source) et `UT` 10/10. Elle ne trouve rien aujourd'hui ; elle empêche le prochain
écart. Et elle vérifie la **citation**, pas la pertinence : qu'un test nomme
`CT-07` ne dit pas qu'il éprouve ce que `CT-07` décrit. Aucune machine ne le
dirait — c'est le travail de la revue.

**Ce que `pnpm faits` NE peut pas savoir**, et il faut le connaître pour ne pas se
croire couvert : le dépôt sait quelle version a été **coupée** par `nx release`,
pas laquelle est **promue en production**, ni à quelle date, ni le rang du train.
Le serveur n'est joignable qu'en LAN. Le rang et la date de promotion restent
donc des **faits humains**, tenus par les fiches de `.claude/memory/`. La porte
garantit une chose précise : la version citée est bien une version coupée, et les
7 services applicatifs sont alignés dessus.

Les quatre portes suivent la contrainte de conception des scripts de ce dépôt :
**aucune conclusion par défaut**. Un balayage qui ne lit aucun document, une
source devenue illisible, ou un fait qui a disparu du document, font **échouer**
le script au lieu de rendre « rien à signaler » — un balayage à vide est
indiscernable d'un succès. La session qui a écrit ces portes s'y est fait
prendre trois fois, et c'est la meilleure raison de garder la règle : un
« 0 violation » rassurant venait d'un binaire de mesure désinstallé entre deux
commandes ; une comparaison par sous-chaîne laissait `svc-notifications/` valoir
présence de `notifications/` ; et une liste d'extensions de test incomplète
(`.test.tsx` oubliée) a accusé quatre exigences d'être sans test alors qu'elles
en avaient un. Les trois ont été trouvées en **sondant la porte contre un défaut
connu**, jamais en lisant son résultat vert.

## 6. Ce qui n'est PAS outillé, et pourquoi

Rien de ci-dessous n'est une intention vague : chaque ligne est mesurée et
dimensionnée.

- **markdownlint** — mesuré le 2026-08-08 sur 52 fichiers. `MD013/line-length`
  seule produit **4 406** signalements : c'est prettier qui possède le retour à
  la ligne ici, la règle doit rester éteinte. Restent **67** signalements avec la
  config retenue (`MD013`, `MD033`, `MD034` éteintes, `MD024` en `siblings_only`),
  dont **44 survivent à `--fix`** (`MD040` ×26, `MD028` ×14, 4 unitaires). Et
  surtout : **`--fix` corrompt du texte** sur ce corpus — `MD038` a transformé
  `` `(date de commit du `ref` déployé)` `` en `` `du`ref`déployé` `` sur des
  spans de code imbriqués. La porte est donc faisable et bornée, mais elle arrive
  avec son passif traité à la main, comme `lint-baseline.json` : c'est un lot,
  pas une case à cocher.
- **Liens externes** — les joindre demande le réseau, et une porte de CI qui
  dépend d'un site tiers échoue pour des raisons qui ne sont pas celles du dépôt.
  Coût assumé : un lien externe mort survit.
- **Traçabilité au-delà de `CT` et `UT`** — les deux familles de la doc 02 et de
  la doc 11 sont tracées par `pnpm tracabilite`. D'autres identifiants circulent
  (`DV-01`, `AQ-xx`, `AUD-xx`, `DEC-xx`) sans spécification unique qui en fasse
  foi : les tracer demanderait d'abord de désigner ce document-là, famille par
  famille. Non fait, et c'est un choix — un oracle pointé sur une source
  ambiguë ne garde rien.
- **Le sens « exigence → implémentation »** — `pnpm tracabilite` demande qu'un
  **test** nomme l'exigence. Les `UT` sont aussi citées dans le code des
  composants, ce qui est une autre relation 29148, non vérifiée ici.
- **La VALEUR d'un statut** — `pnpm statuts` exige qu'un document dise ce qu'il
  est et depuis quand ; il ne peut pas savoir qu'un « À valider » recouvre du
  code parti en production (§4). Ce geste-là est celui du PO.
- **Le découpage de `docs/06`** (§3) — 2 221 lignes qui mélangent journal,
  référence d'état et guide de reprise. Nommé, dimensionné, non fait.
- **Fraîcheur d'un document** — aucune machine ne sait qu'une phrase est devenue
  fausse si aucune source ne la contredit. C'est la limite de fond : les portes
  attrapent les faits **dérivables**, pas les affirmations. Le reste relève de la
  revue.

## 7. Renvois

- [CONTRIBUTING.md](../CONTRIBUTING.md) — commandes de tous les jours, et
  § « Pièges : ce que l'outillage garantit » (source unique sur la boucle de dev).
- [CONVENTIONS.md](../CONVENTIONS.md) §4 — frontières Nx et vocabulaire partagé.
- [Index de la documentation](README.md) — par thème et par besoin.
- [doc 03](03-standards-developpement.md) §10 — les décisions structurantes vont
  en ADR.
