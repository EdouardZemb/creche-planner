# 37 — Registre des traitements, des tiers et des durées de conservation

> Statut : **Établi** · Version 1.2 · 2026-08-12
> Inventaire **volontaire** : quelles données personnelles vivent où, pour quoi faire,
> combien de temps, et chez quels tiers elles transitent. Établi au titre de la démarche
> décidée en [ADR-0007](adr/0007-exemption-domestique-et-demarche-volontaire.md), qui assume
> par ailleurs l'exemption domestique.

## 0. Ce que ce document est — et ce qu'il n'est pas

**Ce n'est pas un registre au sens de l'article 30 du RGPD**, et le dépôt ne revendique
aucune conformité : l'[ADR-0007](adr/0007-exemption-domestique-et-demarche-volontaire.md)
assume l'exemption domestique de l'article 2(2)(c), et énonce les seuils qui la feraient
tomber.

Le vocabulaire réglementaire — « personne concernée », « destinataire », « sous-traitant » —
est employé ici comme **grille de description**, parce qu'elle est la seule qui pose les
bonnes questions et qu'en inventer une autre n'aurait servi personne.

Ce document répond donc à trois questions d'ingénierie que le dépôt ne savait pas trancher
avant la revue d'août 2026 (`AM-33`, `AM-36`, [doc 34](34-registre-ameliorations.md)) :

1. quelles données personnelles existent, et dans quelles tables ;
2. chez quels tiers elles transitent, et lesquels voient du clair ;
3. combien de temps on entend les garder.

**Depuis le 2026-08-12, ce document outille une partie de ce qu'il énonce.** Les durées du
§3 marquées ✅ sont appliquées par du code (lot 2b) et nomment la colonne qui les porte ;
celles marquées ⛔ ne le sont pas, et le §4 dit pourquoi — deux d'entre elles ont dû être
**corrigées** plutôt qu'outillées. Ce qui reste hors de portée est écrit au §4 : l'absence y
est visible plutôt que découverte plus tard.

Une quatrième question s'y est ajoutée le même jour, avec l'export de portabilité
(lot 3) : **laquelle de ces tables sort quand la personne demande ses données** — et
laquelle n'a pas à en sortir, avec la raison. C'est le §6, et il est tenu par la porte
`pnpm portabilite`, qui dérive son attendu des `schema.ts` : une table nouvelle ne peut
plus y manquer sans que la CI le dise.

**Périmètre mesuré** : 46 tables réparties sur les 5 services persistants ; l'`api-gateway`
n'a aucune base. Les traitements ci-dessous couvrent les tables porteuses de données
personnelles ; les tables de barèmes et de référentiel (`grille_abcm`, `bareme_psu`,
`bareme_tranches`, `jour_non_facturable`, `grille_tarifaire`) n'en portent aucune et ne
figurent pas au registre.

## 1. Les traitements

### T1 — Situation du foyer et calcul du tarif

|                           |                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Calculer le coût de garde selon les barèmes PSU et ABCM, avec un historique daté des paramètres permettant le recalcul rétroactif.                                                                                                                                                             |
| **Personnes concernées**  | Les parents du foyer.                                                                                                                                                                                                                                                                          |
| **Catégories de données** | Prénom, nom, adresse e-mail (qui sert aussi d'identité de connexion), ressources mensuelles, revenu fiscal de référence, nombre de parts, nombre d'enfants à charge, et un **motif de correction en texte libre**.                                                                             |
| **Où**                    | `apps/svc-foyer/src/database/schema.ts` — tables `foyer`, `foyer_version`, `parent`, `correction_journal` (ce dernier conserve des instantanés `jsonb` avant/après). **Copies aval** dans `apps/svc-tarification/src/database/schema.ts` (`foyer`, `foyer_version`), alimentées par événement. |
| **Destinataires**         | Aucun destinataire externe. Les tiers concernés sont ceux de l'infrastructure (§2).                                                                                                                                                                                                            |
| **Conservation**          | Voir §3, ligne T1.                                                                                                                                                                                                                                                                             |

Le texte libre du motif de correction mérite d'être signalé : c'est le seul champ du
système où une donnée non prévue peut atterrir, et rien ne le contraint.

### T2 — Suivi de l'enfant et planning de garde

|                           |                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Tenir les contrats d'accueil, les rythmes hebdomadaires et les présences réelles ; en dériver les prestations facturables.                                                                                                                                                                                                                               |
| **Personnes concernées**  | Les **enfants mineurs** du foyer.                                                                                                                                                                                                                                                                                                                        |
| **Catégories de données** | Prénom, date de naissance, mode de garde, établissement d'accueil, indicateur de première inscription, semaine type, saisie mensuelle des présences et absences, et le drapeau `pai`.                                                                                                                                                                    |
| **Où**                    | `apps/svc-foyer/src/database/schema.ts` (`enfant`) ; `apps/svc-planification/src/database/schema.ts` (`contrat`, `contrat_version`, `planning_mois`, `correction_journal`). **Copies aval** dans `apps/svc-tarification/src/database/schema.ts` (`enfant`, `contrat`, `prestation_mois`) et `apps/svc-notifications/src/database/schema.ts` (`contrat`). |
| **Destinataires**         | Le prénom de l'enfant et son planning figurent dans le récapitulatif adressé à l'établissement (T4).                                                                                                                                                                                                                                                     |
| **Conservation**          | Voir §3, ligne T2.                                                                                                                                                                                                                                                                                                                                       |

**Le drapeau `pai`** (projet d'accueil individualisé) est qualifié **donnée de facturation**
et non donnée de santé : le code ne stocke ni diagnostic, ni document, ni commentaire — il
n'exprime qu'une part de garde facturée seule
(`libs/planification/domain/src/lib/inscription-abcm.ts`). Il est néanmoins inscrit ici parce
qu'il constitue un **indice indirect** d'une situation de santé, et à ce titre son accès
suit celui du foyer, sans exposition supplémentaire. Cette qualification est une décision
datée, pas un constat : elle est rouverte si le champ venait à porter un motif ou une pièce
jointe ([ADR-0007](adr/0007-exemption-domestique-et-demarche-volontaire.md), § Révision).

### T3 — Rappel hebdomadaire et validation par le parent

|                           |                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Rappeler au parent de valider les besoins de la semaine, tracer son consentement et son éventuelle opposition, et prouver ce qui lui a réellement été adressé.                                                                                                             |
| **Personnes concernées**  | Les parents du foyer.                                                                                                                                                                                                                                                      |
| **Catégories de données** | Adresse e-mail, préférences par type de notification et par canal, horodatages de consentement et de désabonnement, jetons de désabonnement nominatifs, sujets et **corps de messages rendus, figés**, listes de destinataires figées, statuts de remise SMTP.             |
| **Où**                    | `apps/svc-foyer/src/database/schema.ts` (`preference_notification`, `desabonnement_token`) ; `apps/svc-notifications/src/database/schema.ts` (`foyer_parent`, `preference_notification`, `notification_hebdo`, `envoi_recap_hebdo`, `envoi_recap_parent`, `notification`). |
| **Destinataires**         | **Google (Gmail SMTP)** pour l'acheminement — voir §2.                                                                                                                                                                                                                     |
| **Conservation**          | Voir §3, lignes T3 et T4.                                                                                                                                                                                                                                                  |

Le droit d'opposition est le seul droit outillé du système
([ADR-0006](adr/0006-preferences-notification-et-desabonnement.md)) : désabonnement en un
clic depuis le message, et préférences par canal dans « Mon profil ».

### T4 — Transmission du récapitulatif à l'établissement d'accueil

|                           |                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Adresser au service d'accueil la semaine validée par la famille.                                                                                                                                                                |
| **Personnes concernées**  | L'**agent de l'établissement** destinataire, et les enfants dont le planning figure dans le message.                                                                                                                            |
| **Catégories de données** | Nom de l'établissement, e-mail de service, adresse postale, téléphone, personne contact ; corps HTML rendu et figé, contenant prénoms et planning.                                                                              |
| **Où**                    | `apps/svc-planification/src/database/schema.ts` (`etablissement`) ; `apps/svc-notifications/src/database/schema.ts` (`etablissement`, `envoi_etablissement`). Seuls le nom et l'e-mail voyagent dans l'événement d'intégration. |
| **Destinataires**         | L'établissement lui-même, via **Google (Gmail SMTP)**.                                                                                                                                                                          |
| **Conservation**          | Voir §3, ligne T3.                                                                                                                                                                                                              |

**Particularité de ce traitement** : la collecte est **indirecte**. L'agent de
l'établissement ne saisit rien, n'ouvre jamais l'application, et n'était informé de rien
avant la mise en place du pied de message et de la page de mentions livrés avec ce document.
C'est le seul traitement du système qui vise une personne extérieure au foyer, et c'est ce
qui met l'exemption domestique en tension
([ADR-0007](adr/0007-exemption-domestique-et-demarche-volontaire.md), § Risque résiduel).

### T5 — Exploitation : journaux, traces et métriques

|                           |                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Diagnostiquer les incidents et suivre la santé du système.                                                                                                                        |
| **Personnes concernées**  | Parents et agents d'établissement.                                                                                                                                                |
| **Catégories de données** | Adresses e-mail **en clair** et identifiants de foyer, dans les journaux des gardes d'autorisation et d'identité de la passerelle. Aucune rédaction n'est appliquée à l'émission. |
| **Où**                    | Journaux applicatifs des 6 services, agrégés par Loki.                                                                                                                            |
| **Conservation**          | Politique **déjà écrite et déjà appliquée** — voir le renvoi ci-dessous.                                                                                                          |

La politique des signaux d'exploitation (inventaire des données personnelles par signal,
durées par magasin, accès, procédure de purge sur demande) vit dans
[`exploitation/observabilite.md`](exploitation/observabilite.md) depuis le 2026-07-02.
Elle n'est **pas recopiée ici** : la [doc 35](35-politique-documentation.md) proscrit le fait
dupliqué, qui dérive de sa source. Ce registre s'y réfère et n'en est pas la source.

### T6 — Sauvegarde et reprise d'activité

|                           |                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Restaurer le service et les données après incident.                                                                                                      |
| **Personnes concernées**  | Toutes celles des traitements T1 à T5.                                                                                                                   |
| **Catégories de données** | L'intégralité des 5 bases.                                                                                                                               |
| **Où**                    | Jeux de dumps horodatés sur le serveur, et copie hors-site.                                                                                              |
| **Destinataire**          | **Google Drive**, qui ne reçoit qu'une **archive chiffrée** (`age`) : le chiffrement précède l'envoi, la clé ne quitte pas le serveur.                   |
| **Conservation**          | 30 jours en local, 90 jours hors-site — valeurs **déjà en vigueur**, portées par `scripts/systemd/creche-backup.service` et `scripts/backup-offsite.sh`. |

Les objectifs de reprise (RPO, RTO) et les écarts connus sont écrits dans
[`exploitation/sauvegardes.md`](exploitation/sauvegardes.md), qui est leur source.

### T7 — Files techniques : outbox, événements consommés, rebuts

|                           |                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Garantir la livraison au moins une fois des événements d'intégration, l'idempotence de leur consommation, et conserver les messages non traitables pour analyse.                        |
| **Personnes concernées**  | Celles des traitements T1 à T4 — **indirectement**.                                                                                                                                     |
| **Catégories de données** | Les payloads d'événements portent des e-mails, des prénoms et des revenus. Ce ne sont pas des traitements autonomes : ce sont des **lieux de conservation supplémentaires** de T1 à T4. |
| **Où**                    | `outbox` dans les 5 services, `processed_event` dans 4, `dead_letter` dans 4.                                                                                                           |
| **Conservation**          | Voir §3, ligne T7 — **aucune n'est appliquée aujourd'hui** : rien n'est jamais purgé.                                                                                                   |

### T8 — Authentification au bord

|                           |                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Contrôler l'accès à l'application avant qu'une requête n'atteigne le service.                                                |
| **Personnes concernées**  | Les personnes autorisées à ouvrir l'application.                                                                             |
| **Catégories de données** | Adresses e-mail des personnes autorisées, journaux d'authentification.                                                       |
| **Où**                    | **Hors dépôt** : console Cloudflare Zero Trust. Le contenu exact est auto-déclaratif et n'est pas vérifiable depuis le code. |
| **Conservation**          | Régie par le tiers ; non maîtrisée ici.                                                                                      |

## 2. Les tiers

Huit tiers reçoivent, hébergent ou voient transiter des données. **Ils sont classés par
exposition réelle, pas par notoriété** — c'est l'enseignement principal de l'inventaire :
le tiers le plus exposé n'est pas celui qu'on citait spontanément.

| Tiers                          | Rôle                                                                     | Ce qu'il voit                                                                                                                                                                                                   | Actif ?                                                   |
| ------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Cloudflare**                 | Tunnel d'accès et authentification au bord                               | **Le plus exposé** : la terminaison TLS a lieu chez lui, donc **tout le trafic applicatif en clair** au niveau du proxy — e-mails, prénoms, revenus, plannings. Détient en outre les identités autorisées (T8). | Oui                                                       |
| **Google (Gmail SMTP)**        | Acheminement des courriels sortants                                      | Corps complets des messages : prénoms d'enfants, plannings, adresses des parents et des établissements.                                                                                                         | Oui — envoi réel actif en production                      |
| **Google Drive**               | Dépôt hors-site des sauvegardes                                          | **Rien en clair** : l'archive est chiffrée par `age` avant l'envoi. Exposition limitée aux métadonnées (taille, horodatage, nom de fichier).                                                                    | Opt-in ; inactif tant que `OFFSITE_REMOTE` n'est pas posé |
| **GitHub**                     | Code, intégration continue, registre d'images (GHCR), API de déploiement | Aucune donnée personnelle **de production**. Voit le code, les secrets chiffrés et les journaux de construction.                                                                                                | Oui                                                       |
| **Sigstore / Rekor**           | Signature et transparence des images                                     | Aucune donnée personnelle. À signaler tout de même : le journal de transparence est **public et immuable** — ce qui y est inscrit ne peut pas être retiré.                                                      | Oui                                                       |
| **Healthchecks.io**            | Témoin de vie externe (dead man's switch)                                | Uniquement un signal de vie, sans contenu. L'URL de ping est un secret.                                                                                                                                         | Oui                                                       |
| **Registres d'images publics** | Images de base en flux entrant                                           | Rien : flux entrant seulement.                                                                                                                                                                                  | Oui                                                       |
| **Hébergement**                | Serveur applicatif et bases                                              | Tout — mais il est **auto-hébergé** : aucune donnée n'est confiée à un hébergeur tiers.                                                                                                                         | Oui                                                       |

Deux conséquences valent d'être tirées :

- **Aucun transfert hors Union européenne n'est maîtrisé** dans un sens utile : Cloudflare
  et Google opèrent des infrastructures mondiales, et le dépôt ne configure aucune
  localisation. C'est un fait, pas une conformité.
- **Le chiffrement avant envoi change la nature du tiers.** Google Drive héberge des données
  qu'il ne peut pas lire ; Cloudflare lit tout. Un inventaire qui les mettrait sur le même
  plan se tromperait de risque.

## 3. Durées de conservation

**Décision du propriétaire du produit, 2026-08-11**, révisée le **2026-08-12** à l'exécution
du lot 2b. Cette révision n'est pas cosmétique : confrontées au code, **deux des huit lignes
d'origine se sont révélées inapplicables** — non par difficulté, mais parce qu'elles
désignaient un point de départ que la base ne porte pas. Les transcrire littéralement en SQL
aurait produit deux régressions silencieuses, l'une financière, l'autre réglementaire. Elles
sont corrigées ici plutôt qu'outillées ; le détail est au §4.

À ne pas confondre avec l'**effacement à la demande**, livré au 2026-08-12 (lot 2a) :
supprimer un foyer efface immédiatement toutes les données de ce foyer, dans les cinq bases,
sans attendre aucune échéance. Ce sont deux mécanismes distincts — l'un est un droit exercé,
l'autre une hygiène de rétention.

**Chaque ligne outillée nomme son ancre** : la table et la colonne qui portent réellement la
borne, dans tous les services qui déclarent cette table. La porte `pnpm retentions` refuse
une ancre absente des `schema.ts` — c'est elle qui aurait attrapé les deux lignes fausses
avant qu'on tente de les écrire. Une durée qui ne nomme pas sa colonne est une intention, pas
une politique.

| Réf.  | Données                                                            | Durée                                                                 | Ancre outillée                                                   | État | Pourquoi                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------- | :--: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1    | Ressources, RFR, historique versionné du foyer                     | **3 ans**                                                             | —                                                                |  ⛔  | Écartée §4 : la **fin** d'une version n'existe pas en base, elle est dérivée à la lecture et la dernière reste ouverte. Une borne sur la date d'effet emporterait la version **en vigueur** d'un foyer inactif, et l'aval facturerait faux **sans lever d'erreur** (`AM-55`).    |
| T1bis | Journal de corrections (`correction_journal`)                      | **3 ans**                                                             | —                                                                |  ⛔  | Écartée §4 : la table ne porte **aucune** date d'effet, seulement sa date de correction. La borner dessus appliquerait une règle que le PO n'a pas validée. Table sans lecteur, donc sans risque : c'est le point de départ qui manque, pas la sûreté (`AM-60`).                 |
| T2    | Enfants, contrats, plannings, prestations                          | **3 ans**                                                             | —                                                                |  ⛔  | Écartée §4 : « fin du dernier contrat » n'est calculable dans aucune base — `valide_au` nul **vaut période ouverte**, `enfant_id` est nullable, et la copie aval n'a pas la colonne. Le critère est inexprimable, pas seulement coûteux (`AM-56`).                               |
| T3    | Journal d'envoi du récapitulatif au foyer, par foyer et par parent | **13 mois**                                                           | `envoi_recap_hebdo.cree_le` + `envoi_recap_parent.cree_le`       |  ✅  | Prouver ce qui a été adressé ne sert que tant que l'envoi peut être contesté : une année scolaire pleine, plus la rentrée suivante. Ancré sur la **création**, pas sur l'envoi — sinon les lignes jamais abouties, les plus riches en adresses figées, resteraient indéfiniment. |
| T3bis | Récapitulatif adressé à un établissement (`envoi_etablissement`)   | **13 mois**                                                           | `envoi_etablissement.created_at`                                 |  ✅  | **Anonymisée en place, pas supprimée** : la ligne est le seul verrou anti-double-envoi vers une vraie crèche, et l'endpoint d'envoi n'est borné par aucune date (`AM-58`). Le contenu personnel part, la ligne-témoin reste.                                                     |
| T3ter | Préférences de notification (`preference_notification`)            | **Aucune borne**                                                      | —                                                                |  ⛔  | Écartée §4, et c'est une **correction de fond** : l'absence d'une ligne **vaut consentement**. Purger une ligne « désabonné » réabonnerait le parent, soit exactement la population que la durée visait (`AM-57`).                                                               |
| T3qua | Jetons de désabonnement (`desabonnement_token`)                    | **3 ans**                                                             | `desabonnement_token.utilise_le` + `desabonnement_token.emis_le` |  ✅  | Preuve de l'**exercice d'un droit** ([ADR-0006](adr/0006-preferences-notification-et-desabonnement.md)), et la seule qui survive : `desabonne_at` est remise à nul dès que le parent se réabonne. Ancrée sur la dernière des deux dates.                                         |
| T4    | Boîte de réception in-app (`notification`)                         | **12 mois**                                                           | `notification.cree_le`                                           |  ✅  | Journal en ajout seul : ses lecteurs ne portent aucune action, et ses liens profonds deviennent caducs dès la saison suivante.                                                                                                                                                   |
| T4bis | État de validation hebdomadaire (`notification_hebdo`)             | **Aucune borne**                                                      | —                                                                |  ⛔  | Écartée §4 : rangée à tort avec `notification` en v1.0. Ce n'est pas un journal mais la **machine à états** de la validation — l'absence d'une ligne y vaut « semaine jamais notifiée », et la purger effacerait une action en attente sans laisser de trace (`AM-59`).          |
| T7    | `outbox`                                                           | **30 jours**                                                          | `outbox.published_at`                                            |  ✅  | La ligne n'a plus d'usage une fois publiée. Ancrée sur la publication et **jamais** sur l'occurrence : une ligne non publiée est un événement **en vol**, quel que soit son âge.                                                                                                 |
| T7    | `dead_letter`                                                      | **90 jours**                                                          | `dead_letter.created_at`                                         |  ✅  | Un rebut non traité en trois mois ne le sera pas. Meilleur rendement du lot : le payload y est conservé en clair (`AM-53`).                                                                                                                                                      |
| T7    | `processed_event`                                                  | **Non chiffrée**                                                      | —                                                                |  ⛔  | Écartée §4 : garde-fou anti-rejeu. Sa borne dépend d'une rétention JetStream qui n'est toujours pas posée ; la chiffrer à l'aveugle rouvrirait le rejeu intégral.                                                                                                                |
| T5    | Journaux, traces, métriques                                        | Voir [`exploitation/observabilite.md`](exploitation/observabilite.md) | —                                                                |  ✅  | Politique déjà en vigueur, non redéfinie ici.                                                                                                                                                                                                                                    |
| T6    | Sauvegardes                                                        | 30 j local, 90 j hors-site                                            | —                                                                |  ✅  | Déjà en vigueur, portée par les scripts d'exploitation.                                                                                                                                                                                                                          |

**Effet de bord à connaître** : une purge de T1 ou T2, le jour où elle deviendra possible, ne
suffira pas. Les mêmes données existent en **copies aval** dans `svc-tarification` et
`svc-notifications`. L'effacement devra voyager en **événement d'intégration**, jamais en
suppression locale — c'est déjà ce que fait l'effacement à la demande du lot 2a.

## 4. Ce que ce registre ne couvre pas

Écrit ici pour que l'absence soit visible plutôt que découverte plus tard :

- **Les purges liées au temps existent depuis le lot 2b** (2026-08-12) pour les lignes ✅ du
  §3 : un balayage horaire, horloge injectée, dans les cinq services. Mais **quatre durées du
  §3 restent volontairement non outillées**, et deux d'entre elles ont été **corrigées** parce
  que le code les rend fausses :
  - **T1 — historique versionné (`foyer_version`)**. La fin d'une version n'est pas stockée :
    elle est dérivée à la lecture, et la dernière reste ouverte. La version **en vigueur**
    d'un foyer inactif depuis trois ans porte donc une date d'effet vieille de trois ans, et
    tombe sous la borne. Le plus grave n'est pas la perte : c'est que rien ne le signale — le
    calcul de coût se rabat silencieusement sur les ressources d'aujourd'hui pour tous les
    mois passés, et affiche un montant faux et plausible. Réouverture conditionnée à une fin
    de version matérialisée, ou à un prédicat dérivé de la version suivante (`AM-55`).
  - **T2 — enfants, contrats, plannings**. « Fin du dernier contrat de l'enfant » n'est
    calculable dans aucune base : `valide_au` nul **signifie période ouverte** (donc un
    `COALESCE` naïf purgerait un contrat actif), `enfant_id` est encore nullable sur les
    contrats historiques — précisément les plus anciens, ceux que la durée visait — et la
    copie de `svc-tarification` n'a pas de colonne `valide_au` du tout (`AM-56`).
  - **T3ter — préférences de notification**. Correction de fond : **l'absence d'une ligne vaut
    consentement**. Purger une préférence `actif = false` réabonne le parent, c'est-à-dire
    exactement celui qui s'était désabonné et n'a plus rien touché depuis. Une purge présentée
    comme de l'hygiène produirait un envoi non consenti (`AM-57`).
  - **T4bis — `notification_hebdo`**. La v1.0 la rangeait avec la boîte de réception, au motif
    que « le code la qualifie de journal en ajout seul ». Le code ne dit cela que de
    `notification` : `notification_hebdo` est la machine à états de la validation. Une semaine
    `A_VALIDER` n'est fermée par aucun balayage, et l'écran les liste sans borne de date : la
    purger ferait disparaître une action en attente, indiscernable d'une semaine validée
    (`AM-59`).
- **L'effacement à la demande, lui, est livré** (lot 2a, 2026-08-12). `DELETE /api/v1/foyers/:id`
  supprime la ligne `foyer` — la cascade SQL emporte versions de ressources, journal de
  corrections, enfants, parents, préférences et jetons — puis l'événement
  `foyer.FoyerSupprime.v1` fait effacer leurs copies à `svc-tarification`,
  `svc-notifications` et `svc-planification`. Cela **inclut les parents retirés**
  (soft-delete `actif = false`), dont le nom et l'e-mail survivaient jusqu'ici à leur départ.
- **Deux tables techniques survivent délibérément à cet effacement**, et il faut le savoir :
  - `outbox` — file de publication **vivante**. Y supprimer une ligne non publiée annulerait
    un événement en vol (l'événement d'effacement lui-même y transite). Sa borne est
    temporelle : 30 j après publication, lot 2b.
  - `processed_event` — garde-fou anti-rejeu. L'effacer rouvrirait la re-projection du foyer
    à la prochaine re-livraison JetStream, soit exactement le résidu qu'on prétend supprimer.
    Sa borne dépend d'une rétention JetStream qui n'est toujours pas posée (cf. §3).

  `outbox`, elle, est désormais **bornée dans le temps** (30 j) — mais uniquement sur
  `published_at` non nul. Une ligne non publiée survit quel que soit son âge : c'est un
  événement en vol, et le premier d'entre eux serait l'effacement lui-même.

  `dead_letter`, en revanche, **est** purgée pour le foyer effacé : c'est un magasin terminal
  que plus rien ne relit, et il stockait jusqu'ici des payloads en clair — tout événement du
  stream `FOYER` non consommé par un service y atterrit avec son contenu.

- ~~Aucun export des données personnelles~~ — **livré le 2026-08-12 (lot 3)** : voir le §6,
  qui dit table par table ce qui sort et ce qui reste. Ce qui demeure hors de portée est
  ce qui vit hors base (journaux, sauvegardes, Cloudflare).
- **Aucune rédaction des données personnelles dans les journaux** : les adresses e-mail
  partent en clair dans les journaux des gardes d'autorisation.
- **Le contenu de T8 n'est pas vérifiable** depuis le dépôt.

## 5. Informer les personnes

Deux canaux, parce qu'un seul ne suffisait pas :

- **Page « Informations sur vos données »**, accessible sans authentification depuis le pied
  de page de l'application ;
- **Pied de message** sur les courriels sortants — récapitulatif au parent et récapitulatif
  à l'établissement. C'est le **seul** canal qui atteigne l'agent d'établissement, qui
  n'ouvre jamais l'application (T4).

Le texte de la page reste volontairement court et renvoie ici. Si l'un des deux change, il
faut changer l'autre : **aucune porte de la CI ne garantit cette cohérence** — c'est une
limite connue, pas un oubli.

## 6. Ce que l'export de portabilité rend, table par table

**Livré le 2026-08-12 (lot 3, `AM-35`).** `GET /api/v1/foyers/{id}/export` rassemble en un
document JSON tout ce que les trois services **sources** détiennent sur un foyer, et le
parent le télécharge depuis « Ma famille ».

Le principe qui découpe ce tableau tient en une phrase : **ce qu'un effacement emporte, un
export doit le rendre.** Le périmètre est donc celui de la cascade du lot 2a, à trois
exclusions près, toutes visibles ci-dessous plutôt que découvertes plus tard.

Le classement n'est pas déclaratif : la porte `pnpm portabilite` **dérive la liste attendue
des `schema.ts`** des cinq services. Une table nouvelle sans ligne ici fait échouer la CI ;
une table dite `exportée` que le code d'export ne lit pas aussi ; une `copie` dont la source
n'est exportée par personne aussi. Ce que la porte ne sait pas juger — le classement
lui-même, et les colonnes retenues — est écrit en toutes lettres dans la colonne « Pourquoi ».

Les quatre classes :

- **`exportée`** — les lignes de cette table, pour ce foyer, sortent dans le document ;
- **`copie`** — read-model projeté d'une autre table, elle-même exportée ; l'exporter
  livrerait deux fois la même donnée, et la copie est souvent **appauvrie** (la projection
  ne transporte pas toutes les colonnes) ;
- **`technique`** — file ou garde-fou d'infrastructure ; ces tables portent parfois des
  données personnelles en clair (`outbox`, `dead_letter`), et c'est précisément pourquoi
  elles sont **bornées au temps** (§3, T7) plutôt qu'exportées : ce sont des artefacts de
  livraison, pas le dossier de la personne ;
- **`hors périmètre`** — barèmes, grilles et calendriers, sans aucune donnée personnelle.

| Service             | Table                     | Classe         | Pourquoi                                                                                                                             |
| ------------------- | ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `svc-foyer`         | `foyer`                   | exportée       | Situation financière courante.                                                                                                       |
| `svc-foyer`         | `foyer_version`           | exportée       | Historique daté des ressources — la version en vigueur comme les précédentes.                                                        |
| `svc-foyer`         | `correction_journal`      | exportée       | Instantanés avant/après des corrections rétroactives de ressources.                                                                  |
| `svc-foyer`         | `bareme_tranches`         | hors périmètre | Read-model de barème projeté du référentiel ; aucune donnée personnelle.                                                             |
| `svc-foyer`         | `enfant`                  | exportée       | Prénom et date de naissance.                                                                                                         |
| `svc-foyer`         | `parent`                  | exportée       | Nom, prénom, e-mail, rôle — **parents retirés compris** : leur identité survit au retrait, l'effacement l'emporte, l'export la rend. |
| `svc-foyer`         | `preference_notification` | exportée       | Exportée **effective** (défaut applicatif fusionné) : ici l'absence de ligne vaut consentement, les lignes brutes mentiraient.       |
| `svc-foyer`         | `desabonnement_token`     | exportée       | Trace de l'exercice du droit d'opposition — **sans le `jti`**, qui est une capacité agissant sans authentification, pas une donnée.  |
| `svc-foyer`         | `outbox`                  | technique      | File de publication vivante ; bornée au temps (§3, T7).                                                                              |
| `svc-foyer`         | `processed_event`         | technique      | Garde-fou anti-rejeu ; ne porte aucune donnée personnelle.                                                                           |
| `svc-foyer`         | `dead_letter`             | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                |
| `svc-notifications` | `contrat`                 | copie          | Projection de `svc-planification.contrat`.                                                                                           |
| `svc-notifications` | `etablissement`           | copie          | Projection **appauvrie** de `svc-planification.etablissement` (ni adresse, ni téléphone, ni contact).                                |
| `svc-notifications` | `foyer_parent`            | copie          | Projection **appauvrie** de `svc-foyer.parent` (ni prénom ni nom) ; sert ici à résoudre les parents du foyer.                        |
| `svc-notifications` | `preference_notification` | copie          | Projection **appauvrie** de `svc-foyer.preference_notification` (sans les horodatages de consentement).                              |
| `svc-notifications` | `notification_hebdo`      | exportée       | Machine à états de la validation : semaine soumise, instantané figé, écarts saisis. Aucune re-projection ne la recréerait.           |
| `svc-notifications` | `envoi_etablissement`     | exportée       | Preuve de ce qui est réellement parti vers l'établissement, corps HTML figé compris.                                                 |
| `svc-notifications` | `envoi_recap_hebdo`       | exportée       | Preuve d'envoi du récapitulatif au foyer, avec la liste figée des destinataires.                                                     |
| `svc-notifications` | `envoi_recap_parent`      | exportée       | Remise à chaque parent, avec l'adresse figée au moment de l'envoi.                                                                   |
| `svc-notifications` | `notification`            | exportée       | Boîte de réception in-app : sujets et corps rendus, tels que le parent les a lus.                                                    |
| `svc-notifications` | `processed_event`         | technique      | Garde-fou anti-rejeu.                                                                                                                |
| `svc-notifications` | `outbox`                  | technique      | File de publication ; bornée au temps (§3, T7).                                                                                      |
| `svc-notifications` | `dead_letter`             | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                |
| `svc-planification` | `contrat`                 | exportée       | Contrat d'accueil : mode, établissement, période, semaine type.                                                                      |
| `svc-planification` | `contrat_version`         | exportée       | Avenants datés du contrat.                                                                                                           |
| `svc-planification` | `correction_journal`      | exportée       | Instantanés avant/après des corrections d'avenant.                                                                                   |
| `svc-planification` | `planning_mois`           | exportée       | Saisie mensuelle des présences et absences, **simulations comprises** — ce sont des saisies du parent, pas des dérivées du système.  |
| `svc-planification` | `etablissement`           | exportée       | Seul endroit où vivent l'adresse, le téléphone et la personne contact : ils ne voyagent dans aucun événement.                        |
| `svc-planification` | `processed_event`         | technique      | Garde-fou anti-rejeu.                                                                                                                |
| `svc-planification` | `outbox`                  | technique      | File de publication ; bornée au temps (§3, T7).                                                                                      |
| `svc-planification` | `dead_letter`             | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                |
| `svc-referentiel`   | `grille_abcm`             | hors périmètre | Barème public ; aucune donnée personnelle.                                                                                           |
| `svc-referentiel`   | `bareme_psu`              | hors périmètre | Barème public ; aucune donnée personnelle.                                                                                           |
| `svc-referentiel`   | `bareme_tranches`         | hors périmètre | Seuils de tranche ; aucune donnée personnelle.                                                                                       |
| `svc-referentiel`   | `jour_non_facturable`     | hors périmètre | Calendrier de fermeture ; aucune donnée personnelle.                                                                                 |
| `svc-referentiel`   | `outbox`                  | technique      | File de publication.                                                                                                                 |
| `svc-tarification`  | `foyer`                   | copie          | Projection de `svc-foyer.foyer`, enrichie de la tranche dérivée à l'écriture.                                                        |
| `svc-tarification`  | `foyer_version`           | copie          | Projection de `svc-foyer.foyer_version` (sans `saisi_le` ni motif).                                                                  |
| `svc-tarification`  | `enfant`                  | copie          | Projection de `svc-foyer.enfant`, écrite mais jamais relue par le calcul.                                                            |
| `svc-tarification`  | `grille_tarifaire`        | hors périmètre | Barème ; aucune donnée personnelle.                                                                                                  |
| `svc-tarification`  | `bareme_psu`              | hors périmètre | Barème ; aucune donnée personnelle.                                                                                                  |
| `svc-tarification`  | `prestation_mois`         | copie          | Quantités **dérivées** de `svc-planification.planning_mois` : un calcul, pas une saisie.                                             |
| `svc-tarification`  | `contrat`                 | copie          | Projection **appauvrie** de `svc-planification.contrat`.                                                                             |
| `svc-tarification`  | `processed_event`         | technique      | Garde-fou anti-rejeu.                                                                                                                |
| `svc-tarification`  | `outbox`                  | technique      | File de publication ; bornée au temps (§3, T7).                                                                                      |
| `svc-tarification`  | `dead_letter`             | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                |

### Les trois exclusions, et pourquoi elles ne sont pas des oublis

1. **Les copies aval ne sortent pas.** `svc-tarification` ne détient que des projections
   des tables ci-dessus, et `svc-notifications` en porte quatre. Les inclure ferait passer
   pour une donnée de plus ce qui n'est qu'un second exemplaire de la même — souvent moins
   complet que l'original. La règle vaut dans un seul sens : là où la copie porte **moins**
   que sa source (`svc-planification.etablissement` et ses coordonnées, absentes du
   read-model aval), c'est la **source** qui est exportée.
2. **Le `jti` d'un jeton de désabonnement ne sort pas.** Ce jeton désabonne sans
   authentification : recopié dans un fichier téléchargé, conservé, transféré, il resterait
   actionnable par quiconque le lit. Le type, le canal et les dates suffisent à la
   finalité ; le secret, non.
3. **Les files techniques ne sortent pas.** `outbox` et `dead_letter` portent des payloads
   d'événements en clair — donc, indirectement, des données déjà exportées par ailleurs.
   Ce sont des artefacts de livraison, dont la réponse est une **borne temporelle** (§3,
   T7), pas une ligne d'export.

### Ce qui reste hors de portée

L'export ne rend que ce qui vit **en base**. Les journaux d'exploitation (T5), les
sauvegardes (T6) et les identités détenues par Cloudflare Access (T8) n'y figurent pas :
aucun de ces trois n'est atteignable depuis le code applicatif. C'est la même frontière que
celle de l'effacement, pour la même raison.
