#Requires -Version 5.1
<#
.SYNOPSIS
    Restaure une base PostgreSQL creche-planner depuis un fichier dump.

.DESCRIPTION
    Restaure la base cible en utilisant pg_restore (format custom) ou psql
    (format plain SQL). La restauration se fait via docker compose exec.

    Par sécurité, le script n'effectue PAS de DROP/CREATE de la base par
    défaut. Pour écraser les données existantes, utilisez -Force.
    Avec -Force, le script demande confirmation interactive sauf si
    -Confirm:$false est passé.

.PARAMETER DbName
    Nom de la base cible. Valeurs : referentiel | foyer | planification | tarification

.PARAMETER DumpFile
    Chemin complet vers le fichier dump (.dump ou .sql) à restaurer.

.PARAMETER Force
    Efface le contenu existant avant de restaurer (pg_restore --clean ou DROP
    des tables pour SQL plain). Requiert confirmation sauf si -Confirm:$false.

.EXAMPLE
    .\scripts\restore-one.ps1 -DbName foyer -DumpFile .\backups\2026-06-04T10-00-00\foyer_2026-06-04T10-00-00.dump

    .\scripts\restore-one.ps1 -DbName foyer `
        -DumpFile .\backups\2026-06-04T10-00-00\foyer_2026-06-04T10-00-00.dump `
        -Force -Confirm:$false

.NOTES
    Prérequis : Docker Desktop actif, conteneur PostgreSQL cible démarré.
    La base doit déjà exister (les migrations Drizzle l'ont créée au boot).
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet('referentiel', 'foyer', 'planification', 'tarification')]
    [string]$DbName,

    [Parameter(Mandatory)]
    [string]$DumpFile,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Correspondance base → service docker-compose (lu dans docker-compose.yml)
# ---------------------------------------------------------------------------
$ServiceMap = @{
    'referentiel'   = 'postgres-referentiel'
    'foyer'         = 'postgres-foyer'
    'planification' = 'postgres-planification'
    'tarification'  = 'postgres-tarification'
}

$Service = $ServiceMap[$DbName]
$DbUser  = $DbName  # user == dbname dans ce projet

# ---------------------------------------------------------------------------
# Validation des paramètres
# ---------------------------------------------------------------------------
$DumpFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DumpFile)

if (-not (Test-Path $DumpFile)) {
    Write-Error "Fichier dump introuvable : $DumpFile"
    exit 2
}

$FileExt = [System.IO.Path]::GetExtension($DumpFile).ToLower()
if ($FileExt -notin @('.dump', '.sql')) {
    Write-Error "Extension non reconnue : '$FileExt'. Attendu : .dump (custom) ou .sql (plain)."
    exit 2
}

$IsBinaryFormat = ($FileExt -eq '.dump')

# ---------------------------------------------------------------------------
# Confirmation si -Force
# ---------------------------------------------------------------------------
if ($Force) {
    $msg = "ATTENTION : la restauration avec -Force va écraser les données existantes de la base '$DbName' (service $Service). Cette opération est IRREVERSIBLE sauf si vous avez une sauvegarde récente."
    if (-not $PSCmdlet.ShouldProcess($DbName, $msg)) {
        Write-Host "Restauration annulée." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host "=== creche-planner restore-one ===" -ForegroundColor Cyan
Write-Host "Base       : $DbName"
Write-Host "Service    : $Service"
Write-Host "Fichier    : $DumpFile"
Write-Host "Format     : $(if ($IsBinaryFormat) { 'custom (pg_restore)' } else { 'plain SQL (psql)' })"
Write-Host "Mode Force : $($Force.IsPresent)"
Write-Host ""

# ---------------------------------------------------------------------------
# Restauration
# ---------------------------------------------------------------------------
try {
    if ($IsBinaryFormat) {
        # --- Format custom : pg_restore ---
        $CleanFlag = if ($Force) { '--clean', '--if-exists' } else { @() }

        $restoreArgs = @(
            'compose', 'exec', '-T',
            '-e', "PGPASSWORD=$DbUser",
            $Service,
            'pg_restore',
            '-U', $DbUser,
            '-d', $DbName,
            '--no-owner',
            '--no-privileges',
            '--exit-on-error'
        ) + $CleanFlag

        Write-Host "Lancement de pg_restore..." -NoNewline
        Get-Content $DumpFile -AsByteStream | & docker @restoreArgs

        if ($LASTEXITCODE -ne 0) {
            throw "pg_restore a retourné le code $LASTEXITCODE"
        }
    }
    else {
        # --- Format plain SQL : psql ---
        $SingleTx = if ($Force) { '--single-transaction' } else { '--single-transaction' }

        $psqlArgs = @(
            'compose', 'exec', '-T',
            '-e', "PGPASSWORD=$DbUser",
            $Service,
            'psql',
            '-U', $DbUser,
            '-d', $DbName,
            $SingleTx
        )

        Write-Host "Lancement de psql..." -NoNewline
        Get-Content $DumpFile -Raw | & docker @psqlArgs

        if ($LASTEXITCODE -ne 0) {
            throw "psql a retourné le code $LASTEXITCODE"
        }
    }

    Write-Host " OK" -ForegroundColor Green
    Write-Host ""
    Write-Host "Restauration de '$DbName' terminée avec succès." -ForegroundColor Green
    exit 0
}
catch {
    Write-Host " ERREUR" -ForegroundColor Red
    Write-Error $_.Exception.Message
    exit 1
}
