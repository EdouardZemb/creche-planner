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

    Propriété vérifiée : « on fige exactement ce que le staging a fumé avec succès ».
    Source de vérité = le dernier GitHub Deployment d'environnement `staging` au
    statut `success` (créé par scripts/deploy.mjs → DORA). Son `sha` est le commit
    réellement déployé/fumé en staging. On le compare à `origin/main` :

      - ÉGAL (cas nominal : le poller a déployé le dernier main, smokes verts, main
        n'a pas bougé) → promotion SÛRE : figer ce commit.
      - DIFFÉRENT (main a avancé depuis le dernier succès staging) → la version
        figerait un commit NON validé tel quel en staging → refus sauf -Force.

    N'EXÉCUTE PAS `nx release` ni le déploiement prod : il imprime les commandes
    (avec les pièges connus) à lancer sciemment. Cf. docs/exploitation/24 §9.1 + §12.

.PARAMETER Version
    OBLIGATOIRE. Version semver à figer pour la prod (ex. « 0.2.0 »). Doit être
    NOUVELLE (supérieure à la dernière release).

.PARAMETER Force
    Autorise la promotion même si le dernier succès staging ne correspond pas à
    `origin/main` (main a bougé). À n'utiliser qu'en connaissance de cause.

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

# --- 2. Dernier déploiement staging au statut success -----------------------
# On parcourt les déploiements d'env staging du plus récent au plus ancien et on
# s'arrête au premier dont le DERNIER statut vaut `success`.
Write-Host "→ Recherche du dernier succès staging (GitHub Deployments)…" -ForegroundColor DarkGray
$deployments = gh api "repos/$Repo/deployments?environment=staging&per_page=30" | ConvertFrom-Json
$stagingSha = $null
$stagingId = $null
foreach ($d in $deployments) {
    $statuses = gh api "repos/$Repo/deployments/$($d.id)/statuses?per_page=1" | ConvertFrom-Json
    if ($statuses.Count -ge 1 -and $statuses[0].state -eq 'success') {
        $stagingSha = $d.sha
        $stagingId = $d.id
        break
    }
}
if (-not $stagingSha) {
    Write-Error ("Aucun déploiement staging `success` trouvé. Le staging a-t-il déjà fumé un " +
        "`:main` avec succès ? (poller systemd / remote-deploy.ps1 -Environment staging)")
    exit 1
}
Write-Host "dernier staging success = $stagingSha (Deployment #$stagingId)"

# --- 3. Vérification de la propriété de sûreté ------------------------------
Write-Host ""
if ($stagingSha -eq $mainSha) {
    Write-Host "✅ Le dernier succès staging EST origin/main : promotion sûre (on fige ce commit)." -ForegroundColor Green
}
else {
    Write-Host "⚠️  Le dernier succès staging ($stagingSha) DIFFÈRE de origin/main ($mainSha)." -ForegroundColor Yellow
    Write-Host "    main a avancé depuis le dernier smoke staging vert. Figer maintenant gèlerait"  -ForegroundColor Yellow
    Write-Host "    un commit NON validé tel quel en staging." -ForegroundColor Yellow
    if (-not $Force) {
        Write-Host "`n    → Attendez que le poller déploie/fume le main courant en staging, ou relancez avec -Force." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "    -Force : promotion poursuivie malgré l'écart (assumé)." -ForegroundColor Yellow
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
