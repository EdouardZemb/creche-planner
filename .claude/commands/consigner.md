---
description: Consigner une piste, une leçon ou une récurrence dans le registre (doc 34)
argument-hint: <le constat, en une phrase>
---

# Consigner au registre

Consigne **$ARGUMENTS** dans [`docs/34-registre-ameliorations.md`](../../docs/34-registre-ameliorations.md).

Le coût doit rester d'une phrase pour celui qui découvre le constat : c'est toi qui fais le
travail de mise en forme, de numérotation et de rattachement.

## 1. Choisir la famille — une seule question

- Le constat décrit **quelque chose à faire** qu'on ne fait pas maintenant → **piste `AM-xx`** (§2).
- Le constat décrit **pourquoi on s'est trompé** (méthode, outil, lecture) → **leçon `LE-xx`** (§3).
- Le constat décrit un **défaut produit** (montant faux, parcours cassé, donnée abîmée) → ce n'est
  pas ce registre : c'est `AN-xx` dans [doc 22](../../docs/22-registre-anomalies.md). Le dire, et
  s'arrêter là.
- Le constat décrit un **risque produit** → [doc 19](../../docs/19-registre-risque-produit.md).

En cas d'hésitation entre piste et leçon : si la phrase commence par « il faudrait », c'est une
piste ; si elle commence par « on a cru que », c'est une leçon.

## 2. Écrire la ligne

1. **Numéroter** : premier numéro libre de la famille, jamais un trou rebouché. Une ligne ne se
   supprime pas — elle passe en `⛔` avec sa raison.
2. **Remplir toutes les colonnes.** La porte `pnpm registre` refuse une ligne ouverte sans critère
   de sortie, une leçon sans prévention, une ligne close sans preuve. Ce n'est pas de la
   bureaucratie : c'est ce qui a manqué aux tableaux `AQ-xx`/`AUD-xx`, périmés faute de preuve.
3. **Origine** : le lot, la PR ou la session d'où sort le constat. Le déduire de la branche
   courante (`git branch --show-current`) et du plan en cours, sans le demander.
4. **Critère de sortie** (piste) : ce qui devra être **vrai**, pas ce qu'il faudra faire.
   « Index posé et mesure avant/après » plutôt que « regarder les index ».
5. **Prévention** (leçon) : ce qui empêchera la répétition. Si rien ne l'empêche, l'écrire — un
   risque assumé par écrit vaut mieux qu'une prévention inventée.

## 3. Rattacher à un motif — le geste qui compte

Relis le §4. Si la leçon ressemble à une leçon déjà là :

- rattache-la au motif existant **et incrémente son compteur** ;
- si le motif atteint **trois occurrences**, il ne prend plus de leçon : il prend une **porte**.
  Propose-la, chiffre-la, et ouvre une piste `AM-xx` si elle ne tient pas dans le lot courant.
  C'est la règle qui a manqué au motif « périmètre de l'outil », relevé huit fois avant d'être
  outillé.
- si aucun motif ne colle, laisse `—` : un motif à une occurrence n'existe pas encore.

## 4. Vérifier

```bash
pnpm registre
```

La porte recalcule les compteurs dans les deux sens, vérifie les preuves et refuse un chemin ou
une fiche de mémoire qui n'existe plus. Elle tourne sans `node_modules`.

## 5. Rendre compte

Une ligne, pas un rapport : l'identifiant attribué, la famille, le motif rattaché s'il y en a un,
et — s'il vient d'être atteint — le seuil de trois qui appelle une porte.
