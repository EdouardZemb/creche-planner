# ADR-0013 — Les contrôles requis sont engendrés, pas rédigés — et le relevé reste un geste humain

- **Statut** : Accepté
- **Date** : 2026-10-03
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0003](0003-decisions-de-toolchain.md) (chaîne d'outils et portes
  de qualité). Extension directe du principe que `pnpm faits` et `pnpm readme` appliquent
  déjà : une affirmation rédigée à la main pourrit.
- **Numérotation** : `0013` et non `0011` — les numéros `0011` et `0012` sont pris par deux
  PR sœurs du même jour, et un numéro d'ADR ne se réattribue jamais. Si l'une d'elles n'est
  pas retenue, le trou reste.
- **Déclencheur** : le 2026-10-03, `CLAUDE.md` annonçait **deux** contrôles requis sur
  `main`. Il y en avait **cinq** depuis le 2026-09-30.

## Contexte

`CLAUDE.md` est le premier document que lit quiconque arrive sur ce dépôt — humain ou
agent. Sa ligne 64 énonçait un fait de configuration (`ci` et `config-validation`) qui était
vrai le jour où il a été écrit. Trois contrôles s'étaient ajoutés depuis sans que la phrase
bouge : une session entière peut se tromper de cible sur cette seule ligne, et c'est arrivé.

Le dépôt connaît déjà le remède et l'a inventé deux fois (`pnpm faits`, `pnpm readme`) :
**l'affirmation est engendrée, pas rédigée.** Reste à l'appliquer à un fait qui ne vit pas
dans le dépôt, mais dans la configuration GitHub — et c'est là que le remède habituel se
heurte à un obstacle.

## La difficulté

La source de vérité est `GET /repos/{depot}/branches/main/protection`, qui exige la
permission **Administration (read)**. Une porte de CI qui l'appellerait à chaque PR
dépendrait d'un droit, d'un secret et du réseau. Elle échouerait un jour pour une raison
sans rapport avec la documentation — et une porte qui échoue pour une raison de droits est
désactivée, puis oubliée. **On ne remplace pas un fait périmé par une porte fragile.**

Le secret `ALERTS_TOKEN` existe mais ne convient pas : il est posé pour les alertes
Dependabot (_Secret scanning alerts: Read_, qui lui manque d'ailleurs déjà), et la lecture
de la protection de branche relève d'une permission entièrement différente. S'appuyer
dessus sans vérifier aurait été refaire l'erreur que cet ADR combat.

## Décision

**Le relevé est découpé en deux temps.**

| Temps                      | Où               | Réseau  | Ce qu'il fait                                                             |
| -------------------------- | ---------------- | ------- | ------------------------------------------------------------------------- |
| `pnpm controles --relever` | poste, à la main | oui     | interroge l'API, réécrit `scripts/controles-requis.json`                  |
| `pnpm controles --ecrire`  | poste            | non     | rend le bloc de `CLAUDE.md` depuis le relevé                              |
| `pnpm controles`           | **CI**           | **non** | refuse que le bloc versionné diverge du rendu, et juge la forme du relevé |

La CI ne touche jamais au réseau pour ce fait. Elle garantit une propriété plus faible mais
**toujours vraie** : la documentation dit exactement ce que dit le relevé, caractère pour
caractère. Une seule fonction, `rendre()`, sait écrire la phrase — si deux endroits savaient
l'écrire, ils divergeraient, ce qui est le défaut même qu'on traite.

**Une sonde mesure ce qu'on ne savait pas.** Le job non bloquant
`controles-requis-droits` de `ci.yml` tente la lecture avec le jeton par défaut et écrit le
code HTTP dans le résumé du run. Il ne peut pas échouer, par construction.

La première version de ce job déclarait `permissions: administration: read`, en supposant
que ce droit s'accordait comme les autres. **Il ne s'accorde pas** : `administration` n'est
pas une permission qu'un workflow peut donner au `GITHUB_TOKEN`, et l'écrire a rendu
`ci.yml` entier invalide — run « workflow file issue », 0 s, aucune porte jouée (run
`37124898593`, 2026-10-03). La supposition a donc coûté un run, et elle a rendu la réponse
plus nette qu'espéré : **la lecture de la protection de branche est hors d'atteinte du
jeton par défaut, quelles que soient les permissions déclarées.** Elle exigerait un PAT
dédié, c'est-à-dire exactement la dépendance à un secret que cet ADR refuse d'installer
dans une porte.

La sonde reste en place pour ce qu'elle mesure encore : si GitHub rendait un jour cet
endpoint lisible au jeton par défaut, le résumé le dirait et la décision serait à rouvrir.

## Conséquences

**Acceptées — et celle-ci est importante.**

- **La porte ne sait pas si le relevé est à jour.** Elle garantit que la documentation dit
  ce que dit le relevé, pas que le relevé dise ce que dit GitHub. Un changement de
  protection non suivi d'un `--relever` passe au travers : la ligne 64 pourrait redevenir
  fausse, de la même façon qu'elle l'est devenue. La porte a seulement supprimé la dérive
  par recopie, pas la dérive par silence.
- Contre-mesures, nommées pour ce qu'elles valent : la date `releveLe` est rendue dans la
  phrase elle-même (un lecteur voit de quand date l'affirmation), et la porte avertit
  au-delà de 90 jours. Un avertissement n'est pas une garantie.
- `--relever` est un geste humain, donc oubliable. C'est le prix d'une porte qui ne dépend
  d'aucun droit.

**Obtenues.**

- La ligne 64 est juste, et le restera tant que le relevé l'est.
- Elle porte désormais sa date, le mode strict, le nombre de revues et la soumission des
  administrateurs — des faits qui n'y étaient pas du tout.
- Six sondes négatives (`pnpm controles --autotest`), dont une qui refuse qu'une **seconde**
  phrase du document énonce la liste : la recopie est interdite, pas seulement corrigée.

## Alternatives écartées

| Option                                                             | Pourquoi non                                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Porte de CI qui interroge l'API à chaque PR                        | dépend d'un droit, d'un secret et du réseau ; échouera un jour pour une raison étrangère, puis sera désactivée |
| S'appuyer sur `ALERTS_TOKEN`                                       | posé pour une autre permission, et incomplet même pour celle-là — supposer aurait refait l'erreur combattue    |
| Corriger la ligne 64 à la main et s'arrêter là                     | remet en place exactement ce qui a pourri                                                                      |
| Un `--relever` quotidien en CI qui ouvrirait une PR de mise à jour | utile, mais suppose d'abord un jeton qui lit — à rouvrir si la sonde de droits répond `200`                    |
