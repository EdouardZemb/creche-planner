#Requires -Version 5.1
<#
.SYNOPSIS
    Déclenche un déploiement de PRODUCTION traçable EN UNE COMMANDE depuis le
    poste de dev (Phase 3 du plan de déploiement, cf. docs/exploitation/24 §9.2).

.DESCRIPTION
    Le déploiement reste PULL-BASED : la topologie réseau interdit qu'un runner
    GitHub pousse en SSH (aucun port entrant ; Cloudflare Tunnel sortant ; deploy
    key git-only — cf. docs/26-instrumentation-dora-aud-08.md §1-2). L'événement
    de déploiement doit donc NAÎTRE sur le serveur. Ce script se contente de
    DÉCLENCHER, via SSH, le geste déjà traçable côté serveur :

        flock (anti-concurrence)
          → git fetch + git pull --ff-only   (rattrape outillage/compose)
          → set -a; source .env.server; set +a
          → IMAGE_TAG=<version> node scripts/deploy.mjs   (portes + GitHub Deployment → DORA)

    La traçabilité DORA est donc HÉRITÉE de scripts/deploy.mjs : ce wrapper
    n'ajoute aucun service exposé et ne pousse RIEN en entrant sur le serveur.

    GARDE-FOU HUMAIN : confirmation interactive [y/N] avant d'agir (sautable avec
    -Yes). IMAGE_TAG est OBLIGATOIRE et le tag mutable « main »/« latest » est
    REFUSÉ par défaut (-AllowMain pour forcer) : on ne déploie qu'un artefact
    figé et signé (Phase 2 — versions semver immuables, cosign).

    ACCÈS SSH (spécifique à ce poste Windows) : la clé ~/.ssh/id_ed25519 est
    chiffrée et déchiffrée dans le SERVICE Windows ssh-agent. Seul le ssh.exe
    natif de Windows voit cet agent — le ssh de Git Bash échoue
    (« Permission denied (publickey) »). Ce script appelle donc explicitement
    %WINDIR%\System32\OpenSSH\ssh.exe. C'est pourquoi la variante .ps1 est la
    voie sur CE poste ; remote-deploy.sh ne convient qu'à un opérateur Linux/Mac
    dont la clé est dans un agent POSIX.

.PARAMETER ImageTag
    Tag d'image / version à déployer (ex. « 0.1.0 »). Devient IMAGE_TAG côté
    serveur. OBLIGATOIRE en production ; en staging, défaut « main ». En
    production, le tag mutable « main »/« latest » exige -AllowMain.

.PARAMETER Environment
    « production » (défaut) ou « staging » (Phase 8). En staging : clone séparé
    (/home/edouard/creche-planner-staging), env-file .env.staging (qui porte
    DEPLOY_COMPOSE_FILES/DEPLOY_UP_SERVICES/DEPLOY_ENVIRONMENT=staging/ROLLBACK=0),
    verrou flock dédié, et le tag rolling « main » est ACCEPTÉ sans -AllowMain.
    Routine : le poller systemd auto-déploie le staging ; ce déclencheur sert au
    bootstrap ou à forcer un tag précis en staging.

.PARAMETER DeployRef
    Optionnel. Ref explicite (SHA/tag) consigné sur le GitHub Deployment (clé du
    lead time DORA). À renseigner surtout pour un ROLLBACK vers un SHA brut
    (DEPLOY_REF=<sha>). Par défaut, deploy.mjs résout le SHA depuis le label OCI
    de l'image gateway tirée — ne pas le forcer pour un déploiement de version.

.PARAMETER Server
    Cible SSH (utilisateur@hôte). Défaut : edouard@192.168.1.129.

.PARAMETER RepoPath
    Chemin du clone de déploiement sur le serveur. Défaut : /home/edouard/creche-planner.

.PARAMETER Yes
    Saute la confirmation interactive (pour scripts/CI). Sans ce flag, le go/no-go
    humain est demandé.

.PARAMETER AllowMain
    Autorise le déploiement du tag MUTABLE « main »/« latest » (déconseillé :
    artefact non figé). Sans ce flag, un tel ImageTag est refusé.

.PARAMETER SkipPull
    Ne pas faire « git pull --ff-only » côté serveur avant de déployer. Utile si
    le clone est volontairement sur un tag détaché (HEAD détaché → un pull
    échouerait), ou pour figer l'outillage. L'IMAGE_TAG sélectionne de toute
    façon l'artefact ; le clone ne fournit que compose + scripts de portes.

.EXAMPLE
    # Déploiement d'une version figée (cas nominal)
    .\scripts\remote-deploy.ps1 -ImageTag 0.1.0

.EXAMPLE
    # Rollback tracé vers un SHA antérieur publié sur GHCR (sans confirmation)
    .\scripts\remote-deploy.ps1 -ImageTag 0e5e59e -DeployRef 0e5e59e -Yes

.EXAMPLE
    # Forcer le tag rolling mutable en PRODUCTION (déconseillé)
    .\scripts\remote-deploy.ps1 -ImageTag main -AllowMain

.EXAMPLE
    # Déclencher un déploiement STAGING de `:main` (bootstrap / forçage manuel ;
    # la routine est le poller systemd). ImageTag défaut « main », pas de -AllowMain.
    .\scripts\remote-deploy.ps1 -Environment staging
    .\scripts\remote-deploy.ps1 -Environment staging -ImageTag <sha> -Yes

.NOTES
    Prérequis : clé chargée dans le service Windows ssh-agent
    (`& "$env:WINDIR\System32\OpenSSH\ssh-add.exe" -l` doit lister id_ed25519 ;
    sinon `ssh-add ~/.ssh/id_ed25519` une fois). Le serveur doit avoir cosign
    dans ~/.local/bin (DEPLOY_VERIFY_COSIGN=1) — le script l'ajoute au PATH pour
    le run SSH non-interactif.
#>
[CmdletBinding()]
param(
    # Optionnel : en staging, défaut « main » (la pile staging SUIT le tag rolling).
    # En production, OBLIGATOIRE (on ne déploie qu'un artefact figé/signé).
    [string]$ImageTag = '',

    [ValidateSet('production', 'staging')]
    [string]$Environment = 'production',

    [string]$DeployRef = '',

    [string]$Server = 'edouard@192.168.1.129',

    # Vide => défaut dérivé de -Environment (prod : creche-planner ; staging :
    # creche-planner-staging — clone SÉPARÉ pour ne pas mêler les arbres de travail).
    [string]$RepoPath = '',

    [switch]$Yes,

    [switch]$AllowMain,

    [switch]$SkipPull
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Résolution selon l'environnement (production | staging). Le STAGING (Phase 8)
# vise un CLONE SÉPARÉ, source .env.staging (qui porte DEPLOY_COMPOSE_FILES /
# DEPLOY_UP_SERVICES / DEPLOY_ENVIRONMENT=staging / ROLLBACK=0) et SUIT le tag
# rolling « main ». Verrou flock dédié pour ne pas heurter un déploiement prod.
# ---------------------------------------------------------------------------
if ($Environment -eq 'staging') {
    if ($ImageTag -eq '') { $ImageTag = 'main' }
    if ($RepoPath -eq '') { $RepoPath = '/home/edouard/creche-planner-staging' }
    $EnvFile = '.env.staging'
    $LockFile = '/tmp/creche-staging-deploy.lock'
}
else {
    if ($RepoPath -eq '') { $RepoPath = '/home/edouard/creche-planner' }
    $EnvFile = '.env.server'
    $LockFile = '/tmp/creche-deploy.lock'
}

# ---------------------------------------------------------------------------
# Validation des entrées (anti-injection : ces valeurs sont interpolées dans un
# script bash distant). On n'accepte que des refs Git/tags d'image plausibles.
# ---------------------------------------------------------------------------
$SafeRef = '^[A-Za-z0-9][A-Za-z0-9._/-]*$'

if ($ImageTag -eq '') {
    Write-Error "ImageTag est OBLIGATOIRE en production (déployez une version figée, ex. -ImageTag 0.1.0)."
    exit 2
}

if ($ImageTag -notmatch $SafeRef) {
    Write-Error "ImageTag invalide : '$ImageTag'. Attendu : un tag/SHA (alphanumérique, . _ / -)."
    exit 2
}
if ($DeployRef -ne '' -and $DeployRef -notmatch $SafeRef) {
    Write-Error "DeployRef invalide : '$DeployRef'. Attendu : un tag/SHA (alphanumérique, . _ / -)."
    exit 2
}
if ($RepoPath -notmatch "^[A-Za-z0-9._/-]+$") {
    Write-Error "RepoPath invalide : '$RepoPath'."
    exit 2
}

# Refus du tag MUTABLE en PRODUCTION : on n'y déploie qu'un artefact figé/signé.
# En STAGING, le tag rolling « main » est au contraire ATTENDU (c'est le sujet de
# la pile staging) → pas de refus.
if ($Environment -eq 'production' -and $ImageTag -in @('main', 'latest') -and -not $AllowMain) {
    Write-Error ("ImageTag « $ImageTag » est un tag MUTABLE (artefact non figé). " +
        "Déployez une version semver figée (ex. -ImageTag 0.1.0) ou forcez avec -AllowMain.")
    exit 2
}

# Localiser le ssh.exe natif Windows (voit le service ssh-agent ; PAS celui de Git Bash).
$SshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $SshExe)) {
    Write-Error "ssh.exe Windows introuvable ($SshExe). Installer « OpenSSH Client » (Fonctionnalités facultatives)."
    exit 2
}

# ---------------------------------------------------------------------------
# Construction du payload bash distant.
#   - flock non bloquant : refuse une exécution concurrente (garde-fou Phase 3).
#   - PATH enrichi de ~/.local/bin : cosign (DEPLOY_VERIFY_COSIGN=1) y est installé.
#   - IMAGE_TAG/DEPLOY_REF passés SUR la ligne node → priment sur l'env-file.
# Le script est encodé en base64 puis « base64 -d | bash » côté serveur : on
# évite tout enfer de quoting PowerShell→ssh→bash (cf. mémoire prod-server-access).
# ---------------------------------------------------------------------------
$PullBlock = if ($SkipPull) {
    "echo 'REMOTE: --skip-pull → le clone n''est pas mis a jour (IMAGE_TAG selectionne l''artefact).'"
} else {
    @"
echo 'REMOTE: git fetch + git pull --ff-only'
git fetch --tags --prune origin
git pull --ff-only
"@
}

$DeployRefAssign = if ($DeployRef -ne '') { "DEPLOY_REF='$DeployRef' " } else { '' }

$RemoteScript = @"
set -euo pipefail
export PATH="`$HOME/.local/bin:`$PATH"
cd '$RepoPath'

# Verrou anti-concurrence (dédié à l'environnement : prod et staging ont des
# verrous DISTINCTS → un déploiement staging ne bloque pas la prod, et réciproquement).
exec 9>$LockFile
if ! flock -n 9; then
  echo 'REMOTE: un deploiement est DEJA en cours (verrou $LockFile occupe) — abandon.' >&2
  exit 69
fi

echo "REMOTE: hote=`$(hostname) pwd=`$(pwd)"
$PullBlock

echo "REMOTE: commit du clone = `$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
set -a
. ./$EnvFile
set +a

echo 'REMOTE: lancement de scripts/deploy.mjs (portes + GitHub Deployment → DORA)…'
IMAGE_TAG='$ImageTag' ${DeployRefAssign}node scripts/deploy.mjs
"@

# Normalise en LF (le serveur est Linux) puis encode UTF-8 → base64 mono-ligne.
$RemoteScript = $RemoteScript -replace "`r`n", "`n"
$B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($RemoteScript))
$RemoteCmd = "echo $B64 | base64 -d | bash"

# ---------------------------------------------------------------------------
# Récapitulatif + go/no-go humain
# ---------------------------------------------------------------------------
$EnvLabel = $Environment.ToUpper()
Write-Host "=== creche-planner — declencheur de deploiement ($EnvLabel) ===" -ForegroundColor Cyan
Write-Host "Environnement : $EnvLabel"
Write-Host "Serveur       : $Server"
Write-Host "Clone         : $RepoPath"
Write-Host "Env-file      : $EnvFile"
Write-Host "IMAGE_TAG     : $ImageTag$(if ($ImageTag -in @('main','latest')) { '   (rolling/MUTABLE)' })"
if ($DeployRef -ne '') { Write-Host "DEPLOY_REF    : $DeployRef" }
Write-Host "git pull      : $(if ($SkipPull) { 'NON (--skip-pull)' } else { 'oui (ff-only)' })"
Write-Host ""

if (-not $Yes) {
    $resp = Read-Host "Declencher le deploiement en $EnvLabel ? [y/N]"
    if ($resp -notmatch '^(y|yes|o|oui)$') {
        Write-Host "Annule." -ForegroundColor Yellow
        exit 0
    }
}

# ---------------------------------------------------------------------------
# Exécution distante (sortie streamée en direct)
# ---------------------------------------------------------------------------
Write-Host "`n--- Sortie distante ($Server) ---`n" -ForegroundColor DarkGray
& $SshExe $Server $RemoteCmd
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
    Write-Host "✅ Deploiement $EnvLabel declenche avec succes (IMAGE_TAG=$ImageTag)." -ForegroundColor Green
    Write-Host "   Verifier la trace DORA : gh api repos/EdouardZemb/creche-planner/deployments --jq '.[0]'" -ForegroundColor DarkGray
} elseif ($code -eq 69) {
    Write-Host "⏳ Abandon : un deploiement est deja en cours sur le serveur (verrou occupe)." -ForegroundColor Yellow
} else {
    Write-Host "❌ Echec du deploiement (code $code) — voir la sortie distante ci-dessus." -ForegroundColor Red
}
exit $code
