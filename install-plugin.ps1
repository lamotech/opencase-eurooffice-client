# Installs the OpenCase plugin into the current user's Euro-Office desktop app.
# The target folder is named after the GUID in config.json, which is where the
# desktop app looks for user-installed plugins.
#
# The plugin is taken from -Zip (dist\opencase-plugin.zip from
# package-plugin.ps1), or else from the folder this script is in: the repo, or
# the unpacked zip.
#
# Intune / logon script: run in the *user* context, since the plugin folder is
# per user, e.g.
#   powershell.exe -ExecutionPolicy Bypass -File install-plugin.ps1 -Zip opencase-plugin.zip -Url https://opencase.kommune.dk/
# Exit code 0 on success, 1 on failure. For detection, check that
#   %LOCALAPPDATA%\Euro-Office\DesktopEditors\data\sdkjs-plugins\{GUID}\config.json
# exists and holds the expected "version".
param(
    [string]$Zip,
    # Default OpenCase server, as install-server.sh --url. Users can still
    # change it under Indstillinger.
    [string]$Url,
    [string]$PluginsDir = "$env:LOCALAPPDATA\Euro-Office\DesktopEditors\data\sdkjs-plugins",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# The files that make up the plugin (the same as package-plugin.ps1 and
# install-server.sh copy).
$pluginFiles = @("config.json", "*.html", "scripts", "resources")

$unpacked = $null
try {
    if ($Url -and $Url -notmatch "^https?://") { throw "-Url must start with http:// or https://" }

    $source = $PSScriptRoot
    if ($Zip) {
        $unpacked = Join-Path ([IO.Path]::GetTempPath()) ("opencase-plugin-" + [guid]::NewGuid())
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $Zip).Path, $unpacked)
        $source = $unpacked
    }

    $config = Get-Content (Join-Path $source "config.json") -Raw | ConvertFrom-Json
    $folderName = $config.guid -replace "^asc\.", ""
    $target = Join-Path $PluginsDir $folderName

    # Run as SYSTEM (Intune's default), the plugin lands in the system profile,
    # where no user's Euro-Office finds it.
    if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
        Write-Warning "Running as SYSTEM: installing into $PluginsDir. Run in the user context to install for a user."
    }

    if (Get-Process -Name "editors" -ErrorAction SilentlyContinue) {
        Write-Warning "Euro-Office is running. Restart it after this script to load the changes."
    }

    if (Test-Path $target) { Remove-Item -Recurse -Force $target }

    if ($Uninstall) {
        Write-Host "Removed $($config.name) plugin from $target"
        exit 0
    }

    New-Item -ItemType Directory -Force $target | Out-Null
    foreach ($pattern in $pluginFiles) {
        Get-Item (Join-Path $source $pattern) -Force |
            Copy-Item -Destination $target -Recurse -Force
    }

    if ($Url) {
        $settings = Join-Path $target "scripts\settings.js"
        $text = [IO.File]::ReadAllText($settings)
        $quoted = 'var DEFAULT_URL = "' + $Url.Replace('\', '\\').Replace('"', '\"') + '";'
        $text = [regex]::Replace($text, 'var DEFAULT_URL = "[^"]*";', { param($m) $quoted })
        [IO.File]::WriteAllText($settings, $text)
    }

    Write-Host "Installed $($config.name) $($config.version) to $target"
    exit 0
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($unpacked -and (Test-Path $unpacked)) { Remove-Item -Recurse -Force $unpacked }
}
