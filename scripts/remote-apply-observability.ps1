#Requires -Version 5.1
<#
.SYNOPSIS
    Applique + verifie la pile d'OBSERVABILITE de production EN UNE COMMANDE depuis
    le poste de dev (Phase 9, cf. docs/exploitation/observabilite.md).

.DESCRIPTION
    Pendant obs de scripts/remote-deploy.ps1 : meme topologie PULL-BASED (rien
    d'expose en entrant ; SSH SORTANT), mais cible la CONFIG d'observabilite plutot
    que les images applicatives. Declenche, via SSH, le geste tracable cote serveur :

        flock (anti-concurrence, verrou DEDIE a l'obs)
          -> git fetch + git pull --ff-only   (recupere docker/** + compose + scripts)
          -> bash scripts/with-secrets.sh ...  (Phase 11 : dechiffre .env.server.enc
               sops+age en RAM ; l'obs prod consomme GRAFANA_ADMIN_PWD /
               GH_DEPLOYMENTS_TOKEN / ALERTMANAGER_SMTP_PASSWORD)
          -> node scripts/apply-observability.mjs
               (recreation --no-deps --force-recreate + verifications +
                GitHub Deployment env=observability => DORA)

    La tracabilite DORA est HERITEE de apply-observability.mjs. Ce wrapper n'ajoute
    aucun service expose et ne pousse RIEN en entrant sur le serveur.

    ACCES SSH (poste Windows) : la cle ~/.ssh/id_ed25519 est dechiffree dans le
    SERVICE Windows ssh-agent ; seul le ssh.exe natif de Windows le voit (le ssh de
    Git Bash echoue). Ce script appelle donc %WINDIR%\System32\OpenSSH\ssh.exe.

.PARAMETER VerifyOnly
    Ne recree PAS la pile (OBS_APPLY=0) : audite seulement l'etat courant
    (conteneurs, regles Prometheus, Alertmanager decouvert, datasource Infinity).

.PARAMETER Server
    Cible SSH (utilisateur@hote). Defaut : edouard@192.168.1.129.

.PARAMETER RepoPath
    Clone de deploiement sur le serveur. Defaut : /home/edouard/creche-planner.

.PARAMETER Services
    Sous-ensemble de services d'obs a recreer (OBS_SERVICES). Vide = pile d'obs
    complete (otel-collector tempo prometheus alertmanager nats-exporter
    blackbox-exporter grafana).

.PARAMETER Yes
    Saute la confirmation interactive [y/N].

.PARAMETER SkipPull
    Ne pas faire git pull --ff-only cote serveur avant d'appliquer.

.EXAMPLE
    # Appliquer + verifier toute la pile d'obs (cas nominal)
    .\scripts\remote-apply-observability.ps1

.EXAMPLE
    # Auditer l'etat courant SANS recreer
    .\scripts\remote-apply-observability.ps1 -VerifyOnly -Yes

.EXAMPLE
    # Ne recreer que prometheus + grafana (ex. apres un changement de datasource)
    .\scripts\remote-apply-observability.ps1 -Services 'prometheus grafana'

.NOTES
    Prerequis : cle chargee dans le service Windows ssh-agent
    (`& "$env:WINDIR\System32\OpenSSH\ssh-add.exe" -l` doit lister id_ed25519).
#>
[CmdletBinding()]
param(
    [switch]$VerifyOnly,
    [string]$Server = 'edouard@192.168.1.129',
    [string]$RepoPath = '/home/edouard/creche-planner',
    [string]$Services = '',
    [switch]$Yes,
    [switch]$SkipPull
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Validation des entrees (anti-injection : interpolees dans un script bash distant).
if ($RepoPath -notmatch '^[A-Za-z0-9._/-]+$') {
    Write-Error "RepoPath invalide : '$RepoPath'."
    exit 2
}
if ($Services -ne '' -and $Services -notmatch '^[A-Za-z0-9 _-]+$') {
    Write-Error "Services invalide : '$Services' (noms de services separes par des espaces)."
    exit 2
}

# Localiser le ssh.exe natif Windows (voit le service ssh-agent ; PAS celui de Git Bash).
$SshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $SshExe)) {
    Write-Error "ssh.exe Windows introuvable ($SshExe). Installer 'OpenSSH Client' (Fonctionnalites facultatives)."
    exit 2
}

# ---------------------------------------------------------------------------
# Construction du payload bash distant (verrou DEDIE a l'obs pour ne pas heurter
# un deploiement applicatif en cours). Encode base64 -> 'base64 -d | bash' pour
# eviter l'enfer de quoting PowerShell->ssh->bash (cf. memoire prod-server-access).
# ---------------------------------------------------------------------------
$PullBlock = if ($SkipPull) {
    "echo 'REMOTE: --skip-pull -> le clone n''est pas mis a jour.'"
} else {
    @"
echo 'REMOTE: git fetch + git pull --ff-only'
git fetch --tags --prune origin
git pull --ff-only
"@
}

$EnvAssign = if ($VerifyOnly) { 'OBS_APPLY=0 ' } else { '' }
$ServicesAssign = if ($Services -ne '') { "OBS_SERVICES='$Services' " } else { '' }

$RemoteScript = @"
set -euo pipefail
export PATH="`$HOME/.local/bin:`$PATH"
cd '$RepoPath'

# Verrou anti-concurrence DEDIE a l'obs (un apply-observability ne bloque pas un
# deploiement applicatif, et reciproquement).
exec 9>/tmp/creche-obs-apply.lock
if ! flock -n 9; then
  echo 'REMOTE: une application d''obs est DEJA en cours (verrou occupe) -- abandon.' >&2
  exit 69
fi

echo "REMOTE: hote=`$(hostname) pwd=`$(pwd)"
$PullBlock

echo "REMOTE: commit du clone = `$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
echo 'REMOTE: dechiffrement sops (with-secrets) + lancement de scripts/apply-observability.mjs (recreation + verifs + DORA)...'
bash scripts/with-secrets.sh env ${EnvAssign}${ServicesAssign}node scripts/apply-observability.mjs
"@

# Normalise en LF (serveur Linux) puis encode UTF-8 -> base64 mono-ligne.
$RemoteScript = $RemoteScript -replace "`r`n", "`n"
$B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($RemoteScript))
$RemoteCmd = "echo $B64 | base64 -d | bash"

# ---------------------------------------------------------------------------
# Recapitulatif + go/no-go humain
# ---------------------------------------------------------------------------
Write-Host "=== creche-planner -- application config observabilite (Phase 9) ===" -ForegroundColor Cyan
Write-Host "Serveur    : $Server"
Write-Host "Clone      : $RepoPath"
Write-Host "Mode       : $(if ($VerifyOnly) { 'VERIFICATION SEULE (OBS_APPLY=0)' } else { 'recreation + verification' })"
Write-Host "Services   : $(if ($Services -ne '') { $Services } else { '(pile d''obs complete)' })"
Write-Host "git pull   : $(if ($SkipPull) { 'NON (--skip-pull)' } else { 'oui (ff-only)' })"
Write-Host ""

if (-not $Yes) {
    $resp = Read-Host "Appliquer/verifier la config d'observabilite ? [y/N]"
    if ($resp -notmatch '^(y|yes|o|oui)$') {
        Write-Host "Annule." -ForegroundColor Yellow
        exit 0
    }
}

# ---------------------------------------------------------------------------
# Execution distante (sortie streamee en direct)
# ---------------------------------------------------------------------------
Write-Host "`n--- Sortie distante ($Server) ---`n" -ForegroundColor DarkGray
& $SshExe $Server $RemoteCmd
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
    Write-Host "[OK] Config d'observabilite appliquee et verifiee." -ForegroundColor Green
    Write-Host "     Trace DORA : gh api 'repos/EdouardZemb/creche-planner/deployments?environment=observability' --jq '.[0]'" -ForegroundColor DarkGray
} elseif ($code -eq 69) {
    Write-Host "[ATTENTE] Abandon : une application d'obs est deja en cours (verrou occupe)." -ForegroundColor Yellow
} else {
    Write-Host "[ECHEC] Application/verification echouee (code $code) -- voir la sortie distante ci-dessus." -ForegroundColor Red
}
exit $code
