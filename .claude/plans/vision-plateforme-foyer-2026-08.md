# Vision — plateforme du foyer (projection 2026-08)

> **Statut : note de vision (backlog PO) — pas un plan d'exécution.** Rédigée le 2026-08-11
> (session distante, branche `claude/app-future-features-ctp9yg`) à partir d'une projection PO
> sur les services futurs de l'app, confrontée à l'existant : carte des pistes de juillet
> ([`amelioration-2026-07-pistes.md`](amelioration-2026-07-pistes.md)), SFD 31/32/33
> ([doc 31](../../docs/31-sfd-calendriers-vacances-scolaires.md),
> [doc 32](../../docs/32-sfd-travail-conges-revenus.md),
> [doc 33](../../docs/33-sfd-planning-famille.md)) et plan
> [`factures-reelles.md`](factures-reelles.md). Pistes consignées : `AM-55`, `AM-56`, `AM-57`
> ([doc 34](../../docs/34-registre-ameliorations.md)).

## 1. L'élargissement de la vision

La spec fondatrice ([doc 01 §1](../../docs/01-spec-fonctionnelle.md)) annonce une « plateforme
de **budget** du foyer ». La projection PO du 2026-08-11 l'élargit : l'app vise à terme la
**plateforme du foyer** tout court — budget, temps, logistique, et à très long terme le
**logement lui-même** (§4). C'est un élargissement cohérent avec la trajectoire déjà tracée
(30 → 33 + factures-réelles), pas un pivot : le `foyer` reste le pivot de tout.

## 2. Les cinq besoins exprimés, confrontés à l'existant

| Besoin exprimé (2026-08-11)                                                            | Recouvrement avec l'existant                                                                                                                                                                       | Reste réellement nouveau                                                                                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Planification des vacances**                                                         | ~80 % couvert par la séquence existante : vacances scolaires importées (SFD 31), congés parents (SFD 32), détection « vacances sans plan de garde » = règle de conflit citée par la SFD 33         | Checklist de préparation de départ → événements libres du planning famille, mineur                                                               |
| **Préparation de la déclaration de revenus**                                           | Crédit d'impôt frais de garde déjà spécifié (plan factures-réelles) ; estimation après impôt à taux moyen déjà dans la SFD 32                                                                      | Un **récap fiscal annuel** de synthèse + échéances déclaratives en rappel (petit lot)                                                            |
| **Entretien du véhicule** (révisions, CT, pneus saison)                                | Rien — mais les briques d'accueil existent : matrice de notifications, événements libres (SFD 33), `svc-famille` topologisé (port 3007, stream `FAMILLE`)                                          | Un **échéancier du foyer** générique + le véhicule comme premier cas d'usage → `AM-55`                                                           |
| **Stocks, courses, recettes de la semaine**                                            | Rien — seul point de contact : la vue semaine du planning famille (SFD 33) est l'écran naturel des menus                                                                                           | Chantier entier (menus + liste de courses générée) → `AM-56` ; stock quantifié **exclu** (§4)                                                    |
| **Documents administratifs** (dépose, classement auto, recherche — exprimé 2026-08-11) | Couvert **hors app** : une GED auto-hébergée (Paperless) tourne déjà sur le serveur du foyer (docs 06/26) — la dépose, l'OCR, le classement automatique et la recherche sont exactement son métier | Le **rattachement aux objets métier** : facture de crèche ↔ mois facturé, bulletin de paie ↔ revenus (SFD 32), avis d'imposition ↔ RFR → `AM-57` |

Décisions de cadrage portées par cette note :

- **Pas de chantier « vacances »** : ce serait re-spécifier la séquence 31 → 33. Le besoin est
  un argument de plus pour valider et exécuter ces SFD.
- **Pas de « préparation de déclaration » complète** (toutes cases, tout le réglementaire
  fiscal) : gouffre de maintenance. Le périmètre utile est le récap annuel + les échéances.
- **La « prise de RDV » garage** est un rappel + une trace du RDV pris (événement du planning
  famille), jamais une intégration avec les agendas des garagistes (aucune API standard).
- **L'échéancier du foyer est générique** : véhicule, échéances déclaratives, et plus tard
  assurances, visites médicales… sont des instances de paramétrage, pas des branches de code
  (principe doc 30 §4).
- **Pas de GED dans l'app.** Reconstruire dépose/OCR/classement/recherche serait refaire, en
  moins bien, l'outil dédié déjà en service sur le serveur. La valeur côté app est le **lien**
  entre un document et l'objet métier qu'il justifie (le jour de factures-réelles : la facture
  consultable depuis le mois facturé) — probablement via l'API de la GED, décision à instruire
  le moment venu. Deux vigilances : la GED reste **LAN-only** alors que l'app est exposée (ne
  pas ouvrir l'une en voulant intégrer l'autre), et les documents administratifs sont les
  données les plus sensibles du foyer — le passif RGPD déjà consigné (`AM-33`/`AM-34`/`AM-36` :
  registre des traitements, effacement, rétention) devrait être soldé **avant** que l'app ne
  référence des documents.

## 3. Ordre recommandé

1. **Finir l'en-cours** — consolidation, restes de la carte de juillet (dont `AM-22` : re-trier
   la carte).
2. **SFD 31 → 32 → 33** dans l'ordre déjà recommandé par le plan factures-réelles. Blocage
   actuel : validation PO des SFD. C'est aussi la fonctionnalité « vacances ».
3. **Factures-réelles + récap fiscal annuel** — la fonctionnalité « impôts », calée sur
   l'échéance déclarative du printemps 2027 ; le plan prévoit déjà l'intercalage possible dès
   la fin du lot 1 de la SFD 32.
4. **Échéancier du foyer + entretien véhicule** (`AM-55`) — petit lot adossé à `svc-famille`,
   après le lot 1 de la SFD 32 (ne pas créer un service pour lui seul).
5. **Menus + liste de courses** (`AM-56`) — chantier séparé, cadré par sa propre SFD, lancé
   seul (deux chantiers parallèles sur `gateway.openapi.ts`/`bff.dto.ts` = conflits garantis).

Le rattachement documentaire (`AM-57`) n'est **pas** une étape autonome : il s'emboîte dans
factures-réelles (justificatifs de facture) et dans la SFD 32 (bulletins de paie, dont
l'« import automatique » est déjà au backlog v1) — au plus tôt à l'étape 3, et après le solde
du passif RGPD.

Vigilance : la séquence 30 → 33 représente déjà plusieurs mois de lots. Les ajouts ne doivent
pas la faire dérailler — ils s'y **emboîtent** (c'est leur principal mérite).

## 4. Horizon très long terme — domotique et hardware

Projection PO du 2026-08-11 : à très long terme, l'app pourrait s'étendre à la **domotique**,
ce qui impliquerait des **projets hardware liés à l'app**. Conséquences à garder en tête sans
rien construire aujourd'hui :

- **C'est l'argument qui repêchera peut-être la gestion de stock.** Un inventaire tenu à la
  main meurt en trois semaines (coût de saisie) ; il devient viable le jour où la saisie est
  **automatisée** par du matériel (balance connectée, scan code-barres, capteurs). D'ici là,
  `AM-56` exclut le stock quantifié — la porte de sortie est écrite ici.
- **Ne pas réinventer le hub domotique.** Le jour venu, la surface d'intégration raisonnable
  est un écosystème existant (type Home Assistant / MQTT, déjà auto-hébergeable sur le
  serveur du foyer) : l'app consommerait des **événements** du logement comme elle consomme
  déjà ses propres événements NATS — pas de pilotage matériel en direct dans les services
  métier.
- **Frontière de contexte** : la domotique serait un contexte à part (`context:logement` ?),
  relié par contrats comme les autres — l'architecture actuelle (frontières Nx, événements,
  contrats par contexte) n'a rien qui l'empêche, c'est bien le signe qu'il n'y a **rien à
  préparer** de plus aujourd'hui.
- **Sécurité** : le dépôt est public et le serveur n'est joignable qu'en LAN — une extension
  domotique renforcerait le besoin de garder toute la surface « maison » hors exposition
  publique. À instruire le jour où le sujet devient réel, pas avant.

Aucune piste consignée pour cet horizon : un motif à échéance indéterminée n'a pas de critère
de sortie honnête. Cette note en est la trace ; elle sera convertie en pistes le jour où le
sujet se rapproche.
