---
name: travail-a-distance-vacances-2026-08
description: 'Montage pour travailler sur le projet hors du poste (départ en vacances 2026-08-02) : contexte versionné, accès distant Tailscale, 2 routines cloud'
metadata:
  node_type: memory
  type: project
  originSessionId: 70879924-4870-4bd8-b878-0ec625b12512
  modified: 2026-08-02T07:22:33.668Z
---

Départ en vacances le **2026-08-02**, avec volonté de continuer à lancer des
sessions comme depuis le poste principal. Trois décisions prises.

**1. Le contexte de travail est désormais dans le dépôt** — PR #276, mergée en
`406c7d1`. Les 20 plans de `.claude/plans/`, les 44 fiches de mémoire copiées
dans `.claude/memory/` et 2 prompts, jusque-là hors dépôt donc invisibles d'une
session distante. `CLAUDE.md` pointe vers ces sources et liste ce qui reste
infaisable hors LAN.

> ⚠️ **Exception décidée le 2026-08-02 : le miroir est volontairement
> incomplet.** Le dépôt étant **public**, les fiches touchant à l'accès au
> serveur ou à la posture de sécurité ne sont **jamais** versionnées, et
> quelques passages d'autres fiches sont retenus pour la même raison. La règle
> est inscrite dans `CLAUDE.md`. Ne pas chercher à « resynchroniser » le miroir
> en bloc depuis le poste principal : cela republierait ce qui a été écarté.

> ⚠️ **Obligation de synchronisation.** La source de vérité de la mémoire reste
> `~/.claude/projects/<slug>/memory/`. Le dépôt n'en contient qu'un **miroir** :
> toute fiche écrite ou modifiée localement dérive tant qu'elle n'est pas
> recopiée dans `.claude/memory/` et poussée. Inversement, une session distante
> qui apprend un fait durable doit l'écrire dans `.claude/memory/` + `MEMORY.md`
> et ouvrir une PR — c'est la seule voie de retour vers le poste. Consigne déjà
> inscrite dans `CLAUDE.md`.

**2. Accès distant retenu : Tailscale + RDP** — runbook complet dans
`docs/exploitation/acces-distant.md`. Le point de conception qui compte :
**option routeur de sous-réseau** (`--advertise-routes` sur le serveur +
`--accept-routes` sur le poste), qui garde l'IP LAN du serveur joignable à
l'identique et évite de retoucher les scripts, compose et docs qui la codent en
dur. Les installs sont des gestes utilisateur, à faire **avant** le départ et à
tester depuis une connexion 4G (un test depuis le LAN ne prouve rien).
Cf. [[prod-server-access]].

**3. Deux routines cloud actives** (claude.ai/code/routines), modèle
`claude-sonnet-5`, outils réduits à `Bash`/`Read`/`Glob`/`Grep` — sans `Write`
ni `Edit`, elles ne peuvent pas modifier de code :

- `trig_01DTHXZQ2dYAbs9C7qjBdNNs` — triage Dependabot, lundi 8h07 Paris.
  Commente une issue de suivi unique `[veille] Triage Dependabot`. Lit
  `.claude/plans/dependabot-resolution.md` s'il le trouve. Ne merge rien.
- `trig_012xWBUEvNwyR8k2jrP451oZ` — veille CI/sécurité, quotidienne 7h06 Paris.
  Vérifie que les automatismes sont **vivants** (`ci.yml` vert sur main,
  `image-scan.yml` a bien tourné sous 48 h, alertes CodeQL/Dependabot) plutôt
  que de doubler le scan Trivy. Verdict VERT/ORANGE/ROUGE ; **n'ouvre une issue
  qu'en ORANGE ou ROUGE** — le silence est le signal normal.

Les connecteurs Gmail/Agenda/Drive, attachés **automatiquement** à la création
d'une routine, ont été retirés des deux : un agent autonome avec Gmail en
écriture est incompatible avec le risque d'envoi vers l'adresse réelle de la
crèche (cf. [[feature-notifications-planning]]). À re-vérifier si une routine
est recréée.

**Restes côté utilisateur avant départ** : installer Tailscale (poste +
serveur), activer RDP, `powercfg` anti-veille, et surtout régler
**Healthchecks.io `Period` = 5 min / `Grace` = 5 min** — au défaut d'un jour, la
détection d'une panne de prod passe à ~25 h. Cf. [[plan-consolidation-ui-qualite]]
(lot A4) et [[prod-deployment-facts]].
