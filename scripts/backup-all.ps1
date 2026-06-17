#Requires -Version 5.1
<#
.SYNOPSIS
    Sauvegarde les 4 bases PostgreSQL du projet creche-planner via pg_dump.

.DESCRIPTION
    Exécute un pg_dump pour chacune des 4 bases (referentiel, foyer,
    planification, tarification) en passant par docker compose exec.
    Les dumps sont horodatés et placés dans un sous-dossier de $OutputDir.

.PARAMETER OutputDir
    Répertoire de sortie des dumps. Par défaut : .\backups (relatif au dossier
    du script, soit la racine du projet si appelé depuis là).

.PARAMETER Format
    Format pg_dump : 'custom' (défaut, binaire compressé, recommandé pour
    pg_restore) ou 'plain' (SQL texte).

.EXAMPLE
    .\scripts\backup-all.ps1
    .\scripts\backup-all.ps1 -OutputDir D:\backups\creche -Format plain

.NOTES
    Prérequis : Docker Desktop actif, pile démarrée (docker compose up -d).
    La commande doit être lancée depuis la racine du projet (là où se trouve
    docker-compose.yml) ou depuis le dossier scripts/.
#>
[CmdletBinding()]
param(
    [string]$OutputDir = '',
    [ValidateSet('custom', 'plain')]
    [string]$Format = 'custom'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Résolution du dossier racine du projet (parent de scripts/)
# ---------------------------------------------------------------------------
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

# Dossier de sortie
if ($OutputDir -eq '') {
    $OutputDir = Join-Path $ProjectDir 'backups'
}

# Horodatage ISO-8601 (remplace : par - pour compatibilité Windows FS)
$Timestamp = (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
$DumpDir   = Join-Path $OutputDir $Timestamp

if (-not (Test-Path $DumpDir)) {
    New-Item -ItemType Directory -Path $DumpDir | Out-Null
}

Write-Host "=== creche-planner backup-all ===" -ForegroundColor Cyan
Write-Host "Dossier de sortie : $DumpDir"
Write-Host "Format            : $Format"
Write-Host ""

# ---------------------------------------------------------------------------
# Définition des bases à sauvegarder
# (noms lus dans docker-compose.yml — ne pas modifier sans relire le fichier)
# ---------------------------------------------------------------------------
$Databases = @(
    @{ Service = 'postgres-referentiel';   User = 'referentiel';   DbName = 'referentiel'   },
    @{ Service = 'postgres-foyer';         User = 'foyer';         DbName = 'foyer'         },
    @{ Service = 'postgres-planification'; User = 'planification'; DbName = 'planification' },
    @{ Service = 'postgres-tarification';  User = 'tarification';  DbName = 'tarification'  }
)

$Extension = if ($Format -eq 'custom') { 'dump' } else { 'sql' }
$PgFormat  = if ($Format -eq 'custom') { 'c' }    else { 'p' }

$Errors = @()

foreach ($Db in $Databases) {
    $FileName = "$($Db.DbName)_$Timestamp.$Extension"
    $HostPath = Join-Path $DumpDir $FileName
    # Chemin Linux dans le conteneur (dossier temporaire monté via stdin/stdout)
    # On redirige la sortie standard de pg_dump vers le fichier hôte.

    Write-Host "-> Sauvegarde de $($Db.DbName) (service : $($Db.Service))..." -NoNewline

    try {
        # pg_dump écrit sur stdout ; on capture et redirige vers le fichier hôte.
        # PGPASSWORD transmis via -e pour éviter l'invite interactive.
        $env:PGPASSWORD = $Db.User  # même valeur que le user dans docker-compose.yml
        $dumpArgs = @(
            'compose', 'exec', '-T',
            '-e', "PGPASSWORD=$($Db.User)",
            $Db.Service,
            'pg_dump',
            '-U', $Db.User,
            '-d', $Db.DbName,
            '-F', $PgFormat
        )

        # Capture la sortie binaire/texte et écrit dans le fichier hôte
        & docker @dumpArgs | Set-Content -Path $HostPath -AsByteStream -ErrorAction Stop

        if ($LASTEXITCODE -ne 0) {
            throw "pg_dump a retourné le code $LASTEXITCODE"
        }

        $SizeKB = [math]::Round((Get-Item $HostPath).Length / 1KB, 1)
        Write-Host " OK ($SizeKB Ko)" -ForegroundColor Green
    }
    catch {
        Write-Host " ERREUR" -ForegroundColor Red
        Write-Warning "  $($_.Exception.Message)"
        $Errors += $Db.DbName
        # Supprime le fichier partiel s'il existe
        if (Test-Path $HostPath) { Remove-Item $HostPath -Force }
    }
    finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Résumé
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Résumé ===" -ForegroundColor Cyan
$Success = $Databases.Count - $Errors.Count
Write-Host "$Success/$($Databases.Count) bases sauvegardées dans : $DumpDir"

if ($Errors.Count -gt 0) {
    Write-Host "Bases en erreur : $($Errors -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "Sauvegarde terminée avec succès." -ForegroundColor Green
exit 0
