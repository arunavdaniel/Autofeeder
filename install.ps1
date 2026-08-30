# Autofeeder - One-Line Installer for Windows PowerShell
# Usage: iwr -useb https://raw.githubusercontent.com/arunav/rss-text-reader/main/install.ps1 | iex
# Or with options: & ([scriptblock]::Create((iwr -useb .../install.ps1))) --no-browser

param(
    [string]$Dir = "",
    [switch]$NoBrowser,
    [switch]$Offline,
    [string]$Bundle = "",
    [string]$Version = "",
    [string]$CaBundle = "",
    [switch]$Insecure,
    [switch]$Uninstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$InstallScriptUrl = "https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.py"

Write-Host ""
Write-Host "  Autofeeder Installer" -ForegroundColor Cyan
Write-Host "  Detecting Python..." -ForegroundColor DarkGray

# Find Python
function Find-Python {
    $candidates = @("python", "python3", "py")
    foreach ($cmd in $candidates) {
        try {
            $ver = & $cmd -c "import sys; v=sys.version_info; print(v.major*100+v.minor)" 2>$null
            if ($LASTEXITCODE -eq 0 -and [int]$ver -ge 310) {
                return $cmd
            }
        } catch {}
    }
    # Try py launcher (Windows Python Launcher)
    try {
        $ver = & py -3 -c "import sys; v=sys.version_info; print(v.major*100+v.minor)" 2>$null
        if ($LASTEXITCODE -eq 0 -and [int]$ver -ge 310) {
            return "py -3"
        }
    } catch {}
    return $null
}

$PythonCmd = Find-Python
if ($null -eq $PythonCmd) {
    Write-Host "  ERROR: Python 3.10+ not found." -ForegroundColor Red
    Write-Host "  Install from https://python.org (check 'Add to PATH' during setup)." -ForegroundColor Yellow
    Write-Host "  Then re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "  Found Python: $PythonCmd" -ForegroundColor Green

# Obtain install.py (check local file first before attempting network download)
$LocalInstaller = Join-Path -Path $PSScriptRoot -ChildPath "install.py"
if (-not [string]::IsNullOrEmpty($PSScriptRoot) -and (Test-Path $LocalInstaller)) {
    $TempFile = $LocalInstaller
    $CleanupTemp = $false
} else {
    Write-Host "  Downloading installer..." -ForegroundColor DarkGray
    $TempFile = [System.IO.Path]::GetTempFileName() + ".py"
    $CleanupTemp = $true
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
        $WebClient = New-Object System.Net.WebClient
        $WebClient.Proxy = [System.Net.WebRequest]::GetSystemWebProxy()
        $WebClient.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials
        $WebClient.DownloadFile($InstallScriptUrl, $TempFile)
    } catch {
        Write-Host "  Download failed: $_" -ForegroundColor Red
        Write-Host "  Try: Download install.py manually and run: python install.py" -ForegroundColor Yellow
        exit 1
    }
}

# Build argument list
$PyArgs = @($TempFile)
if ($Dir)       { $PyArgs += @("--dir", $Dir) }
if ($NoBrowser) { $PyArgs += "--no-browser" }
if ($Offline)   { $PyArgs += "--offline" }
if ($Bundle)    { $PyArgs += @("--bundle", $Bundle) }
if ($Version)   { $PyArgs += @("--version", $Version) }
if ($CaBundle)  { $PyArgs += @("--ca-bundle", $CaBundle) }
if ($Insecure)  { $PyArgs += "--insecure" }
if ($Uninstall) { $PyArgs += "--uninstall" }
if ($DryRun)    { $PyArgs += "--dry-run" }

try {
    if ($PythonCmd -eq "py -3") {
        & py -3 @PyArgs
    } else {
        & $PythonCmd @PyArgs
    }
    exit $LASTEXITCODE
} finally {
    if ($CleanupTemp -and (Test-Path $TempFile)) { Remove-Item $TempFile -Force }
}
