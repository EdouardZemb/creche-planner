# ADR-0007 — Exemption domestique assumée, et démarche volontaire de protection des données

- **Statut** : Accepté
- **Date** : 2026-08-11
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Contexte amont** : [ADR-0006](0006-preferences-notification-et-desabonnement.md)
  (préférences de notification et désabonnement one-click — seul droit outillé à ce jour).
- **Déclencheur** : revue des standards industriels d'août 2026 (`AM-33`, `AM-36`, `AM-46`
  de la [doc 34](../34-registre-ameliorations.md)), lot 1 du plan
  `.claude/plans/plan-standards-industriels.md`.

## Contexte

Deux plans du dépôt affirment l'inverse l'un de l'autre, et **aucun ADR ne tranche** :

- `.claude/plans/amelioration-2026-07-pistes.md` écarte le livrable — « Registre RGPD/AIPD
  formels : exemption domestique art. 2(2)(c) — la bureaucratie n'apporte rien » ;
- `.claude/plans/plan-standards-industriels.md` pose au contraire le RGPD comme « la seule
  famille où l'écart est une obligation, pas un choix ».

Écrire un registre sans trancher aurait empilé une troisième position. La question devait
donc être posée avant, pas après.

Les faits qui pèsent, tous vérifiés dans le code au 2026-08-11 :

- l'application est un **outil familial mono-foyer**, utilisé par les parents d'un seul
  foyer pour organiser la garde de leurs propres enfants ;
- elle stocke néanmoins des **enfants mineurs** et des **revenus** (RFR, ressources
  mensuelles, nombre de parts) — [`svc-foyer/…/schema.ts`](../../apps/svc-foyer/src/database/schema.ts) ;
- elle stocke aussi les coordonnées d'un **tiers professionnel** : l'établissement d'accueil
  (nom, e-mail de service, adresse, téléphone, personne contact) —
  [`svc-planification/…/schema.ts`](../../apps/svc-planification/src/database/schema.ts) ;
- elle **envoie de vrais courriels** à ce tiers, l'envoi réel étant actif en production
  ([`svc-notifications/src/config.ts`](../../apps/svc-notifications/src/config.ts)) ;
- côté droits, seul le **droit d'opposition** est outillé ([ADR-0006](0006-preferences-notification-et-desabonnement.md)) :
  il n'existe ni suppression de foyer, ni export de données, ni durée de conservation.

## Décision

**L'exemption domestique de l'article 2(2)(c) est assumée** : le traitement est réputé
relever de l'exercice d'activités strictement personnelles ou domestiques, et le dépôt ne
revendique pas la conformité au RGPD.

**Le lot 1 est néanmoins livré, en démarche volontaire.** Registre des traitements,
inventaire des tiers, durées de conservation, objectifs de reprise et mentions
d'information sont écrits — non parce qu'un texte les impose, mais parce qu'ils répondent à
des questions d'ingénierie que personne d'autre ne posait : _quelles données vivent où,
combien de temps, et chez qui transitent-elles ?_ La revue d'août a montré que le dépôt ne
savait pas y répondre.

Conséquence de rédaction : le vocabulaire réglementaire (« responsable de traitement »,
« sous-traitant », « personne concernée ») est employé dans la [doc 37](../37-registre-des-traitements.md)
comme **grille de description**, jamais comme revendication de conformité. La doc 37 le dit
dans son propre préambule.

## Risque résiduel — assumé, et c'est le point de cet ADR

L'exemption est **fragile**, et il faut que ce soit écrit plutôt que supposé. Trois faits
la mettent en tension :

1. **Le tiers professionnel.** L'établissement d'accueil n'est pas un membre du foyer. Ses
   coordonnées sont collectées **indirectement** (saisies par le propriétaire du produit,
   jamais par la personne elle-même), et cette personne n'est **informée nulle part** à ce
   jour.
2. **L'envoi sortant réel.** Le récapitulatif hebdomadaire part par SMTP vers une adresse de
   service réelle. Un traitement qui adresse des données à un tiers extérieur au foyer
   quitte le cercle purement personnel — c'est la limite exacte que la jurisprudence
   européenne oppose à l'exemption.
3. **L'absence de garde-fou d'envoi en production.** Aucune allowlist n'est posée : rien ne
   borne techniquement le périmètre des destinataires.

Le lot 1 réduit le premier point (mentions d'information + pied de courriel). Les deux
autres restent entiers.

## Conséquences

**Ce que la décision rend vrai :**

- la contradiction juillet/août cesse d'exister : cet ADR est la référence, les deux plans
  lui sont subordonnés ;
- les durées de conservation de la doc 37 sont des **objectifs de gestion** (ce qu'on
  s'engage à purger), pas des obligations légales — leur outillage reste le lot 2 ;
- aucune analyse d'impact (AIPD) n'est conduite, et aucun registre au sens de l'article 30
  n'est déposé nulle part.

**Ce qu'elle ne change pas :**

- le drapeau `pai` reste qualifié **donnée de facturation** et non donnée de santé —
  le code ne stocke ni diagnostic ni document, seulement une part de garde facturée seule
  ([`inscription-abcm.ts`](../../libs/planification/domain/src/lib/inscription-abcm.ts)).
  Il est **écrit** au registre comme indice indirect, avec accès restreint : l'ignorer
  serait le seul vrai risque ;
- le droit d'opposition outillé par l'ADR-0006 reste en place et n'est pas rétrogradé.

## Révision

Cet ADR **doit être rouvert** si l'un de ces seuils est franchi — ce sont les conditions
qui feraient tomber l'exemption, énoncées d'avance pour qu'on n'ait pas à en juger dans
l'urgence :

- l'application sert **plus d'un foyer** réel, ou est proposée à des foyers tiers ;
- un **établissement** obtient un accès direct (compte, portail, dépôt de documents) ;
- le produit est exploité dans un cadre **professionnel ou associatif**, même gratuit ;
- une **donnée de santé** au sens de l'article 9 est stockée (un `pai` qui porterait un
  motif, un document ou un commentaire médical franchirait ce seuil — aujourd'hui il ne
  porte qu'un booléen).

En cas de réouverture, la doc 37 est déjà écrite : le travail restant serait la base
légale, l'AIPD et les droits non outillés (effacement, portabilité — lots 2 et 3 du plan
standards).
