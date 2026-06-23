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

---

# Auto-déploiement PROD sur Release signée (Phase 10)

Unités `creche-release-poll.{service,timer}` : un timer **sortant** sonde l'API
**GitHub Releases** (~5 min) et, à chaque **nouvelle version semver publiée** (artefact
immuable + **signé cosign** par `release.yml`), déploie la **prod** via
[`scripts/release-poll.sh`](../release-poll.sh) →
[`scripts/release-poll.mjs`](../release-poll.mjs) → `scripts/deploy.mjs`. **Supprime la
dépendance au poste de dev** (`remote-deploy.ps1`) tout en préservant la topologie
**pull-based** (rien d'entrant). Voir
[docs/exploitation/24 §9.3](../../docs/exploitation/24-plan-deploiement-serveur-ct-qdo.md).

> **Pendant PROD du poller staging.** Même architecture que la Phase 8 (§ ci-dessus),
> **garde-fous durcis** : ne déploie QUE des **versions semver figées + signées**
> (refus de `main`/`latest`/pré-release/draft), **roule en avant uniquement** (jamais
> de downgrade auto), et partage le **verrou prod** `/tmp/creche-deploy.lock` avec
> `remote-deploy` (aucun entrelacement). Un **rollback** reste un geste **manuel**
> (`remote-deploy.ps1 -ImageTag <version_précédente>`).

> **Clone de PROD (le même que remote-deploy).** Contrairement au staging (clone
> séparé), le poller release vise le clone de **prod** `/home/<user>/creche-planner`.
> Le `git pull --ff-only` y est déjà la norme (remote-deploy fait pareil) ; le verrou
> commun garantit qu'un poll et un déclenchement manuel ne s'entrelacent jamais.

## 1. Prérequis (déjà en place si la prod tourne)

```bash
cd /home/<user>/creche-planner
# .env.server rempli (GH_DEPLOYMENTS_TOKEN, IMAGE_TAG, DEPLOY_VERIFY_COSIGN=1, …)
# docker login ghcr.io déjà fait ; cosign installé dans ~/.local/bin
chmod +x scripts/release-poll.sh          # exécuté par systemd
```

> **Baseline.** Au 1er run, le poller initialise sa baseline (`~/.creche-last-deployed`)
> depuis le label OCI `image.version` du conteneur gateway **en place** → il ne
> redéploie pas la version déjà en prod. Pour forcer une baseline explicite :
> `echo 0.1.0 > ~/.creche-last-deployed`.

## 2. Adapter et installer les unités

Remplacer `<user>` (et le chemin du clone si différent) dans
[`creche-release-poll.service`](creche-release-poll.service) :
`WorkingDirectory`, `User`, `ExecStart`, `Environment=PATH`, `Documentation`,
`ReadWritePaths`. (Même remarque **PATH / node nvm-fnm** que pour le staging ci-dessus.)

```bash
sudo cp scripts/systemd/creche-release-poll.service /etc/systemd/system/
sudo cp scripts/systemd/creche-release-poll.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now creche-release-poll.timer
```

> **`sudo -n` indisponible ?** Les unités portent des placeholders `<user>` :
> `sed 's/<user>/edouard/g' scripts/systemd/creche-release-poll.service | sudo tee /etc/systemd/system/creche-release-poll.service` (idem `.timer`, sans `sed`).

## 3. Vérifier

```bash
# Prochaine échéance
systemctl list-timers creche-release-poll.timer

# Forcer un poll immédiat (déploie si une nouvelle release semver existe)
sudo systemctl start creche-release-poll.service
journalctl -u creche-release-poll.service -n 80 --no-pager

# Forcer un (re)déploiement de la release latest (test) :
cd /home/<user>/creche-planner && RELEASE_FORCE=1 ./scripts/release-poll.sh
```

Un tick sans nouvelle version journalise « Prod déjà à jour … ». Une nouvelle release
`0.x.y` déclenche `deploy.mjs` (portes + GitHub Deployment d'env `production` → DORA).
Un **échec** est **réessayé** jusqu'à `RELEASE_MAX_ATTEMPTS` (défaut 3) puis abandonné
(journal : « intervention requise ») — la prod restant saine via le **rollback auto**
(§9.4). Variables utiles : `RELEASE_FORCE=1`, `RELEASE_MAX_ATTEMPTS=<n>`,
`RELEASE_SKIP_PULL=1`, `DORA_DRY_RUN=1`.
