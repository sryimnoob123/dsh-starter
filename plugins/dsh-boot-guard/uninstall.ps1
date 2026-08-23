# dsh-boot-guard uninstaller
$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Test-GuardIdLine([string]$Line, [string]$ExpectedId) {
  if ($Line -notmatch '^-\s+id:\s*(.+?)\s*$') { return $false }
  $value = $Matches[1].Trim()
  if ($value.StartsWith('"')) {
    try { $value = ConvertFrom-Json -InputObject $value } catch { return $false }
  } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
    $value = $value.Substring(1, $value.Length - 2).Replace("''", "'")
  }
  return [string]::Equals([string]$value, $ExpectedId, [System.StringComparison]::Ordinal)
}

function Remove-EmptyInsertRows([string[]]$Lines) {
  $result = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -notmatch '^- insert:\s*$') {
      $result.Add($Lines[$i])
      continue
    }
    $j = $i + 1
    $hasContent = $false
    while ($j -lt $Lines.Count -and $Lines[$j] -notmatch '^-\s') {
      if ($Lines[$j].Trim() -and $Lines[$j] -notmatch '^\s*#') { $hasContent = $true }
      $j++
    }
    if ($hasContent) { $result.Add($Lines[$i]) }
  }
  return $result.ToArray()
}

$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileDir = Join-Path $DshHome 'profiles\web'
$PkgPath = Join-Path $ProfileDir 'package.json'
$PatchPath = Join-Path $ProfileDir 'cordis.patch.yml'

if (-not (Test-Path -LiteralPath $ProfileDir -PathType Container)) {
  throw "DSH web profile was not found: $ProfileDir"
}

if (Test-Path -LiteralPath $PatchPath -PathType Leaf) {
  $lines = [System.IO.File]::ReadAllLines($PatchPath)
  $filtered = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^# \[dsh-boot-guard\] skip-marker ([^\r\n]+)$') {
      $markerId = $Matches[1]
      $nextContent = $i + 3
      while ($nextContent -lt $lines.Count -and -not $lines[$nextContent].Trim()) { $nextContent++ }
      $hasIndentedContinuation = $nextContent -lt $lines.Count -and $lines[$nextContent] -match '^\s+\S'
      if ($i + 2 -lt $lines.Count -and (Test-GuardIdLine $lines[$i + 1] $markerId) -and $lines[$i + 2] -match '^\s{2}disabled:\s*true\s*$' -and -not $hasIndentedContinuation) {
        $i += 2
        continue
      }
    }
    if ($lines[$i] -match '^\s{4}- id:\s*boot-guard\s*$' -and $i + 1 -lt $lines.Count -and $lines[$i + 1] -match '^\s{6}name:\s*dsh-boot-guard\s*$') {
      $i++
      continue
    }
    $filtered.Add($lines[$i])
  }
  $clean = Remove-EmptyInsertRows $filtered.ToArray()
  $content = ($clean -join [Environment]::NewLine).TrimEnd()
  $hasPatchEntry = $false
  foreach ($line in $clean) {
    $trimmed = $line.Trim()
    if ($trimmed -and -not $trimmed.StartsWith('#') -and $trimmed -ne '---') {
      $hasPatchEntry = $true
      break
    }
  }
  if (-not $hasPatchEntry) {
    $content = if ($content) { $content + [Environment]::NewLine + '[]' } else { '[]' }
  }
  $content += [Environment]::NewLine
  Write-Utf8NoBom $PatchPath $content
  Write-Host '[1/2] Removed registration and restored all guard-managed skips.'
}

$pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpm) { $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue }
if (-not $pnpm) { throw 'pnpm is unavailable; dependencies and lockfile cannot be updated safely.' }

$installed = $false
if (Test-Path -LiteralPath $PkgPath -PathType Leaf) {
  $dependencies = (Get-Content -Raw -Encoding UTF8 -LiteralPath $PkgPath | ConvertFrom-Json).dependencies
  $installed = $dependencies -and $dependencies.PSObject.Properties['dsh-boot-guard']
}
if ($installed) {
  Push-Location $ProfileDir
  try {
    & $pnpm.Source remove dsh-boot-guard
    if ($LASTEXITCODE -ne 0) { throw 'pnpm remove dsh-boot-guard failed.' }
  } finally {
    Pop-Location
  }
}
Write-Host '[2/2] Removed dependency and updated lockfile.'
Write-Host 'Uninstall complete. Restart DSH Web to apply.'
