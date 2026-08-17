# ADR-0009 — Nom du produit : « Martha », renommé à l'affichage seul

- **Statut** : Accepté
- **Date** : 2026-08-17
- **Décideurs** : Propriétaire du produit (utilisateur)
- **Déclencheur** : décision PO du 2026-08-17, instruite par l'estimation de renommage
  du 2026-08-16 (trois couches chiffrées séparément).

## Contexte

Le produit s'appelait **« Crèche Planner »**, et le README annonçait depuis des mois un
`— _(futur « Budget du foyer »)_` qui n'a jamais été tranché. Ce nom provisoire pesait de
deux façons.

**Il était devenu faux.** « Crèche Planner » décrit le premier lot, pas le produit : le
dépôt tient aujourd'hui les contrats, les plannings, les ressources du foyer, le coût
consolidé, les envois aux établissements, et la [SFD 38](../38-sfd-rattachement-documentaire.md)
y branche la GED du foyer. La crèche n'est plus qu'un des modes de garde.

**Il fermait la trajectoire.** Le produit va vers les **données du foyer** aujourd'hui et
la **domotique** à long terme — un nom qui contient « crèche » ne suit pas jusque-là.

Le nom retenu est **Martha**, d'après _Martha Hudson_, la logeuse de Sherlock Holmes :
l'app-gouvernante du foyer, celle qui tient la maison pendant qu'on s'occupe d'autre
chose. Vérification faite au moment de la décision, le mot n'apparaissait **nulle part**
dans le dépôt — aucune collision avec un identifiant, un test ou une donnée de seed.

### Ce que coûterait un renommage complet

L'estimation du 2026-08-16 a séparé trois couches, qui n'ont ni le même coût ni le même
risque :

| Couche | Ce qu'elle contient                                                                | Nature                      |
| ------ | ---------------------------------------------------------------------------------- | --------------------------- |
| **1**  | Titre web, manifest PWA, e-mails, mentions légales, titre OpenAPI, README et docs  | Texte lu par un humain      |
| **2**  | Scope npm `@creche-planner/*`, noms d'images, volumes Docker, nom du dépôt         | Identifiants **internes**   |
| **3**  | Hostnames, unités systemd, chemins serveur, `uid` de dashboards, tâches planifiées | Identité **d'exploitation** |

Les couches 2 et 3 ne changent **rien** pour la personne qui utilise le produit. Elles
coûtent, en revanche, une réécriture de masse (53 liens `workspace:*`), un train de
release dont le rollback ne retombe pas sur les mêmes noms d'images, et une fenêtre où
les volumes de production doivent être renommés à la main sur un serveur qui n'est
joignable qu'en LAN.

## Décision

**Le renommage porte sur la couche 1 seule.** Ce que lit un humain dit « Martha » ;
l'identité technique reste `creche-planner`, sans date de bascule prévue.

Trois conséquences directes, tenues par le code :

1. **Le nom seul ne circule que là où le lecteur le connaît déjà** — l'application, le
   récap aux parents. Ce sont des gens qui ont ouvert Martha.
2. **Chez un destinataire sans contexte, le nom est toujours apposé.** L'agent d'un
   établissement n'a **pas de compte** et n'ouvre **jamais** l'application
   ([ADR-0007](0007-exemption-domestique-et-demarche-volontaire.md)) : pour lui, un prénom
   seul se lit comme une **personne**. Le mail au service dit donc « Martha, l'outil
   familial… » et signe « — Martha, l'application de planning de la famille » — jamais
   « Martha » nu. L'ancienne signature, « — Crèche Planner (pour la famille) », portait
   cette fonction dans le nom lui-même ; le nouveau nom ne la porte plus, la phrase doit
   la porter à sa place.
3. **L'objet du mail au service reste fonctionnel et sans nom de produit**
   (« Plannings modifiés — semaine du … »). C'est lui qui renseigne l'agent quand il trie
   sa boîte de réception, pas l'expéditeur.

Le nom d'affichage de l'expéditeur (`NOTIF_EMAIL_FROM`) suit la même règle et vaut
**`Martha — planning de garde`** : un seul expéditeur sert les deux publics, il doit
donc être lisible par le moins informé des deux.

## Risque résiduel — assumé

**Deux noms coexistent, et c'est définitif.** Un lecteur du dépôt verra `@creche-planner/…`
dans un import et « Martha » dans l'écran rendu par ce même fichier ; un lecteur du serveur
verra `creche-planner-web` dans `docker ps`. Rien ne le lui explique au point où il le
rencontre — seuls ce document et l'encadré du README le disent.

Le risque accepté est donc une **confusion de lecture**, jamais une confusion d'exécution :
aucun des deux noms n'est ambigu dans son propre registre. Il est préféré au risque
d'exploitation d'un renommage de couche 3 sur un serveur à un seul disque, joignable en
LAN, dont le rollback repasse par le même `docker-compose`
([LE-58](../34-registre-ameliorations.md)).

## Conséquences

- Le titre d'onglet, la marque d'en-tête, le manifest PWA (`name` **et** `short_name` —
  c'est le libellé sous l'icône du téléphone), les mentions légales, les deux gabarits
  d'e-mail et le titre OpenAPI disent « Martha ».
- `NOTIF_EMAIL_FROM` est renommé dans le gabarit et dans le défaut Compose. La valeur
  **réelle** de production vit dans `.env.server`, **hors dépôt** : tant qu'elle n'y est
  pas reportée à la main, un établissement reçoit un message **expédié par « Crèche
  Planner »** dont le corps dit « Martha » — deux noms sans rapport, chez le seul lecteur
  qui ne peut pas les rapprocher. Le geste est **bloquant** et écrit comme tel dans le
  [runbook de déploiement](../exploitation/runbook-deploiement.md) ; aucune porte ne le
  couvre (`pnpm environnement` juge la **déclaration** de la variable, pas sa valeur).
- Les tests qui affirmaient l'ancien nom (13 assertions, 8 fichiers) suivent, et une
  nouvelle spec tient l'arbitrage du mail au service : aucune occurrence de « Martha »
  sans son apposition, et pas de nom de produit dans l'objet.
- `docs/04` §1 garde sa vision d'une plateforme « Budget du foyer » : elle décrit un
  **périmètre**, pas un nom, et ce périmètre n'a pas changé.
- La dette de couche 2/3 est mise en file explicite : `AM-95`.

## Révision

Cette décision se rouvre si **l'un** de ces seuils est franchi :

- Le produit sort du foyer (un second foyer, un utilisateur non-parent) : le nom technique
  devient visible de gens qui n'ont pas écrit le code.
- Le dépôt est publié comme paquet installable : le scope npm devient un nom **public**.
- Un renommage d'infrastructure devient nécessaire pour une autre raison (migration de
  serveur, changement de registre d'images) : la couche 3 s'aligne alors **dans le même
  geste**, jamais pour elle-même.
