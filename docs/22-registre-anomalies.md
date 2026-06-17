# 22 — Registre d'anomalies

> Statut : **Établi** · Version 1.0 · 2026-06-07
> **Structure** en tableau les anomalies jusqu'ici consignées en **prose** dans
> [doc 06](06-etat-davancement.md) (validation stack §13, §19.6, §19.7) et dans les commits `fix:`.
> Permet de dériver un **DDP par niveau de détection** (Defect Detection Percentage). Donne suite à
> l'action **P2-5** ([doc 18](18-audit-gestion-tests-ctal-tm-tmmi.md) §8 ; CTAL-TM Ch.3, PA TMMi 5.1).

---

## 1. Conventions

- **Gravité** : 🟥 Bloquant (montant faux / parcours cassé) · 🟧 Majeur (parcours dégradé) · 🟨 Mineur.
- **Niveau de détection** : niveau de test (ou activité) qui a **trouvé** le défaut, parmi ceux de la
  [stratégie](21-politique-strategie-test.md) §2.
- **Phase d'introduction** : phase ([doc 20](20-plan-de-test.md)) où le défaut a été injecté.
- **Commit** : commit de correction (`fix:`/`perf:`) ; chaque correction porte un **test de
  non-régression** (politique [doc 21](21-politique-strategie-test.md) §1.2).
- **Statut** : ✅ résolu · 🔄 ouvert (backlog).

---

## 2. Registre

| ID    | Anomalie                                                                     | Gravité | Niveau de détection                      | Phase d'intro.          | Commit / réf.            | Statut |
| ----- | ---------------------------------------------------------------------------- | :-----: | ---------------------------------------- | ----------------------- | ------------------------ | :----: |
| AN-01 | Barre de navigation non réactive : contrats invisibles après création foyer  |   🟧    | E2E stack réelle (validation navigateur) | P8 Web                  | `10d5f8d`                |   ✅   |
| AN-02 | `semaineType`/`semaineAbcm` tronqués (pas les 7 jours envoyés)               |   🟥    | E2E stack réelle                         | P8 Web                  | `79afcc6`                |   ✅   |
| AN-03 | Heures annuelles fractionnaires rejetées (colonne `integer` → 885,5 → 500)   |   🟥    | E2E stack réelle                         | P5 Planification        | `c7993ba`                |   ✅   |
| AN-04 | Garde de période absente des calendriers : jours « Cantine » fantômes        |   🟧    | E2E stack réelle                         | P10 Front               | doc 06 §19.6 (Phase 15)  |   ✅   |
| AN-05 | Jours « gardés » marqués sans plage réelle (week-end gardé, doc 14)          |   🟧    | E2E stack réelle                         | P8 Web                  | `576286c`                |   ✅   |
| AN-06 | Latence `/couts/annuel` ~7 s / 502 sous 12 requêtes concurrentes             |   🟥    | Performance (validation sous charge)     | P7 Gateway/Tarification | `9bf00a6` (doc 06 §19.7) |   ✅   |
| AN-07 | Modale de confirmation ne focalise pas « Annuler » (EC-01)                   |   🟨    | a11y (axe-core / runbook)                | P12 a11y                | `fc90085`                |   ✅   |
| AN-08 | A11y de l'UI d'ajustement de planning insuffisante                           |   🟨    | a11y (axe-core)                          | P10 Front               | `e44a13b`                |   ✅   |
| AN-09 | Build Docker des services cassé (deps OTel/zod non embarquées)               |   🟥    | Smoke-stack (boot pile)                  | P9 Durcissement         | `3878cf0`                |   ✅   |
| AN-10 | Foyer périmé mémorisé au chargement (état UI incohérent)                     |   🟨    | E2E / composant                          | P8 Web                  | `33167ac`                |   ✅   |
| AN-11 | Erreur de modification durable de contrat détruisant l'état UI               |   🟧    | Composant (test de non-régression)       | P10 Front               | `f1c5a20`                |   ✅   |
| AN-12 | Édition / suppression de contrat absente (seul le planning mensuel éditable) |   🟧    | Validation manuelle (backlog)            | P7 Gateway/UI           | doc 06 §13 (backlog 1)   |   🔄   |
| AN-13 | Prestations non filtrées par période de validité côté **domaine**            |   🟧    | Validation manuelle (backlog)            | P5 Planification        | doc 06 §13 (backlog 2)   |  🔄¹   |

> ¹ AN-13 : **atténué** côté affichage (les calendriers front filtrent par `[valideDu, valideAu]`,
> cf. AN-04) ; la garde de période est **correcte côté `svc-tarification`** (coût juste). Le
> durcissement **domaine** Planification (ne générer aucune prestation hors période) reste un suivi.

---

## 3. DDP par niveau de détection

Defect Detection Percentage = part des défauts **trouvés** à chaque niveau (sur 11 défauts clos
AN-01..11 ; les 2 ouverts AN-12/13 sont issus de la validation manuelle, hors calcul DDP).

| Niveau de détection        | Défauts trouvés           | DDP      |
| -------------------------- | ------------------------- | -------- |
| **E2E stack réelle**       | AN-01, 02, 03, 04, 05, 10 | **55 %** |
| a11y (axe-core)            | AN-07, 08                 | 18 %     |
| Performance                | AN-06                     | 9 %      |
| Smoke-stack                | AN-09                     | 9 %      |
| Composant (non-régression) | AN-11                     | 9 %      |
| Unitaire domaine           | 0                         | 0 %      |

### Lecture

- **L'E2E stack réelle est le filet le plus productif** (55 % des défauts) : tous des défauts
  **d'intégration** que l'E2E **mocké** ne pouvait pas révéler — confirme empiriquement la règle
  d'équipe ([doc 03](03-standards-developpement.md) §6) née de la doc 14.
- **0 défaut trouvé au niveau unitaire domaine** : cohérent avec la couverture 100 % + MBT (les
  défauts ne sont **pas** dans la logique pure mais aux **frontières** — DTO, persistance, intégration,
  rendu). → Angle d'amélioration : étendre BVA/tables de décision aux DTO d'entrée (suivi P3-5).
- **Aucune fuite vers la production** : tous les défauts clos ont été pris **avant** mise en usage,
  par un niveau de test ou la validation — mais la **fuite inter-niveaux** (unit → intégration) est
  réelle et désormais **mesurée** (et non plus masquée par l'auto-évaluation « 0 bug »).

---

## 4. Liens

- KPI « défauts trouvés en usage réel » : [doc 21](21-politique-strategie-test.md) §1.3
- Risques associés : [doc 19](19-registre-risque-produit.md) (RT-03 régression d'intégration)
- Prose d'origine : [doc 06](06-etat-davancement.md) §13, §19.6, §19.7
- Modèle d'anomalie (champs) : [`.github/ISSUE_TEMPLATE/bug.yml`](../.github/ISSUE_TEMPLATE/bug.yml) (P2-4)
