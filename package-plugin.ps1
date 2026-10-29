# Builds dist\opencase-plugin.zip, the one package for every install (see README):
# - Document Server: unzip it on the server and run install-server.sh;
# - Windows desktop: install-plugin.ps1 -Zip opencase-plugin.zip, or run
#   install-plugin.ps1 from the unpacked zip;
# - Linux desktop: sh install-plugin.sh --zip opencase-plugin.zip, or run it
#   from the unpacked zip.
$ErrorActionPreference = "Stop"

$config = Get-Content (Join-Path $PSScriptRoot "config.json") -Raw | ConvertFrom-Json
$dist = Join-Path $PSScriptRoot "dist"
$staging = Join-Path $dist "opencase-plugin"
$zip = Join-Path $dist "opencase-plugin.zip"

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null

$files = @("config.json", "scripts", "resources", "install-server.sh", "install-plugin.sh", "install-plugin.ps1") +
    (Get-ChildItem $PSScriptRoot -Filter *.html | ForEach-Object Name)
foreach ($file in $files) {
    Copy-Item -Recurse (Join-Path $PSScriptRoot $file) $staging
}

# The shell scripts run on Linux: make sure they have LF line endings.
foreach ($name in @("install-server.sh", "install-plugin.sh")) {
    $script = Join-Path $staging $name
    [IO.File]::WriteAllText($script, ((Get-Content $script -Raw) -replace "`r`n", "`n"))
}

if (Test-Path $zip) { Remove-Item -Force $zip }
# Not Compress-Archive: in Windows PowerShell 5.1 it stores "\" in entry names,
# which unzip on Linux turns into file names instead of folders.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem $staging -Recurse -File | ForEach-Object {
        $entry = $_.FullName.Substring($staging.Length + 1).Replace("\", "/")
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry) | Out-Null
    }
} finally {
    $archive.Dispose()
}
Remove-Item -Recurse -Force $staging

Write-Host "Created $zip ($($config.name) $($config.version))"
