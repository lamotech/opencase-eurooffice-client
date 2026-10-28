# Builds dist\opencase-plugin.zip for installing the plugin on a Document Server.
# Copy the zip to the server, unzip it and run install-server.sh (see README).
$ErrorActionPreference = "Stop"

$config = Get-Content (Join-Path $PSScriptRoot "config.json") -Raw | ConvertFrom-Json
$dist = Join-Path $PSScriptRoot "dist"
$staging = Join-Path $dist "opencase-plugin"
$zip = Join-Path $dist "opencase-plugin.zip"

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null

$files = @("config.json", "scripts", "resources", "install-server.sh") +
    (Get-ChildItem $PSScriptRoot -Filter *.html | ForEach-Object Name)
foreach ($file in $files) {
    Copy-Item -Recurse (Join-Path $PSScriptRoot $file) $staging
}

# install-server.sh runs on Linux: make sure it has LF line endings.
$script = Join-Path $staging "install-server.sh"
[IO.File]::WriteAllText($script, ((Get-Content $script -Raw) -replace "`r`n", "`n"))

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
