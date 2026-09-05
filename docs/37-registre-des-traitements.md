# 37 — Registre des traitements, des tiers et des durées de conservation

> Statut : **Établi** · Version 1.4 · 2026-08-14
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

Une cinquième le 2026-08-14, avec la piste d'audit acteur (lot 6, `AM-45`) : **quelles
mutations laissent une trace de qui les a faites** — et lesquelles n'en laissent pas,
avec la raison. C'est le §7, tenu par la porte `pnpm acteur`, dont l'attendu est dérivé
des contrôleurs : une route de mutation nouvelle ne peut pas y manquer.

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

|                           |                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Finalité**              | Garantir la livraison au moins une fois des événements d'intégration, l'idempotence de leur consommation, et conserver les messages non traitables pour analyse.                                                                                                                                                   |
| **Personnes concernées**  | Celles des traitements T1 à T4 — **indirectement**.                                                                                                                                                                                                                                                                |
| **Catégories de données** | Les payloads d'événements portent des e-mails, des prénoms et des revenus. Ce ne sont pas des traitements autonomes : ce sont des **lieux de conservation supplémentaires** de T1 à T4.                                                                                                                            |
| **Où**                    | `outbox` dans les 5 services, `processed_event` dans 4, `dead_letter` dans 4.                                                                                                                                                                                                                                      |
| **Conservation**          | Voir §3, ligne T7 : `outbox` **30 j** après publication et `dead_letter` **90 j**, appliquées depuis le lot 2b des standards (`PurgeModule`, `tachePurgeOutbox`/`tachePurgeDeadLetter`) ; `processed_event` reste non bornée (⛔, garde-fou anti-rejeu).                                                           |
| **Minimisation**          | Depuis `AM-53`, un consommateur durable ne reçoit que les types que sa projection traite (`filter_subjects`) : un événement qui ne concerne pas un service n'en laisse plus **aucune copie**. `dead_letter` cesse d'être un lieu de conservation de routine — la borne de 90 j ne couvre plus qu'un incident réel. |

### T8 — Authentification au bord

|                           |                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Contrôler l'accès à l'application avant qu'une requête n'atteigne le service.                                                |
| **Personnes concernées**  | Les personnes autorisées à ouvrir l'application.                                                                             |
| **Catégories de données** | Adresses e-mail des personnes autorisées, journaux d'authentification.                                                       |
| **Où**                    | **Hors dépôt** : console Cloudflare Zero Trust. Le contenu exact est auto-déclaratif et n'est pas vérifiable depuis le code. |
| **Conservation**          | Régie par le tiers ; non maîtrisée ici.                                                                                      |

### T9 — Piste d'audit des modifications du dossier

|                           |                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finalité**              | Savoir **qui** a modifié quoi dans le dossier du foyer — ressources, enfants, parents, préférences —, et pouvoir le montrer à la personne concernée (OWASP ASVS V7 ; `AM-45`).                                                                                                                                             |
| **Personnes concernées**  | Les parents du foyer, dans les deux rôles : comme **auteurs** de l'action (leur e-mail est l'acteur) et comme **sujets** de la donnée modifiée.                                                                                                                                                                            |
| **Catégories de données** | Adresse e-mail de l'auteur, **avec sa nature** — `parent`, `admin` (un e-mail de `ADMIN_EMAILS`, qui contourne l'appartenance au foyer), `service` (appel machine) ou `inconnu` (aucune assertion valide) —, nature de l'action, identifiant de la ressource visée, horodatage. **Aucune valeur métier n'y est recopiée.** |
| **Où**                    | `apps/svc-foyer/src/database/schema.ts` — table `journal_audit`, rattachée au foyer (`ON DELETE CASCADE`).                                                                                                                                                                                                                 |
| **Destinataires**         | Aucun destinataire externe. La personne y accède par son propre export de portabilité (§6).                                                                                                                                                                                                                                |
| **Conservation**          | **3 ans**, ancrés sur `journal_audit.cree_le` — voir §3, ligne T9. Durée décidée par le PO le 2026-08-14, en arbitrage par défaut.                                                                                                                                                                                         |

Deux limites valent d'être écrites plutôt que découvertes :

1. **L'effacement du foyer ne laisse aucune ligne ici**, et ne le peut pas : la table part
   en cascade avec le foyer. Cette action-là n'a que le journal applicatif (T5). C'est la
   seule du service dans ce cas, et le §7 la nomme.
2. **La piste ne couvre que `svc-foyer`.** Les contrats, avenants, plannings et
   établissements (`svc-planification`) et les envois (`svc-notifications`) mutent sans
   trace d'acteur. Ce n'est pas un oubli mais une file : le §7 liste ces routes une par
   une, chacune rattachée à une piste ouverte du [registre](34-registre-ameliorations.md).

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

**Complétée le 2026-08-14** par la ligne **T9** (piste d'audit acteur), écrite au lot 6 et
**confirmée telle quelle par le PO** le jour même. Elle est le premier **arbitrage par
défaut** assumé de ce tableau : aucune obligation opposable ne fixe cette durée, et le
produit n'a pas d'usage établi de la piste au-delà. Trois ans est retenu par **alignement**
sur les deux autres traces du même dossier (T1, T1bis) — un repère interne, pas une règle
externe. Ce que cela engage : si l'une de ces deux lignes change de durée, T9 se rediscute
au lieu de suivre par inertie.

À ne pas confondre avec l'**effacement à la demande**, livré au 2026-08-12 (lot 2a) :
supprimer un foyer efface immédiatement toutes les données de ce foyer, dans les cinq bases,
sans attendre aucune échéance. Ce sont deux mécanismes distincts — l'un est un droit exercé,
l'autre une hygiène de rétention.

**Chaque ligne outillée nomme son ancre** : la table et la colonne qui portent réellement la
borne, dans tous les services qui déclarent cette table. La porte `pnpm retentions` refuse
une ancre absente des `schema.ts` — c'est elle qui aurait attrapé les deux lignes fausses
avant qu'on tente de les écrire. Une durée qui ne nomme pas sa colonne est une intention, pas
une politique.

| Réf.  | Données                                                            | Durée                                                                 | Ancre outillée                                                   | État | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------- | :--: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1    | Ressources, RFR, historique versionné du foyer                     | **3 ans**                                                             | —                                                                |  ⛔  | Écartée §4, **pour une raison qui a changé le 2026-08-16**. Les deux obstacles techniques sont levés : la **fin** d'une version est désormais stockée (`foyer_version.date_fin`, `NULL` = en vigueur), donc une borne ne peut plus emporter la version applicable ; et l'aval **refuse** un mois qu'aucune version ne couvre au lieu de facturer faux en silence (`AM-55` ✅). Ce qui reste est un **arbitrage produit** : poser la borne, c'est décider que le coût des années au-delà de trois ans cesse d'être consultable — il refusera de s'afficher, en le disant. Passera ✅ avec l'ancre `foyer_version.date_fin` (`AM-88`)                       |
| T1bis | Journal de corrections (`correction_journal`)                      | **3 ans**                                                             | —                                                                |  ⛔  | Écartée §4 : la table ne porte **aucune** date d'effet, seulement sa date de correction. La borner dessus appliquerait une règle que le PO n'a pas validée. Table sans lecteur, donc sans risque : c'est le point de départ qui manque, pas la sûreté (`AM-60`).                                                                                                                                                                                                                                                                                                                                                                                          |
| T2    | Enfants, contrats, plannings, prestations                          | **3 ans**                                                             | —                                                                |  ⛔  | Écartée §4 : « fin du dernier contrat » n'est calculable dans aucune base — `valide_au` nul **vaut période ouverte**, `enfant_id` est nullable, et la copie aval n'a pas la colonne. Le critère est inexprimable, pas seulement coûteux (`AM-56`).                                                                                                                                                                                                                                                                                                                                                                                                        |
| T3    | Journal d'envoi du récapitulatif au foyer, par foyer et par parent | **13 mois**                                                           | `envoi_recap_hebdo.cree_le` + `envoi_recap_parent.cree_le`       |  ✅  | Prouver ce qui a été adressé ne sert que tant que l'envoi peut être contesté : une année scolaire pleine, plus la rentrée suivante. Ancré sur la **création**, pas sur l'envoi — sinon les lignes jamais abouties, les plus riches en adresses figées, resteraient indéfiniment.                                                                                                                                                                                                                                                                                                                                                                          |
| T3bis | Récapitulatif adressé à un établissement (`envoi_etablissement`)   | **13 mois**                                                           | `envoi_etablissement.created_at`                                 |  ✅  | **Anonymisée en place, pas supprimée**. Motif d'origine — la ligne était le seul verrou anti-double-envoi vers une vraie crèche — **levé le 2026-08-17** (`AM-58`, lot 2) : l'endpoint refuse désormais une semaine révolue de plus de 4 semaines et un récap sans modification, sans solliciter le transport. La ligne-témoin reste néanmoins conservée : elle porte la preuve de ce qui a été adressé à un tiers.                                                                                                                                                                                                                                       |
| T3ter | Préférences de notification (`preference_notification`)            | **Aucune borne**                                                      | —                                                                |  ⛔  | Écartée §4, et c'est une **correction de fond** : l'absence d'une ligne **vaut consentement**. Purger une ligne « désabonné » réabonnerait le parent, soit exactement la population que la durée visait (`AM-57`).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| T3qua | Jetons de désabonnement (`desabonnement_token`)                    | **3 ans**                                                             | `desabonnement_token.utilise_le` + `desabonnement_token.emis_le` |  ✅  | Preuve de l'**exercice d'un droit** ([ADR-0006](adr/0006-preferences-notification-et-desabonnement.md)), et la seule qui survive : `desabonne_at` est remise à nul dès que le parent se réabonne. Ancrée sur la dernière des deux dates.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T4    | Boîte de réception in-app (`notification`)                         | **12 mois**                                                           | `notification.cree_le`                                           |  ✅  | Journal en ajout seul : ses lecteurs ne portent aucune action, et ses liens profonds deviennent caducs dès la saison suivante.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T4bis | État de validation hebdomadaire (`notification_hebdo`)             | **Aucune borne**                                                      | —                                                                |  ⛔  | Écartée §4 : rangée à tort avec `notification` en v1.0. Ce n'est pas un journal mais la **machine à états** de la validation — l'absence d'une ligne y vaut « semaine jamais notifiée », et la purger effacerait une action en attente sans laisser de trace (`AM-59`).                                                                                                                                                                                                                                                                                                                                                                                   |
| T7    | `outbox`                                                           | **30 jours**                                                          | `outbox.published_at`                                            |  ✅  | La ligne n'a plus d'usage une fois publiée. Ancrée sur la publication et **jamais** sur l'occurrence : une ligne non publiée est un événement **en vol**, quel que soit son âge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T7    | `dead_letter`                                                      | **90 jours**                                                          | `dead_letter.created_at`                                         |  ✅  | Un rebut non traité en trois mois ne le sera pas. Le payload y est conservé **en clair** ; depuis `AM-53` seul un incident réel y arrive encore (un durable ne reçoit plus que ce qu'il traite), là où toute la vie normale du produit y écrivait des revenus et des adresses e-mail.                                                                                                                                                                                                                                                                                                                                                                     |
| T7    | `processed_event`                                                  | **Non chiffrée**                                                      | —                                                                |  ⛔  | Écartée §4 : garde-fou anti-rejeu. Sa borne dépend d'une rétention JetStream qui n'est toujours pas posée ; la chiffrer à l'aveugle rouvrirait le rejeu intégral.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| T5    | Journaux, traces, métriques                                        | Voir [`exploitation/observabilite.md`](exploitation/observabilite.md) | —                                                                |  ✅  | Politique déjà en vigueur, non redéfinie ici.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T6    | Sauvegardes                                                        | 30 j local, 90 j hors-site                                            | —                                                                |  ✅  | Déjà en vigueur, portée par les scripts d'exploitation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T9    | Piste d'audit acteur (`journal_audit`)                             | **3 ans**                                                             | `journal_audit.cree_le`                                          |  ✅  | Une piste qu'on efface perd ce qui la rend utile — mais elle est la seule des trois traces du dossier à nommer un **acteur**, donc à accumuler sans terme une donnée personnelle qui n'est pas celle du foyer. T1 et T1bis portant la même durée mais **écartées**, la borner la fait mourir **avant** ce qu'elle documente : passé 3 ans, une correction subsiste sans son auteur. Prix assumé — le fond de la trace survit sans l'acteur, l'inverse serait irrécupérable. **Décidée par le PO le 2026-08-14**, en **arbitrage par défaut** : durée alignée sur T1/T1bis faute de repère externe, à rediscuter si l'une d'elles bouge (préambule du §3). |

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
  - **T1 — historique versionné (`foyer_version`)**. ⚠️ **Les deux obstacles sont levés depuis
    le 2026-08-16** (lot 1 « le coût ne ment plus »), la ligne reste ⛔ pour une raison
    désormais **différente**, écrite ci-dessous.
    Le constat d'origine tenait en deux temps. (a) La fin d'une version n'était pas stockée :
    dérivée à la lecture, la dernière restait ouverte — la version **en vigueur** d'un foyer
    inactif depuis trois ans portait donc une date d'effet vieille de trois ans et tombait
    sous la borne. Elle est maintenant **matérialisée** (`foyer_version.date_fin`, `NULL` = en
    vigueur, index partiel posé dans les deux services) : une version applicable ne peut plus
    être sélectionnée par une borne. (b) Le plus grave n'était pas la perte, c'est que rien ne
    la signalait — le calcul de coût se rabattait silencieusement sur d'autres ressources pour
    les mois passés et affichait un montant faux et plausible. Il **refuse** désormais
    (`RESSOURCES_INCONNUES_AU_MOIS`, 422). `AM-55` est close.
    **Ce qui reste (`AM-88`) n'est plus un obstacle technique mais un arbitrage produit** :
    par construction du même lot, une année dont l'historique a été purgé ne s'affichera plus
    — elle refusera, en le disant. Poser la borne, c'est décider que le coût des années
    au-delà de trois ans cesse d'être consultable. La ligne passera ✅ avec l'ancre
    `foyer_version.date_fin` quand cet arbitrage sera tranché.
  - **T2 — enfants, contrats, plannings**. « Fin du dernier contrat de l'enfant » n'est
    calculable dans aucune base : `valide_au` nul **signifie période ouverte** (donc un
    `COALESCE` naïf purgerait un contrat actif), `enfant_id` est encore nullable sur les
    contrats historiques — précisément les plus anciens, ceux que la durée visait — et la
    copie de `svc-tarification` n'a pas de colonne `valide_au` du tout (`AM-56`).
  - **T3ter — préférences de notification**. La correction de fond est **livrée** (lot 2
    « le coût ne ment plus », `AM-57`, 2026-08-17) : le consentement ne se déduit plus d'une
    absence de ligne. Il est **matérialisé à l'inscription** du parent, transporté par
    `PreferencesNotifModifiees` jusqu'au read model d'envoi, et back-fillé pour les parents
    antérieurs (`0008` côté foyer, `0020` côté notifications). Une ligne manquante ne vaut
    donc plus consentement mais **absence de consentement** : purger une préférence
    `actif = false` ne réabonne plus personne. **Ce qui reste n'est plus un obstacle
    technique mais un arbitrage produit** (`AM-98`) : quelle durée conserver, sachant que la
    trace du désabonnement (`desabonne_at`, `source_dernier`) est aussi la preuve qu'on
    n'écrit plus à quelqu'un — l'effacer, c'est perdre la preuve, pas le respect du choix.
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
- **`hors périmètre`** — barèmes, grilles et calendriers **du référentiel**, sans aucune
  donnée personnelle. ⚠️ **À ne pas confondre avec le calendrier d'ouverture d'un
  établissement** (SFD 31, lot 2), qui est saisi par le parent, rattaché à un établissement
  du foyer par une clé `ON DELETE CASCADE`, et donc **exporté** : ce qu'un effacement
  emporte, un export doit le rendre. La distinction est le lieu, pas le mot « calendrier » —
  un barème national n'appartient à personne, les jours d'ouverture d'une crèche que le
  parent a saisis lui appartiennent.

| Service             | Table                      | Classe         | Pourquoi                                                                                                                                                                |
| ------------------- | -------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc-foyer`         | `foyer`                    | exportée       | Situation financière courante.                                                                                                                                          |
| `svc-foyer`         | `foyer_version`            | exportée       | Historique daté des ressources — la version en vigueur comme les précédentes.                                                                                           |
| `svc-foyer`         | `correction_journal`       | exportée       | Instantanés avant/après des corrections rétroactives de ressources.                                                                                                     |
| `svc-foyer`         | `bareme_tranches`          | hors périmètre | Read-model de barème projeté du référentiel ; aucune donnée personnelle.                                                                                                |
| `svc-foyer`         | `enfant`                   | exportée       | Prénom et date de naissance.                                                                                                                                            |
| `svc-foyer`         | `parent`                   | exportée       | Nom, prénom, e-mail, rôle — **parents retirés compris** : leur identité survit au retrait, l'effacement l'emporte, l'export la rend.                                    |
| `svc-foyer`         | `preference_notification`  | exportée       | Exportée **effective** (défaut applicatif fusionné) : ici l'absence de ligne vaut consentement, les lignes brutes mentiraient.                                          |
| `svc-foyer`         | `desabonnement_token`      | exportée       | Trace de l'exercice du droit d'opposition — **sans le `jti`**, qui est une capacité agissant sans authentification, pas une donnée.                                     |
| `svc-foyer`         | `journal_audit`            | exportée       | Piste d'audit acteur (§1, T9) : qui a modifié le dossier, quand. Exportée **sans jamais recopier** la valeur modifiée — elle est déjà rendue par la table qui la porte. |
| `svc-foyer`         | `outbox`                   | technique      | File de publication vivante ; bornée au temps (§3, T7).                                                                                                                 |
| `svc-foyer`         | `processed_event`          | technique      | Garde-fou anti-rejeu ; ne porte aucune donnée personnelle.                                                                                                              |
| `svc-foyer`         | `dead_letter`              | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                                                   |
| `svc-notifications` | `contrat`                  | copie          | Projection de `svc-planification.contrat`.                                                                                                                              |
| `svc-notifications` | `etablissement`            | copie          | Projection **appauvrie** de `svc-planification.etablissement` (ni adresse, ni téléphone, ni contact).                                                                   |
| `svc-notifications` | `foyer_parent`             | copie          | Projection **appauvrie** de `svc-foyer.parent` (ni prénom ni nom) ; sert ici à résoudre les parents du foyer.                                                           |
| `svc-notifications` | `preference_notification`  | copie          | Projection **appauvrie** de `svc-foyer.preference_notification` (sans les horodatages de consentement).                                                                 |
| `svc-notifications` | `notification_hebdo`       | exportée       | Machine à états de la validation : semaine soumise, instantané figé, écarts saisis. Aucune re-projection ne la recréerait.                                              |
| `svc-notifications` | `envoi_etablissement`      | exportée       | Preuve de ce qui est réellement parti vers l'établissement, corps HTML figé compris.                                                                                    |
| `svc-notifications` | `envoi_recap_hebdo`        | exportée       | Preuve d'envoi du récapitulatif au foyer, avec la liste figée des destinataires.                                                                                        |
| `svc-notifications` | `envoi_recap_parent`       | exportée       | Remise à chaque parent, avec l'adresse figée au moment de l'envoi.                                                                                                      |
| `svc-notifications` | `notification`             | exportée       | Boîte de réception in-app : sujets et corps rendus, tels que le parent les a lus.                                                                                       |
| `svc-notifications` | `processed_event`          | technique      | Garde-fou anti-rejeu.                                                                                                                                                   |
| `svc-notifications` | `outbox`                   | technique      | File de publication ; bornée au temps (§3, T7).                                                                                                                         |
| `svc-notifications` | `dead_letter`              | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                                                   |
| `svc-planification` | `contrat`                  | exportée       | Contrat d'accueil : mode, établissement, période, semaine type.                                                                                                         |
| `svc-planification` | `contrat_version`          | exportée       | Avenants datés du contrat.                                                                                                                                              |
| `svc-planification` | `correction_journal`       | exportée       | Instantanés avant/après des corrections d'avenant.                                                                                                                      |
| `svc-planification` | `planning_mois`            | exportée       | Saisie mensuelle des présences et absences, **simulations comprises** — ce sont des saisies du parent, pas des dérivées du système.                                     |
| `svc-planification` | `etablissement`            | exportée       | Seul endroit où vivent l'adresse, le téléphone et la personne contact : ils ne voyagent dans aucun événement.                                                           |
| `svc-planification` | `calendrier_periode`       | exportée       | Périodes du calendrier d'ouverture saisies par le parent (SFD 31), **historique compris** : la cascade emporte les lignes closes, l'export les rend.                    |
| `svc-planification` | `calendrier_exception`     | exportée       | Fermetures, ponts et journées pédagogiques saisis par le parent, avec leurs bornes de connaissance.                                                                     |
| `svc-planification` | `calendrier_recurrence`    | exportée       | Semaine type d'ouverture par régime, avec ses bornes de connaissance.                                                                                                   |
| `svc-planification` | `calendrier_regime_feries` | exportée       | Régime de jours fériés de l'établissement, historisé (`AM-106`) : il change l'interprétation des jours, il ne peut donc pas rester hors de l'export.                    |
| `svc-planification` | `processed_event`          | technique      | Garde-fou anti-rejeu.                                                                                                                                                   |
| `svc-planification` | `outbox`                   | technique      | File de publication ; bornée au temps (§3, T7).                                                                                                                         |
| `svc-planification` | `dead_letter`              | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                                                   |
| `svc-referentiel`   | `grille_abcm`              | hors périmètre | Barème public ; aucune donnée personnelle.                                                                                                                              |
| `svc-referentiel`   | `bareme_psu`               | hors périmètre | Barème public ; aucune donnée personnelle.                                                                                                                              |
| `svc-referentiel`   | `bareme_tranches`          | hors périmètre | Seuils de tranche ; aucune donnée personnelle.                                                                                                                          |
| `svc-referentiel`   | `jour_non_facturable`      | hors périmètre | Calendrier de fermeture ; aucune donnée personnelle.                                                                                                                    |
| `svc-referentiel`   | `outbox`                   | technique      | File de publication.                                                                                                                                                    |
| `svc-tarification`  | `foyer`                    | copie          | Projection de `svc-foyer.foyer`, enrichie de la tranche dérivée à l'écriture.                                                                                           |
| `svc-tarification`  | `foyer_version`            | copie          | Projection de `svc-foyer.foyer_version` (sans `saisi_le` ni motif).                                                                                                     |
| `svc-tarification`  | `enfant`                   | copie          | Projection de `svc-foyer.enfant`, écrite mais jamais relue par le calcul.                                                                                               |
| `svc-tarification`  | `grille_tarifaire`         | hors périmètre | Barème ; aucune donnée personnelle.                                                                                                                                     |
| `svc-tarification`  | `bareme_psu`               | hors périmètre | Barème ; aucune donnée personnelle.                                                                                                                                     |
| `svc-tarification`  | `prestation_mois`          | copie          | Quantités **dérivées** de `svc-planification.planning_mois` : un calcul, pas une saisie.                                                                                |
| `svc-tarification`  | `contrat`                  | copie          | Projection **appauvrie** de `svc-planification.contrat`.                                                                                                                |
| `svc-tarification`  | `engagement_ua`            | exportée       | Engagement de bénévolat déclaré par le foyer (SFD 40) : quota, valeur de l'UA, période, caution. **Projeté de nulle part** — c'est une saisie du parent.                |
| `svc-tarification`  | `session_ua`               | exportée       | Créneaux de bénévolat notés par le foyer, avec leur état. Aucune re-projection ne les recréerait : le système de réservation est un site tiers que Martha ne lit pas.   |
| `svc-tarification`  | `journal_audit`            | exportée       | Piste d'audit acteur des saisies ci-dessus (§1, T9). Exportée **sans jamais recopier** la valeur modifiée — elle est déjà rendue par les deux tables qui la portent.    |
| `svc-tarification`  | `processed_event`          | technique      | Garde-fou anti-rejeu.                                                                                                                                                   |
| `svc-tarification`  | `outbox`                   | technique      | File de publication ; bornée au temps (§3, T7).                                                                                                                         |
| `svc-tarification`  | `dead_letter`              | technique      | Magasin terminal de rebuts ; borné au temps (§3, T7).                                                                                                                   |

### Les trois exclusions, et pourquoi elles ne sont pas des oublis

1. **Les copies aval ne sortent pas.** `svc-tarification` ne détient, **hors unités
   associatives**, que des projections
   des tables ci-dessus, et `svc-notifications` en porte quatre. Les inclure ferait passer
   pour une donnée de plus ce qui n'est qu'un second exemplaire de la même — souvent moins
   complet que l'original. La règle vaut dans un seul sens : là où la copie porte **moins**
   que sa source (`svc-planification.etablissement` et ses coordonnées, absentes du
   read-model aval), c'est la **source** qui est exportée.
   Depuis la **SFD 40** (unités associatives), `svc-tarification` détient en plus
   **deux saisies du parent** (`engagement_ua`, `session_ua`) et leur piste d'audit : celles-là
   ne sont la copie de rien — l'export les rend, c'est la même règle et non une exception.
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

## 7. Ce que la piste d'audit trace, route par route

**Livré le 2026-08-14 (lot 6, `AM-45`).** Une piste d'audit se périme comme l'export : elle
ne casse pas. On ajoute une route de mutation, elle n'écrit rien, et **rien ne le dit** — la
piste continue de répondre, cohérente, simplement muette sur ce qui vient d'arriver. Ce
tableau est donc l'inventaire des routes de mutation des cinq services, avec ce que chacune
laisse comme trace, et la porte `pnpm acteur` en dérive l'attendu des contrôleurs : une
route nouvelle sans ligne ici fait échouer la CI.

Les cinq classes :

- **`auditée`** — une ligne `journal_audit` est écrite dans la transaction de la mutation,
  avec l'acteur ; la colonne « Action / motif » nomme l'action, qui doit exister dans le
  registre du service (`audit/journal-audit.actions.ts`) ;
- **`journal seul`** — l'action est tracée dans le journal applicatif (T5) mais **pas** en
  base, parce que la base ne peut pas la garder ;
- **`exemptée`** — aucun acteur n'existe, par construction de la route ;
- **`hors périmètre`** — la route ne touche aucune donnée personnelle de foyer ;
- **`différée`** — la route mute des données personnelles sans trace d'acteur. Elle doit
  nommer une piste **ouverte** du [registre](34-registre-ameliorations.md) : le jour où
  cette piste se ferme, la porte refuse la ligne.

| Service             | Route                                                           | Classe         | Action / motif                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc-foyer`         | `POST /foyers`                                                  | auditée        | `foyer.cree`                                                                                                                                                                                                                                 |
| `svc-foyer`         | `PUT /foyers/:id`                                               | auditée        | `foyer.ressources.saisies` ou `foyer.ressources.corrigees` selon que la date d'effet est libre ou déjà occupée                                                                                                                               |
| `svc-foyer`         | `DELETE /foyers/:id`                                            | journal seul   | `foyer.efface` — `journal_audit` part en `ON DELETE CASCADE` avec le foyer : insérée avant elle serait emportée, après elle violerait la clé étrangère                                                                                       |
| `svc-foyer`         | `POST /foyers/:id/enfants`                                      | auditée        | `enfant.ajoute`                                                                                                                                                                                                                              |
| `svc-foyer`         | `PUT /foyers/:id/enfants/:enfantId`                             | auditée        | `enfant.modifie`                                                                                                                                                                                                                             |
| `svc-foyer`         | `DELETE /foyers/:id/enfants/:enfantId`                          | auditée        | `enfant.retire`                                                                                                                                                                                                                              |
| `svc-foyer`         | `POST /foyers/:id/parents`                                      | auditée        | `parent.ajoute`                                                                                                                                                                                                                              |
| `svc-foyer`         | `PUT /foyers/:id/parents/:parentId`                             | auditée        | `parent.modifie`                                                                                                                                                                                                                             |
| `svc-foyer`         | `DELETE /foyers/:id/parents/:parentId`                          | auditée        | `parent.retire`                                                                                                                                                                                                                              |
| `svc-foyer`         | `PUT /foyers/:id/parents/:parentId/preferences`                 | auditée        | `parent.preferences.modifiees`                                                                                                                                                                                                               |
| `svc-foyer`         | `POST /desabonnement`                                           | exemptée       | Désabonnement one-click (RFC 8058) : la route est publique et n'agit que sur présentation d'une **capacité** signée. Il n'y a pas d'acteur à établir, et l'exercice du droit est déjà tracé par `desabonnement_token.utilise_le` (§3, T3qua) |
| `svc-foyer`         | `POST /desabonnement/jetons`                                    | exemptée       | Route **interne** d'émission de jetons, appelée par `svc-notifications` sous assertion machine : elle ne mute aucune donnée du dossier                                                                                                       |
| `svc-planification` | `POST /contrats`                                                | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `POST /contrats/:id/versions`                                   | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /contrats/:id/versions/:versionId`                         | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /contrats/:id/version-courante`                            | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /contrats/:id/etablissement`                               | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /contrats/:id/enfant`                                      | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `DELETE /contrats/:id`                                          | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /contrats/:id/plannings/:mois`                             | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /contrats/:id/plannings/semaine/:semaineIso`               | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `POST /etablissements`                                          | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /etablissements/:id`                                       | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `DELETE /etablissements/:id`                                    | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /etablissements/:id/calendrier/recurrences`                | différée       | `AM-76` — semaine type d'ouverture (SFD 31). Append-only : la retouche est **reconstituable** en base (`connu_depuis`), mais elle ne dit pas QUI a agi.                                                                                      |
| `svc-planification` | `POST /etablissements/:id/calendrier/periodes`                  | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `PUT /etablissements/:id/calendrier/periodes/:periodeId`        | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `DELETE /etablissements/:id/calendrier/periodes/:periodeId`     | différée       | `AM-76` — **clôture**, pas suppression : la ligne reste lisible, seul l'acteur manque.                                                                                                                                                       |
| `svc-planification` | `POST /etablissements/:id/calendrier/exceptions`                | différée       | `AM-76`                                                                                                                                                                                                                                      |
| `svc-planification` | `DELETE /etablissements/:id/calendrier/exceptions/:exceptionId` | différée       | `AM-76` — **clôture**, pas suppression.                                                                                                                                                                                                      |
| `svc-planification` | `POST /etablissements/:id/calendrier/import` | différée | `AM-76` — import d'une année scolaire (SFD 31, lot 3). Append-only : le réimport **clôt** les périodes importées précédentes, elles restent lisibles ; les périodes saisies à la main et les exceptions ne sont pas touchées. |
| `svc-notifications` | `POST /envois/etablissement`                                    | différée       | `AM-77`                                                                                                                                                                                                                                      |
| `svc-notifications` | `POST /validations/:contratId/:semaineIso`                      | différée       | `AM-77`                                                                                                                                                                                                                                      |
| `svc-notifications` | `POST /moi/notifications/:id/lu`                                | différée       | `AM-77`                                                                                                                                                                                                                                      |
| `svc-tarification`  | `POST /unites-associatives`                                     | auditée        | `engagement_ua.declare`                                                                                                                                                                                                                      |
| `svc-tarification`  | `POST /unites-associatives/sessions`                            | auditée        | `session_ua.ajoutee`                                                                                                                                                                                                                         |
| `svc-tarification`  | `PUT /unites-associatives/sessions/:sessionId`                  | auditée        | `session_ua.modifiee` — c'est l'action qui déplace des heures d'un compteur à l'autre, donc celle qui change le coût projeté du foyer                                                                                                        |
| `svc-tarification`  | `DELETE /unites-associatives/sessions/:sessionId`               | auditée        | `session_ua.supprimee` — la ligne est écrite **avant** la suppression et lui survit : aucune clé étrangère ne la rattache à la session, elle porte le foyer                                                                                  |
| `svc-referentiel`   | `POST /grilles/abcm`                                            | hors périmètre | Publication d'un barème public par un administrateur ; aucune donnée personnelle                                                                                                                                                             |
| `svc-referentiel`   | `POST /baremes/psu`                                             | hors périmètre | Publication d'un barème public par un administrateur ; aucune donnée personnelle                                                                                                                                                             |
| `svc-referentiel`   | `POST /baremes/tranches`                                        | hors périmètre | Publication de seuils de tranche par un administrateur ; aucune donnée personnelle                                                                                                                                                           |

### Ce que la piste ne dit pas

1. **Elle ne dit pas ce qui a changé, seulement que quelque chose a changé, par qui.**
   Recopier les valeurs y ferait un second exemplaire des données du dossier, avec sa propre
   durée et son propre risque de fuite. Pour les ressources, l'avant/après existe déjà dans
   `correction_journal`, que la ligne d'audit désigne par son identifiant.
2. **Elle ne prouve pas qu'un acteur était légitime, seulement qu'il a été présenté.**
   L'autorisation est le sujet des gardes (`AssertionIdentiteGuard`, `ScopeFoyerGuard`), et
   leurs **refus** sont journalisés depuis le chantier fondations. La piste couvre l'autre
   moitié : les succès.
3. **Elle n'est pas infalsifiable.** Un accès direct à la base peut la réécrire ; la table
   n'est pas signée et le dépôt n'a pas d'archivage en écriture seule. Ce serait une garantie
   d'un autre ordre, hors de portée d'un service auto-hébergé — la dire ici évite de la
   croire acquise.
4. **`acteur_type = 'inconnu'` n'est pas une anomalie de la piste, mais un état réel du
   système.** Tant que `INTERSERVICE_AUTHZ_ENFORCE` reste à 0, une requête sans assertion
   valide passe. Le compteur `foyer_audit_actions_total{acteur="inconnu"}` mesure exactement
   ce que la bascule refuserait.
