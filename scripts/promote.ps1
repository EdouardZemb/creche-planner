#Requires -Version 5.1
<#
.SYNOPSIS
    PROMOTION staging → production (Phase 8) : vérifie que la version à figer est
    bien CELLE validée en staging, puis guide la coupe de release + le déploiement.

.DESCRIPTION
    La prod ne doit recevoir qu'une VERSION semver FIGÉE (immuable + signée),
    PROMUE depuis le staging — jamais le tag mutable `:main`. Ce script ne déploie
    rien et ne coupe rien tout seul (la coupe de release est IRRÉVERSIBLE) : il
    VÉRIFIE la propriété de sûreté clé puis IMPRIME le plan de promotion exact.

    Propriété vérifiée : « le staging est VERT » (main est déployable). Source de
    vérité = le DERNIER GitHub Deployment d'environnement `staging` (créé par
    scripts/deploy.mjs → DORA) et son dernier statut :

      - `success` → staging vert → promotion autorisée (le plan est imprimé).
      - autre (failure/error/pending) → staging non validé → refus sauf -Force.

    NB : avec le tag ROLLING `:main`, la ref d'un déploiement staging = le commit du
    dernier build de l'api-gateway (rebuild PAR SERVICE AFFECTÉ), pas forcément
    origin/main → comparer les SHA n'aurait pas de sens. C'est `pnpm nx release` qui
    fige origin/main HEAD (les 6 services) en une VERSION immuable + signée.

    N'EXÉCUTE PAS `nx release` ni le déploiement prod (coupe de release IRRÉVERSIBLE) :
    il imprime les commandes (avec les pièges connus) à lancer sciemment.
    Cf. docs/exploitation/24 §9.1 + §12.

.PARAMETER Version
    OBLIGATOIRE. Version semver à figer pour la prod (ex. « 0.2.0 »). Doit être
    NOUVELLE (supérieure à la dernière release).

.PARAMETER Force
    Autorise la promotion même si le dernier déploiement staging n'est pas vert.
    À n'utiliser qu'en connaissance de cause.

.PARAMETER Repo
    Dépôt GitHub (défaut : EdouardZemb/creche-planner).

.EXAMPLE
    .\scripts\promote.ps1 -Version 0.2.0

.NOTES
    Prérequis : gh CLI authentifié (`gh auth status`) et un clone à jour. Lit l'API
    GitHub Deployments (sortant) ; ne se connecte PAS au serveur.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Version,

    [switch]$Force,

    [string]$Repo = 'EdouardZemb/creche-planner'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z-]+)*$') {
    Write-Error "Version invalide : '$Version'. Attendu un semver (ex. 0.2.0)."
    exit 2
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error 'gh CLI introuvable. Installer GitHub CLI puis : gh auth login.'
    exit 2
}

Write-Host "=== creche-planner — promotion staging → production ===" -ForegroundColor Cyan
Write-Host "Depot   : $Repo"
Write-Host "Version : $Version`n"

# --- 1. Commit courant de main (référence à figer) --------------------------
Write-Host "→ git fetch origin main…" -ForegroundColor DarkGray
git fetch --quiet origin main
$mainSha = (git rev-parse origin/main).Trim()
Write-Host "origin/main = $mainSha"

# --- 2. État du DERNIER déploiement staging ---------------------------------
# Le plus récent d'abord (ordre par défaut de l'API). On lit SON dernier statut :
# c'est l'état COURANT du staging (un succès ancien ne rachète pas un échec récent).
Write-Host "→ État du dernier déploiement staging (GitHub Deployments)…" -ForegroundColor DarkGray
$deployments = gh api "repos/$Repo/deployments?environment=staging&per_page=10" | ConvertFrom-Json
if (-not $deployments -or @($deployments).Count -eq 0) {
    Write-Error ("Aucun déploiement staging trouvé. Le staging a-t-il déjà tourné ? " +
        "(poller systemd / remote-deploy.ps1 -Environment staging)")
    exit 1
}
$last = @($deployments)[0]
$lastStatuses = gh api "repos/$Repo/deployments/$($last.id)/statuses?per_page=1" | ConvertFrom-Json
$lastState = if (@($lastStatuses).Count -ge 1) { @($lastStatuses)[0].state } else { 'pending' }
$shaShort = $last.sha.Substring(0, [Math]::Min(12, $last.sha.Length))
$mainShort = $mainSha.Substring(0, [Math]::Min(12, $mainSha.Length))
Write-Host "dernier staging = Deployment #$($last.id) · ref $shaShort · cree $($last.created_at) · statut $lastState"

# --- 3. Propriété de sûreté : le staging est-il VERT ? ----------------------
# Avec le tag ROLLING `:main`, la ref d'un déploiement staging = le commit du
# dernier build de l'api-gateway (rebuild PAR SERVICE AFFECTÉ), pas forcément
# origin/main → comparer les SHA n'a pas de sens. La seule garantie qui compte :
# le dernier smoke staging est VERT (main est déployable). `nx release` figera, lui,
# origin/main HEAD pour les 6 services.
Write-Host ""
if ($lastState -ne 'success') {
    Write-Host "⚠️  Le dernier déploiement staging n'est PAS vert (statut : $lastState)." -ForegroundColor Yellow
    Write-Host "    Promouvoir figerait un main que le staging n'a pas validé." -ForegroundColor Yellow
    if (-not $Force) {
        Write-Host "`n    → Corrigez main / attendez un poll staging vert, ou relancez avec -Force." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "    -Force : promotion poursuivie malgré un staging non vert (assumé)." -ForegroundColor Yellow
}
else {
    Write-Host "✅ Dernier déploiement staging VERT (#$($last.id)) — main est déployable." -ForegroundColor Green
}
if ($last.sha -ne $mainSha) {
    Write-Host "  (i) ref staging $shaShort != origin/main $mainShort — normal avec le tag rolling :main." -ForegroundColor DarkGray
}

# --- 4. Plan de promotion (à exécuter sciemment) ----------------------------
$sep = '------------------------------------------------------------------------'
Write-Host "`n--- Plan de promotion (commandes a lancer) ---" -ForegroundColor Cyan
Write-Host $sep -ForegroundColor DarkGray
Write-Host '1) Couper la RELEASE TRAIN (6 projets, meme numero) sur main, puis pousser les tags :' -ForegroundColor Gray
Write-Host "     pnpm nx release $Version" -ForegroundColor White
Write-Host '   ! Pousser > 3 tags d''un coup ne declenche AUCUN run release.yml : pousser les' -ForegroundColor Gray
Write-Host "     6 tags par lots <= 3, ou : gh workflow run release.yml --ref <projet>@$Version" -ForegroundColor Gray
Write-Host "   => release.yml publie les 6 images :$Version immuables + signees cosign + 6 Releases." -ForegroundColor Gray
Write-Host ''
Write-Host '2) Attendre que release.yml soit VERT (build + Trivy + cosign + GitHub Releases) :' -ForegroundColor Gray
Write-Host '     gh run list --workflow release.yml' -ForegroundColor White
Write-Host ''
Write-Host '3) Deployer la version FIGEE en PRODUCTION (portes + DORA + rollback auto) :' -ForegroundColor Gray
Write-Host "     .\scripts\remote-deploy.ps1 -ImageTag $Version" -ForegroundColor White
Write-Host '   (cosign verifie la signature avant tout up ; rollback auto si une porte echoue.)' -ForegroundColor Gray
Write-Host $sep -ForegroundColor DarkGray
Write-Host 'La prod ne recoit ainsi qu''un artefact fige/signe, promu depuis un staging vert.' -ForegroundColor Green
