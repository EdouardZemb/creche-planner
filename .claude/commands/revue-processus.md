---
description: Confronter le processus du dépôt à l'état de l'art et en tirer des lignes de registre
---

# Revue de processus

Confronte la façon de travailler de ce dépôt à l'état de l'art, et **écris le résultat dans
[`docs/34-registre-ameliorations.md`](../../docs/34-registre-ameliorations.md)**.

> La sortie de cette revue est un **flux de lignes** dans le registre — pas un document d'audit
> numéroté de plus. Le dépôt en compte déjà trois (docs 18, 25, 27) : tous ont fini périmés, parce
> qu'un instantané ne se met pas à jour. Si tu produis un document, tu as raté la commande.

## 1. Lire l'état réel avant de juger

Dans cet ordre, sans sauter d'étape :

1. `docs/34` — ce qui est déjà consigné. **Ne jamais re-signaler une ligne existante** ; la mettre
   à jour, ou la clore avec sa preuve.
2. `.claude/memory/MEMORY.md` et les fiches `piege-*` — les faux positifs déjà tranchés.
3. `.github/workflows/ci.yml` et `scripts/verifier-*.mjs` — les portes **telles qu'elles sont
   écrites**, pas telles qu'on les raconte. Le §5 du registre est la carte : vérifie qu'elle
   correspond encore.
4. `git log --since="<dernière revue>" --oneline` — ce qui a bougé depuis.

## 2. Confronter, référentiel par référentiel

Pour chaque axe : **un constat mesuré** (un chiffre, un chemin de fichier, une sortie de commande)
ou rien. Une remarque sans mesure ne devient pas une ligne de registre.

| Axe                     | Référence                                        | Question à instruire                                                                                 |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Prévention des défauts  | TMMi 5 — PA 5.1 _Defect Prevention_              | Chaque leçon a-t-elle une prévention **livrée** ? Un motif au-dessus du seuil est-il outillé ?       |
| Optimisation de process | TMMi 5 — PA 5.3                                  | Quelle porte a été ajoutée depuis la dernière revue ? Laquelle n'a jamais mordu ?                    |
| Post-mortem             | SRE — _blameless postmortem_                     | Un incident depuis la dernière revue a-t-il produit une action tracée, ou seulement un récit ?       |
| Livraison               | DORA — les quatre métriques                      | Le workflow `dora.yml` mesure-t-il encore la réalité ? Le délai mergé → déployé dérive-t-il ?        |
| Test                    | CTAL-TM / doc 21                                 | Le DDP de la doc 22 porte-t-il sur des défauts récents, ou sur la première moitié de l'histoire ?    |
| Portes                  | §5 du registre                                   | Une porte a-t-elle un périmètre plus étroit que ce qu'on lui prête ? Une porte est-elle sans sonde ? |
| Outillage agent         | `CLAUDE.md`, `.claude/commands/`, hooks, mémoire | Qu'est-ce qui est re-expliqué à chaque session et devrait être encodé une fois ?                     |

## 3. Écrire

Pour chaque constat retenu : une ligne, via le même geste que `/consigner` (famille, numéro,
colonnes complètes, motif rattaché). Puis :

```bash
pnpm registre
```

Ouvre **une PR dédiée** contenant la seule mise à jour du registre. Elle se relit en cinq minutes,
et c'est le tri du propriétaire — pas celui de l'agent — qui décide de la suite.

## 4. Ce qu'il ne faut pas faire

- Gonfler le registre pour paraître productif : une ligne sans mesure est une dette de lecture.
- Rouvrir un sujet marqué `⛔` sans élément nouveau — la décision est écrite, elle vaut.
- Traiter les pistes trouvées dans la foulée : cette commande **observe et consigne**. L'exécution
  est un autre geste, avec son plan et sa PR.
