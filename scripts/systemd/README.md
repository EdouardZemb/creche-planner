# Sauvegarde planifiée (serveur de production)

Unités `systemd` pour exécuter une sauvegarde quotidienne des 4 bases
PostgreSQL via [`scripts/backup-cron.sh`](../backup-cron.sh) (qui enchaîne
`backup-all.sh` puis `backup-prune.sh`). Voir
[docs/exploitation/sauvegardes.md](../../docs/exploitation/sauvegardes.md) §4.

> Cible : Debian/Ubuntu (le serveur de prod). Sur une distribution sans systemd,
> utiliser l'[alternative cron](#alternative-cron) plus bas.

## 1. Adapter les chemins

Les unités fournies utilisent des **placeholders** : clone dans
`/home/<user>/creche-planner`, utilisateur `<user>` (membre du groupe
`docker`), dumps dans `/home/<user>/backups/creche`. Remplacer `<user>` par le
compte de service réel. Si le clone est ailleurs,
éditer dans [`creche-backup.service`](creche-backup.service) :
`WorkingDirectory`, `User`/`Group`, `ExecStart`, `Documentation`, `BACKUP_DIR`,
`ReadWritePaths`.

`BACKUP_DIR` doit être **persistant et hors du dépôt**. Le placer sous le home
évite tout `chown` root. La rétention se règle via `BACKUP_RETENTION_DAYS`
(défaut 30 j).

## 2. Installer

```bash
# Préparer le répertoire de sauvegarde (sous le home → pas de sudo)
mkdir -p /home/<user>/backups/creche

# Copier les unités
sudo cp scripts/systemd/creche-backup.service /etc/systemd/system/
sudo cp scripts/systemd/creche-backup.timer   /etc/systemd/system/

# Activer le timer
sudo systemctl daemon-reload
sudo systemctl enable --now creche-backup.timer
```

## 3. Vérifier

```bash
# Prochaine échéance planifiée
systemctl list-timers creche-backup.timer

# Lancer une sauvegarde immédiate (test)
sudo systemctl start creche-backup.service

# Journal de la dernière exécution
journalctl -u creche-backup.service -n 50 --no-pager

# Contenu produit
ls -la /home/<user>/backups/creche
```

Une exécution réussie écrit un sous-dossier horodaté contenant les 4 dumps et
se termine avec le statut `success` dans `journalctl`.

## Alternative cron

Si systemd n'est pas disponible, planifier le wrapper directement. Il gère
lui-même le chargement de `.env.server`, la sortie et la purge :

```cron
# /etc/cron.d/creche-backup — sauvegarde quotidienne à 02:00
MAILTO=<user>
0 2 * * *  <user>  BACKUP_DIR=/home/<user>/backups/creche BACKUP_RETENTION_DAYS=30 /home/<user>/creche-planner/scripts/backup-cron.sh >> /home/<user>/creche-backup.log 2>&1
```

---

# Auto-déploiement STAGING (Phase 8)

Unités `creche-staging-poll.{service,timer}` : un timer **sortant** sonde le digest
GHCR de `:main` (~5 min) et, à chaque **nouvelle** image (= chaque merge), déploie et
fume la pile de **staging** via [`scripts/staging-poll.sh`](../staging-poll.sh) →
[`scripts/staging-poll.mjs`](../staging-poll.mjs) → `scripts/deploy.mjs`. Topologie
**pull-based** préservée (rien d'entrant). Voir
[docs/exploitation/24 §12](../../docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md).

> **Clone SÉPARÉ obligatoire.** Le poller fait `git pull --ff-only` : il doit viser
> un clone **dédié au staging** (ex. `/home/<user>/creche-planner-staging`), JAMAIS
> le clone de prod (sinon un pull staging modifierait l'arbre de travail de la prod).

## 1. Bootstrap du clone de staging

```bash
git clone <URL_DU_REPO> /home/<user>/creche-planner-staging
cd /home/<user>/creche-planner-staging
cp .env.staging.example .env.staging      # remplir GH_DEPLOYMENTS_TOKEN
chmod +x scripts/staging-poll.sh          # exécuté par systemd
# docker login ghcr.io déjà fait sur la machine (partagé avec la prod)
```

## 2. Adapter et installer les unités

Remplacer `<user>` (et le chemin du clone si différent) dans
[`creche-staging-poll.service`](creche-staging-poll.service) :
`WorkingDirectory`, `User`, `ExecStart`, `Environment=PATH`, `Documentation`,
`ReadWritePaths`.

> **PATH / node.** Si `node` est installé via **nvm/fnm** (hors `/usr/bin`), ajouter
> son répertoire `bin` à la ligne `Environment=PATH=…` du `.service` (systemd a un
> PATH minimal). Vérifier : `systemctl show -p Environment creche-staging-poll.service`.

```bash
sudo cp scripts/systemd/creche-staging-poll.service /etc/systemd/system/
sudo cp scripts/systemd/creche-staging-poll.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now creche-staging-poll.timer
```

## 3. Vérifier

```bash
# Prochaine échéance
systemctl list-timers creche-staging-poll.timer

# Forcer un poll immédiat (déploie si un nouveau :main existe)
sudo systemctl start creche-staging-poll.service
journalctl -u creche-staging-poll.service -n 80 --no-pager

# Forcer un (re)déploiement même sans nouveau digest (test) :
cd /home/<user>/creche-planner-staging && STAGING_FORCE=1 ./scripts/staging-poll.sh
```

Un tick sans nouvelle image journalise « Staging déjà à jour — rien à faire ». Un
nouveau `:main` déclenche `deploy.mjs` (portes + GitHub Deployment d'env `staging`).
Un **échec** de porte laisse la pile en l'état (`ROLLBACK=0`) : c'est le signal
« ne pas promouvoir ce `:main` ».
