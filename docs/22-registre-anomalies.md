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
- **Périmètre** : ce registre porte les défauts **produit** (montant faux, parcours cassé, donnée
  abîmée). Ce qu'on apprend sur la **façon de travailler** — pistes non traitées, leçons de
  méthode, périmètre réel des portes — va en [doc 34](34-registre-ameliorations.md), qui est un
  registre **vivant** et non un instantané.

---

## 2. Registre

| ID    | Anomalie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gravité | Niveau de détection                                     | Phase d'intro.          | Commit / réf.            | Statut |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----: | ------------------------------------------------------- | ----------------------- | ------------------------ | :----: |
| AN-01 | Barre de navigation non réactive : contrats invisibles après création foyer                                                                                                                                                                                                                                                                                                                                                                                                                                                 |   🟧    | E2E stack réelle (validation navigateur)                | P8 Web                  | `10d5f8d`                |   ✅   |
| AN-02 | `semaineType`/`semaineAbcm` tronqués (pas les 7 jours envoyés)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |   🟥    | E2E stack réelle                                        | P8 Web                  | `79afcc6`                |   ✅   |
| AN-03 | Heures annuelles fractionnaires rejetées (colonne `integer` → 885,5 → 500)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |   🟥    | E2E stack réelle                                        | P5 Planification        | `c7993ba`                |   ✅   |
| AN-04 | Garde de période absente des calendriers : jours « Cantine » fantômes                                                                                                                                                                                                                                                                                                                                                                                                                                                       |   🟧    | E2E stack réelle                                        | P10 Front               | doc 06 §19.6 (Phase 15)  |   ✅   |
| AN-05 | Jours « gardés » marqués sans plage réelle (week-end gardé, doc 14)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |   🟧    | E2E stack réelle                                        | P8 Web                  | `576286c`                |   ✅   |
| AN-06 | Latence `/couts/annuel` ~7 s / 502 sous 12 requêtes concurrentes                                                                                                                                                                                                                                                                                                                                                                                                                                                            |   🟥    | Performance (validation sous charge)                    | P7 Gateway/Tarification | `9bf00a6` (doc 06 §19.7) |   ✅   |
| AN-07 | Modale de confirmation ne focalise pas « Annuler » (EC-01)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |   🟨    | a11y (axe-core / runbook)                               | P12 a11y                | `fc90085`                |   ✅   |
| AN-08 | A11y de l'UI d'ajustement de planning insuffisante                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |   🟨    | a11y (axe-core)                                         | P10 Front               | `e44a13b`                |   ✅   |
| AN-09 | Build Docker des services cassé (deps OTel/zod non embarquées)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |   🟥    | Smoke-stack (boot pile)                                 | P9 Durcissement         | `3878cf0`                |   ✅   |
| AN-10 | Foyer périmé mémorisé au chargement (état UI incohérent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |   🟨    | E2E / composant                                         | P8 Web                  | `33167ac`                |   ✅   |
| AN-11 | Erreur de modification durable de contrat détruisant l'état UI                                                                                                                                                                                                                                                                                                                                                                                                                                                              |   🟧    | Composant (test de non-régression)                      | P10 Front               | `f1c5a20`                |   ✅   |
| AN-12 | Édition / suppression de contrat absente (seul le planning mensuel éditable)                                                                                                                                                                                                                                                                                                                                                                                                                                                |   🟧    | Validation manuelle (backlog)                           | P7 Gateway/UI           | doc 06 §13 (backlog 1)   |   🔄   |
| AN-13 | Prestations non filtrées par période de validité côté **domaine** — **libellé faux** : le filtrage existait, c'est la **représentation** d'une période **ouverte** qui manquait¹                                                                                                                                                                                                                                                                                                                                            |   🟧    | Constat négatif de lot (lot 1 « le coût ne ment plus ») | P5 Planification        | doc 34 `AM-13`, `LE-63`  |   ✅   |
| AN-14 | Allowlist mailer compare le `to` **entier** (`includes`), pas par destinataire → bloque tout dès qu'un foyer a ≥2 parents                                                                                                                                                                                                                                                                                                                                                                                                   |   🟧    | Revue de code (activation envoi réel)                   | Lot 2 Notifications     | PR #128                  |   ✅   |
| AN-15 | Rate-limit de la gateway compté sur l'IP du reverse-proxy : un seul compteur pour **tous** les foyers                                                                                                                                                                                                                                                                                                                                                                                                                       |   🟧    | Revue de code (audit sécurité)                          | P7 Gateway              | `7f9f599`                |   ✅   |
| AN-16 | `GET /api/referentiel/health` publique, sans cache ni délai d'expiration, touche la base à chaque appel                                                                                                                                                                                                                                                                                                                                                                                                                     |   🟨    | Revue de code (audit sécurité)                          | P7 Gateway              | doc 34 `AM-28`           |   🔄   |
| AN-17 | `GET /api/v1/foyers` renvoie les revenus et RFR de **tous** les foyers : `ADMIN_EMAILS` vide ⇒ tout appelant est traité comme admin                                                                                                                                                                                                                                                                                                                                                                                         |   🟥    | Revue de code (audit sécurité)                          | P7 Gateway              | `7f9f599`                |   ✅   |
| AN-18 | Publication du catalogue tarifaire ouverte à tout appelant : aucun contrôle de rôle sur les trois `POST /api/v1/referentiel/*`, qui pilotent le calcul de coût de tous les foyers                                                                                                                                                                                                                                                                                                                                           |   🟧    | Revue de code (audit sécurité)                          | P7 Gateway              | `7f9f599`                |   ✅   |
| AN-19 | La `Map` du rate-limit n'est jamais purgée alors que son en-tête l'affirme ; inerte tant qu'AN-15 la réduit à une clé, fuite mémoire non bornée dès qu'AN-15 est corrigé seul                                                                                                                                                                                                                                                                                                                                               |   🟨    | Revue de code (audit sécurité)                          | P9 Durcissement         | `7f9f599`                |   ✅   |
| AN-20 | `GATEWAY_TOKEN=""` est lu comme un jeton **vide valide**, alors que le garde-fou de démarrage le traite comme absent : les deux lectures divergent                                                                                                                                                                                                                                                                                                                                                                          |   🟨    | Revue de code (audit sécurité)                          | P9 Durcissement         | `7f9f599`                |   ✅   |
| AN-21 | **Aucune erreur de validation par champ n'a jamais atteint un écran.** `extraireErreurs` (front) attendait un tableau `[{champ,message}]` à la racine du corps ; la passerelle envoie `{ message: [...], error, statusCode }` — `BadRequestException([…])` **enveloppe** le tableau (`HttpException.createBody`). Les huit formulaires qui en dépendent (foyer, enfants, parents, contrat, version, établissement, profil, semaine) affichaient donc le seul message générique, et `aria-describedby` ne pointait sur rien² |   🟧    | Constat négatif de lot (lot 4 standards)                | P7 Gateway              | Lot 4 standards 2026-08  |   ✅   |

> ² AN-21 : six tests de composants et un test unitaire « couvraient » ce chemin — chacun
> fabriquait le corps d'erreur à la main, sur la forme supposée. Corrigé par le lot 4 des
> standards, qui donne à ce tableau un **nom dans le contrat** (`erreurs`, RFC 9457) et fait
> asserter la forme réelle par le test E2E API, sur le fil, en-tête compris.

> ¹ AN-13 : **clos le 2026-08-16 par le lot 1 « le coût ne ment plus », mais pas là où l'anomalie
> le disait.** Le domaine filtrait déjà chaque jour par la période (`estDansPeriode`,
> `couvreMois`) ; l'atténuation front (AN-04) et la garde `svc-tarification` restent vraies. Le
> défaut réel était l'**inverse** : `ContratCreche` exigeait une fin de validité, donc un contrat
> **sans terme** (colonne nullable) se voyait attribuer une période d'un seul jour — il cessait de
> facturer dès le mois suivant son début, sans erreur. Sous-facturation silencieuse, pas
> sur-facturation.

---

## 3. DDP par niveau de détection

Defect Detection Percentage = part des défauts **trouvés** à chaque niveau (sur 19 défauts clos
AN-01..11, AN-13, AN-14, AN-15 et AN-17..21 ; les 2 ouverts AN-12 (validation manuelle) et AN-16
(audit sécurité, non traité) sont hors calcul DDP). Pourcentages arrondis à l'unité.

| Niveau de détection        | Défauts trouvés           | DDP      |
| -------------------------- | ------------------------- | -------- |
| **Revue de code (audit)**  | AN-14, 15, 17, 18, 19, 20 | **32 %** |
| **E2E stack réelle**       | AN-01, 02, 03, 04, 05, 10 | **32 %** |
| a11y (axe-core)            | AN-07, 08                 | 11 %     |
| **Constat négatif de lot** | AN-13, AN-21              | **11 %** |
| Performance                | AN-06                     | 5 %      |
| Smoke-stack                | AN-09                     | 5 %      |
| Composant (non-régression) | AN-11                     | 5 %      |
| Unitaire domaine           | 0                         | 0 %      |

### Lecture

- **Deux filets à égalité (32 % chacun), et ils ne prennent pas les mêmes défauts.** L'E2E stack
  réelle prend des défauts **d'intégration** que l'E2E mocké ne pouvait pas révéler (confirme
  empiriquement la règle d'équipe, [doc 03](03-standards-developpement.md) §6, née de la doc 14).
  La revue de code, elle, prend ce qu'**aucun test ne peut prendre** : une garde qui fonctionne
  exactement comme écrit, mais dont le comportement par défaut est faux (AN-17 était même **tenu
  par un test** qui assertait la permissivité). Un niveau de test valide un attendu ; il ne
  questionne pas l'attendu.
- **Un troisième filet est apparu à 11 % : le constat négatif de lot** (AN-13, AN-21). Ni l'un ni
  l'autre n'était détectable par un niveau de test — parce que dans les deux cas des tests
  **verts** affirmaient le défaut. Ce niveau ne teste pas un attendu, il **vérifie l'énoncé contre
  le code** avant d'écrire la moindre ligne ; c'est le rituel `/executer-lot`, pas un outil.
- **0 défaut trouvé au niveau unitaire domaine**, et AN-13 explique pourquoi la couverture 100 % +
  MBT n'y change rien : `ContratCreche` était couvert à 100 %, mutation testing compris, par des
  tests qui lui passaient **tous** une période fermée. Le cas manquant n'était pas une branche non
  prise — c'était un cas que le **type** rendait inexprimable. Une mesure de couverture ne compte
  que ce qui peut être écrit. → Angle d'amélioration : étendre BVA/tables de décision aux DTO
  d'entrée **et aux valeurs absentes** d'un type de domaine (suivi P3-5).
- **Aucune fuite constatée en usage réel**, mais six défauts dormaient dans du code **déployé** :
  AN-14 (envoi réel actif) et AN-15/17..20 (audit sécurité). Aucun n'a été déclenché — AN-17 exige
  un second foyer, que le déploiement mono-foyer n'a jamais eu — mais la formule « pris avant mise
  en usage » ne vaut plus : ils ont été pris **après** mise en production, et par une relecture,
  pas par une porte. La **fuite inter-niveaux** (unit → intégration) reste réelle et mesurée (et
  non plus masquée par l'auto-évaluation « 0 bug »).

---

## 4. Liens

- KPI « défauts trouvés en usage réel » : [doc 21](21-politique-strategie-test.md) §1.3
- Risques associés : [doc 19](19-registre-risque-produit.md) (RT-03 régression d'intégration)
- Prose d'origine : [doc 06](06-etat-davancement.md) §13, §19.6, §19.7
- Modèle d'anomalie (champs) : [`.github/ISSUE_TEMPLATE/bug.yml`](../.github/ISSUE_TEMPLATE/bug.yml) (P2-4)
