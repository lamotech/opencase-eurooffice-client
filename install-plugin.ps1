# Installs the OpenCase plugin into the current user's Euro-Office desktop app.
# The target folder is named after the GUID in config.json, which is where the
# desktop app looks for user-installed plugins.
param(
    [string]$PluginsDir = "$env:LOCALAPPDATA\Euro-Office\DesktopEditors\data\sdkjs-plugins",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Repo content that is not part of the plugin itself.
$exclude = @(".git", ".gitignore", ".prompts", ".vscode", "providers", "README.md", "*.ps1", "*.sh", "dist")

$config = Get-Content (Join-Path $PSScriptRoot "config.json") -Raw | ConvertFrom-Json
$folderName = $config.guid -replace "^asc\.", ""
$target = Join-Path $PluginsDir $folderName

if (Get-Process -Name "editors" -ErrorAction SilentlyContinue) {
    Write-Warning "Euro-Office is running. Restart it after this script to load the changes."
}

if (Test-Path $target) { Remove-Item -Recurse -Force $target }

if ($Uninstall) {
    Write-Host "Removed $($config.name) plugin from $target"
    exit
}

New-Item -ItemType Directory -Force $target | Out-Null
Get-ChildItem $PSScriptRoot -Force -Exclude $exclude |
    Copy-Item -Destination $target -Recurse -Force

Write-Host "Installed $($config.name) $($config.version) to $target"
