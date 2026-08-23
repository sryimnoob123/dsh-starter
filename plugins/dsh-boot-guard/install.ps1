# dsh-boot-guard installer
$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-SignificantPatchIndexes([string[]]$Lines) {
  $indexes = New-Object System.Collections.Generic.List[int]
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $trimmed = $Lines[$i].Trim()
    if ($trimmed -and -not $trimmed.StartsWith('#') -and $trimmed -ne '---') { $indexes.Add($i) }
  }
  return $indexes.ToArray()
}

function Normalize-TopLevelPatchArray([string]$Content) {
  $newline = if ($Content.Contains("`r`n")) { "`r`n" } else { "`n" }
  [string[]]$lines = [regex]::Split($Content, "`r`n|`n|`r")
  $documentStarts = New-Object System.Collections.Generic.List[int]
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -eq '---') { $documentStarts.Add($i) }
  }
  $markerAfterContent = $false
  if ($documentStarts.Count) {
    for ($i = 0; $i -lt $documentStarts[0]; $i++) {
      $trimmed = $lines[$i].Trim()
      if ($trimmed -and -not $trimmed.StartsWith('#')) { $markerAfterContent = $true; break }
    }
  }
  if ($documentStarts.Count -gt 1 -or $markerAfterContent) {
    throw 'cordis.patch.yml must contain one top-level YAML document; installation stopped without modifying it.'
  }
  [int[]]$significant = @(Get-SignificantPatchIndexes $lines)
  if ($significant.Count -and $lines[$significant[0]] -match '^\[\]\s*(?:#.*)?$') {
    $kept = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($i -ne $significant[0]) { $kept.Add($lines[$i]) }
    }
    $lines = $kept.ToArray()
    $significant = @(Get-SignificantPatchIndexes $lines)
  }
  if ($significant.Count -and $lines[$significant[0]] -notmatch '^-($|\s)') {
    throw 'cordis.patch.yml must contain a top-level YAML array; installation stopped without modifying it.'
  }
  foreach ($index in $significant) {
    if ($lines[$index] -notmatch '^\s' -and $lines[$index] -notmatch '^-($|\s)') {
      throw 'cordis.patch.yml contains unsupported top-level YAML content; installation stopped without modifying it.'
    }
  }
  return ($lines -join $newline)
}

$PluginDir = [System.IO.Path]::GetFullPath($PSScriptRoot)
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileDir = Join-Path $DshHome 'profiles\web'
$PkgPath = Join-Path $ProfileDir 'package.json'
$PatchPath = Join-Path $ProfileDir 'cordis.patch.yml'
$LocalPluginDir = [System.IO.Path]::GetFullPath((Join-Path $DshHome 'local-plugins\dsh-boot-guard'))

if (-not (Test-Path -LiteralPath $ProfileDir -PathType Container)) {
  throw "DSH web profile was not found: $ProfileDir. Run npx @deepseek-ai/dsh web once first."
}
if (-not (Test-Path -LiteralPath $PkgPath -PathType Leaf)) {
  throw "Profile package.json was not found: $PkgPath"
}

$originalPatch = if (Test-Path -LiteralPath $PatchPath -PathType Leaf) {
  [System.IO.File]::ReadAllText($PatchPath)
} else {
  '[]'
}
$patch = Normalize-TopLevelPatchArray $originalPatch

$pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpm) { $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue }
if (-not $pnpm) {
  corepack enable pnpm 2>$null
  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if (-not $pnpm) { $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue }
}
if (-not $pnpm) { throw 'pnpm is unavailable. Run corepack enable pnpm first.' }

$dependencies = (Get-Content -Raw -Encoding UTF8 -LiteralPath $PkgPath | ConvertFrom-Json).dependencies
$alreadyInstalled = $dependencies -and $dependencies.PSObject.Properties['dsh-boot-guard']

# Keep the file dependency on the same drive as the DSH profile. pnpm can
# otherwise create malformed Windows junctions for a source package on a
# different drive (for example C:\profile\E:\plugin).
$samePluginLocation = [string]::Equals($PluginDir.TrimEnd('\'), $LocalPluginDir.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
if (-not $samePluginLocation -and (Test-Path -LiteralPath $LocalPluginDir)) {
  $localPluginItem = Get-Item -LiteralPath $LocalPluginDir -Force
  if ($localPluginItem.LinkType -and $localPluginItem.Target) {
    foreach ($target in @($localPluginItem.Target)) {
      $resolvedTarget = [System.IO.Path]::GetFullPath($target).TrimEnd('\')
      if ([string]::Equals($PluginDir.TrimEnd('\'), $resolvedTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
        $samePluginLocation = $true
        break
      }
    }
  }
}
if (-not $samePluginLocation) {
  New-Item -ItemType Directory -Force -Path $LocalPluginDir | Out-Null
  Copy-Item -Path (Join-Path $PluginDir '*') -Destination $LocalPluginDir -Recurse -Force
}
$depPath = $LocalPluginDir -replace '\\', '/'

Push-Location $ProfileDir
try {
  if ($alreadyInstalled) {
    & $pnpm.Source remove dsh-boot-guard
    if ($LASTEXITCODE -ne 0) { throw 'pnpm remove dsh-boot-guard failed.' }
  }
  & $pnpm.Source add "file:$depPath"
  if ($LASTEXITCODE -ne 0) { throw 'pnpm add dsh-boot-guard failed.' }
} finally {
  Pop-Location
}
Write-Host "[1/2] Refreshed local dependency: file:$depPath"

if ($patch -notmatch '(?m)^\s*name:\s*dsh-boot-guard\s*$') {
  $row = @('- insert:', '    - id: boot-guard', '      name: dsh-boot-guard') -join [Environment]::NewLine
  if ([string]::IsNullOrWhiteSpace($patch)) {
    $patch = $row + [Environment]::NewLine
  } else {
    $patch = $patch.TrimEnd() + [Environment]::NewLine + $row + [Environment]::NewLine
  }
  Write-Utf8NoBom $PatchPath $patch
  Write-Host '[2/2] Registered boot-guard.'
} else {
  if ($patch -cne $originalPatch) { Write-Utf8NoBom $PatchPath $patch }
  Write-Host '[2/2] boot-guard is already registered.'
}

Write-Host 'Installation complete. Restart DSH Web to apply.'
