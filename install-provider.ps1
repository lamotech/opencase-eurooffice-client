# Installs the OpenCase DMS provider into the Euro-Office desktop app.
# Program Files is write-protected, so the script re-launches itself elevated.
param(
    [string]$InstallDir = "$env:ProgramFiles\Euro-Office\DesktopEditors"
)

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`"", "-InstallDir", "`"$InstallDir`""
    )
    exit
}

$source = Join-Path $PSScriptRoot "providers\opencase"
$target = Join-Path $InstallDir "providers\opencase"

if (-not (Test-Path (Join-Path $InstallDir "providers"))) {
    Write-Error "No providers folder in '$InstallDir'. Pass -InstallDir with the Euro-Office DesktopEditors folder."
    exit 1
}

if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Copy-Item -Recurse $source $target
Write-Host "Installed OpenCase provider to $target. Restart Euro-Office to load it."
