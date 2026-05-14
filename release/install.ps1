$ErrorActionPreference = "Stop"

$PluginId = "obsidian-local-audio-plus"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginFiles = @("main.js", "manifest.json", "styles.css")

foreach ($File in $PluginFiles) {
    $Source = Join-Path $ScriptDir $File
    if (-not (Test-Path $Source)) {
        throw "Missing plugin file: $Source"
    }
}

$ConfigCandidates = @()
if ($env:APPDATA) {
    $ConfigCandidates += Join-Path $env:APPDATA "Obsidian\obsidian.json"
}
if ($env:LOCALAPPDATA) {
    $ConfigCandidates += Join-Path $env:LOCALAPPDATA "Obsidian\obsidian.json"
}

$ConfigPath = $ConfigCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ConfigPath) {
    throw "Could not find Obsidian config. Install manually by copying this folder to <vault>\.obsidian\plugins\."
}

$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if (-not $Config.vaults) {
    throw "No Obsidian vaults found in $ConfigPath"
}

$Vaults = @()
foreach ($Property in $Config.vaults.PSObject.Properties) {
    $Vault = $Property.Value
    if ($Vault.path -and (Test-Path $Vault.path)) {
        $Vaults += $Vault
    }
}

if ($Vaults.Count -eq 0) {
    throw "No existing Obsidian vault path found in $ConfigPath"
}

$OpenVaults = @($Vaults | Where-Object { $_.open -eq $true })
if ($OpenVaults.Count -gt 0) {
    $TargetVault = $OpenVaults | Sort-Object -Property ts -Descending | Select-Object -First 1
} else {
    $TargetVault = $Vaults | Sort-Object -Property ts -Descending | Select-Object -First 1
}

$VaultPath = $TargetVault.path
$ObsidianDir = Join-Path $VaultPath ".obsidian"
$PluginsDir = Join-Path $ObsidianDir "plugins"
$TargetDir = Join-Path $PluginsDir $PluginId

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

foreach ($File in $PluginFiles) {
    Copy-Item -Force -Path (Join-Path $ScriptDir $File) -Destination (Join-Path $TargetDir $File)
}

$CommunityPluginsPath = Join-Path $ObsidianDir "community-plugins.json"
if (Test-Path $CommunityPluginsPath) {
    $Plugins = Get-Content $CommunityPluginsPath -Raw | ConvertFrom-Json
    if ($null -eq $Plugins) {
        $Plugins = @()
    }
} else {
    $Plugins = @()
}

$PluginList = @($Plugins)
if ($PluginList -notcontains $PluginId) {
    $PluginList += $PluginId
    $PluginList | ConvertTo-Json | Set-Content -Encoding UTF8 $CommunityPluginsPath
}

Write-Host "Installed $PluginId to:"
Write-Host $TargetDir
Write-Host "Restart Obsidian if the plugin is not visible immediately."
