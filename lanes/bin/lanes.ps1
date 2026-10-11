# Lane sessions for a project: a mid lane (tests, verification) and a low lane
# (search, scripts, crawling, notes), each its own Claude Code session.
#
#   lanes.ps1 start  [all|mid|low] [-Project <dir>]   open each lane in its own window
#   lanes.ps1 stop   [all|mid|low] [-Project <dir>]
#   lanes.ps1 status [-Project <dir>]
#
# Run it from a terminal you opened yourself, or let the lanes plugin run it
# (/lane start). A window opened from a Claude tool call inherits that call's
# child-session markers and never becomes a peer that can be messaged.
param(
  [ValidateSet('start', 'stop', 'status')][string]$Verb = 'status',
  [ValidateSet('all', 'mid', 'low')][string]$Which = 'all',
  [string]$Project = (Get-Location).Path,
  [string]$MidModel = 'claude-sonnet-5-5',
  [string]$MidFallback = 'claude-opus-5-5',
  [string]$MidEffort = 'high',
  [string]$MidCompact = '200k',
  [string]$LowModel = 'claude-haiku-5-5',
  [string]$LowFallback = '',
  [string]$LowEffort = 'medium',
  [string]$LowCompact = '150k',
  [ValidateSet('window', 'background')][string]$Launch = 'window',
  [string]$PermissionMode = 'auto'
)
$ErrorActionPreference = 'Stop'
$PluginRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Project = (Resolve-Path -LiteralPath $Project).Path
$Dir = Join-Path $Project '.claude\lanes'
$State = Join-Path $Dir 'state'
$ConfigHome = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Slug = ((Split-Path -Leaf $Project).ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
if (-not $Slug) { $Slug = 'project' }
$Tiers = if ($Which -eq 'all') { @('mid', 'low') } else { @($Which) }

$Cfg = @{
  mid = @{ Model = $MidModel; Fallback = $MidFallback; Effort = $MidEffort; Compact = $MidCompact }
  low = @{ Model = $LowModel; Fallback = $LowFallback; Effort = $LowEffort; Compact = $LowCompact }
}

function Get-Peer($name) {
  $dirPath = Join-Path $ConfigHome 'sessions'
  if (-not (Test-Path $dirPath)) { return $null }
  foreach ($f in Get-ChildItem -Path $dirPath -Filter '*.json') {
    try {
      $p = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($p.name -eq $name -and (Get-Process -Id $p.pid -ErrorAction SilentlyContinue)) { return $p }
    } catch { }
  }
  return $null
}

function Quote($s) { "'" + ($s -replace "'", "''") + "'" }

function Write-Prompt($tier) {
  $text = Get-Content -LiteralPath (Join-Path $PluginRoot "roles\$tier.md") -Raw -Encoding UTF8
  $text = $text.Replace('{{MID}}', "$Slug-mid").Replace('{{LOW}}', "$Slug-low")
  $text = $text.Replace('{{MID_MODEL}}', $MidModel).Replace('{{LOW_MODEL}}', $LowModel)
  $extra = Join-Path $Dir "roles\$tier.md"
  if (Test-Path -LiteralPath $extra) {
    $text += "`n`n## This project`n`n" + (Get-Content -LiteralPath $extra -Raw -Encoding UTF8)
  }
  $file = Join-Path $State "$tier.prompt.md"
  [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding $false))
  return $file
}

function Start-Lane($tier) {
  $name = "$Slug-$tier"
  $peer = Get-Peer $name
  if ($peer) { return "$name already running (pid $($peer.pid))" }
  $c = $Cfg[$tier]
  $argv = @('-n', $name, '--model', $c.Model, '--effort', $c.Effort, '--permission-mode', $PermissionMode,
    '--append-system-prompt-file', (Write-Prompt $tier))
  if ($c.Fallback -and $c.Fallback -ne 'none') { $argv += @('--fallback-model', $c.Fallback) }
  if ($c.Compact) { $argv += @('--autocompact', $c.Compact) }
  # Lanes report; code edits, commits, pushes and deploys stay with the main session.
  $argv += @('--disallowedTools', 'Edit', 'NotebookEdit', 'Bash(git commit:*)', 'Bash(git push:*)',
    'Bash(git reset:*)', 'Bash(git checkout:*)', 'PowerShell(git commit:*)', 'PowerShell(git push:*)',
    'PowerShell(git reset:*)', 'PowerShell(git checkout:*)')
  if ($Launch -eq 'background') { $argv = @('--bg') + $argv }

  $run = Join-Path $State "$tier.run.ps1"
  $lines = @(
    "`$Host.UI.RawUI.WindowTitle = $(Quote "$name - $($c.Model)")",
    "Set-Location -LiteralPath $(Quote $Project)",
    "`$env:CLAUDE_LANE = $(Quote $tier)",
    "`$started = Get-Date",
    "& claude $(($argv | ForEach-Object { Quote $_ }) -join ' ')"
  )
  if ($Launch -eq 'window') {
    $lines += "if (((Get-Date) - `$started).TotalSeconds -lt 20) { Read-Host 'claude exited early - press Enter to close' }"
  }
  [IO.File]::WriteAllText($run, ($lines -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $true))

  if ($Launch -eq 'window') {
    Start-Process powershell.exe -WorkingDirectory $Project -ArgumentList @('-ExecutionPolicy', 'Bypass', '-File', "`"$run`"") | Out-Null
  } else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $run
  }
  return "$name starting ($($c.Model), effort $($c.Effort)$(if ($c.Fallback -and $c.Fallback -ne 'none') { ", fallback $($c.Fallback)" }))"
}

function Stop-Lane($tier) {
  $name = "$Slug-$tier"
  $peer = Get-Peer $name
  if (-not $peer) { return "$name was not running" }
  & taskkill.exe /PID $peer.pid /T /F | Out-Null
  return "$name stopped (pid $($peer.pid))"
}

New-Item -ItemType Directory -Force -Path $State, (Join-Path $Dir 'out'), (Join-Path $Dir 'notes') | Out-Null
$ignore = Join-Path $Dir '.gitignore'
if (-not (Test-Path -LiteralPath $ignore)) { Set-Content -LiteralPath $ignore -Value '*' -Encoding ASCII }

foreach ($tier in $Tiers) {
  switch ($Verb) {
    'start' { Start-Lane $tier }
    'stop' { Stop-Lane $tier }
    'status' {
      $name = "$Slug-$tier"
      $peer = Get-Peer $name
      if ($peer) { "$name  $($peer.status)  pid $($peer.pid)" } else { "$name  off" }
    }
  }
}
