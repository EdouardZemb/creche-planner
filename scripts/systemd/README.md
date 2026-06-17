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
