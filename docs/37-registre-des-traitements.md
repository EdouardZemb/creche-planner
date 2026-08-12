# 37 — Registre des traitements, des tiers et des durées de conservation

> Statut : **Établi** · Version 1.0 · 2026-08-11
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

**Ce document n'outille rien.** Les durées du §3 sont des **objectifs de gestion**
proposés, pas des purges en vigueur : aucune n'est appliquée par du code au 2026-08-11. Leur
mise en œuvre est le lot 2 du plan `.claude/plans/plan-standards-industriels.md` (droit à
l'effacement et purge). Le §4 dit ce qui manque.

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

## 3. Durées de conservation proposées

**Décision du propriétaire du produit, 2026-08-11.** Aucune de ces durées n'est **encore**
appliquée par du code : rien n'expire à l'échéance, et c'est le lot 2b du plan standards qui
outillera la borne temporelle.

À ne pas confondre avec l'**effacement à la demande**, livré lui au 2026-08-12 (lot 2a) :
supprimer un foyer efface immédiatement toutes les données de ce foyer, dans les cinq bases,
sans attendre aucune échéance. Ce sont deux mécanismes distincts — l'un est un droit exercé,
l'autre une hygiène de rétention.

| Réf.  | Données                                                                              | Durée proposée                                                        | Point de départ                    | Pourquoi                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1    | Ressources, RFR, historique versionné du foyer, journal de corrections               | **3 ans**                                                             | Date d'effet de la version         | La seule finalité écrite de cet historique est le **recalcul rétroactif** ; au-delà de deux exercices tarifaires plus une année de réclamation, aucune ligne de code ne relit ces versions.                                           |
| T2    | Enfants, contrats, plannings, prestations                                            | **3 ans**                                                             | Fin du dernier contrat de l'enfant | **Même horizon que T1, délibérément** : un planning conservé plus longtemps que les revenus qui l'ont tarifé est inexploitable — aucun recalcul n'est possible. Deux durées différentes créeraient une incohérence garantie.          |
| T3    | Corps de messages rendus et listes de destinataires figées (parent et établissement) | **13 mois**                                                           | Date d'envoi                       | La finalité inscrite dans le code est de **prouver ce qui a réellement été adressé**. Une preuve d'envoi ne sert que tant que l'envoi peut être contesté : une année scolaire pleine, plus la rentrée suivante.                       |
| T3bis | Préférences de notification et jetons de désabonnement                               | **3 ans**                                                             | Dernière modification              | Ce ne sont pas des preuves de contenu mais des preuves de l'**exercice d'un droit** ([ADR-0006](adr/0006-preferences-notification-et-desabonnement.md)) : elles doivent survivre plus longtemps que les messages qu'elles gouvernent. |
| T4    | Boîte de réception applicative (`notification`, `notification_hebdo`)                | **12 mois**                                                           | Date de création                   | Le code la qualifie lui-même de journal en ajout seul, et ses liens profonds deviennent caducs dès la saison suivante.                                                                                                                |
| T7    | `outbox`                                                                             | **30 jours**                                                          | Après publication effective        | La ligne n'a plus d'usage une fois publiée ; seule l'analyse d'incident la relit.                                                                                                                                                     |
| T7    | `dead_letter`                                                                        | **90 jours**                                                          | Date de rebut                      | Un rebut non traité en trois mois ne le sera pas.                                                                                                                                                                                     |
| T7    | `processed_event`                                                                    | **Non chiffrée dans ce lot**                                          | —                                  | C'est le garde-fou anti-rejeu. Sa borne dépend de la rétention JetStream, qui n'est pas documentée (dette déjà consignée). La chiffrer à l'aveugle ouvrirait une régression d'idempotence au lot 2.                                   |
| T5    | Journaux, traces, métriques                                                          | Voir [`exploitation/observabilite.md`](exploitation/observabilite.md) | —                                  | Politique déjà en vigueur, non redéfinie ici.                                                                                                                                                                                         |
| T6    | Sauvegardes                                                                          | 30 j local, 90 j hors-site                                            | Date du jeu                        | Déjà en vigueur.                                                                                                                                                                                                                      |

**Effet de bord à connaître** : une purge de T1 ou T2 ne suffit pas. Les mêmes données
existent en **copies aval** dans `svc-tarification` et `svc-notifications`, et dans les
payloads d'`outbox`. L'effacement devra voyager en **événement d'intégration**, jamais en
suppression locale — c'est la contrainte structurante du lot 2.

## 4. Ce que ce registre ne couvre pas

Écrit ici pour que l'absence soit visible plutôt que découverte plus tard :

- **Aucune purge liée au temps n'existe.** Aucune durée du §3 n'est appliquée par du code :
  rien n'expire, jamais. C'est le lot 2b.
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
    Sa borne dépend d'une rétention JetStream qui n'est pas encore posée (cf. §3).

  `dead_letter`, en revanche, **est** purgée pour le foyer effacé : c'est un magasin terminal
  que plus rien ne relit, et il stockait jusqu'ici des payloads en clair — tout événement du
  stream `FOYER` non consommé par un service y atterrit avec son contenu.

- **Aucun export** des données personnelles n'est proposé à un parent. C'est le lot 3.
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
