# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 jysvai

# Lane sessions for a project: a mid lane (side work that needs judgement) and a low lane
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
  [string]$Name = '',
  [string]$PluginRoot = '',
  [string]$MidModel = 'claude-sonnet-5-5',
  [string]$MidFallback = 'claude-opus-5-5',
  [string]$MidEffort = 'high',
  [string]$MidCompact = '200k',
  [string]$LowModel = 'claude-haiku-5-5',
  [string]$LowFallback = 'claude-sonnet-5-5',
  [string]$LowEffort = 'medium',
  [string]$LowCompact = '150k',
  [ValidateSet('window', 'background')][string]$Launch = 'window',
  [string]$PermissionMode = 'auto',
  [ValidateSet('auto', 'developer', 'planner', 'beginner')][string]$Style = 'auto'
)
$ErrorActionPreference = 'Stop'
# The plugin runs this script's text as a script block (see psCommand in register.ts),
# which has no path of its own to find the plugin by.
if (-not $PluginRoot) { $PluginRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$Project = (Resolve-Path -LiteralPath $Project).Path
$Dir = Join-Path $Project '.claude\lanes'
$State = Join-Path $Dir 'state'
$ConfigHome = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$MinClaude = [version]'2.1.296'

# The name the lanes go by: the folder name and a tag from the full path, so two
# projects with the same folder name (or none in ASCII) never share lanes. The tag is
# FNV-1a over the path with forward slashes, ASCII lowercased, as register.ts computes it.
function Get-Slug($path) {
  $key = [regex]::Replace(($path -replace '\\', '/').TrimEnd('/'), '[A-Z]', { param($m) $m.Value.ToLowerInvariant() })
  [uint64]$h = 2166136261
  foreach ($b in [Text.Encoding]::UTF8.GetBytes($key)) { $h = (($h -bxor $b) * 16777619) % 4294967296 }
  $base = ((Split-Path -Leaf $path).ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if (-not $base) { $base = 'project' }
  return "$base-$(('{0:x8}' -f $h).Substring(0, 4))"
}

$Slug = if ($Name) { $Name } else { Get-Slug $Project }
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

# PowerShell reads the curly single quotes (U+2018 to U+201B) as quotes too, so they double as well.
$Quotes = "['" + (-join [char[]](0x2018..0x201B)) + "]"
function Quote($s) { "'" + ($s -replace $Quotes, '$0$0') + "'" }

function Write-Prompt($tier) {
  $text = Get-Content -LiteralPath (Join-Path $PluginRoot "roles\$tier.md") -Raw -Encoding UTF8
  # how the person works (/config: work style); auto has no block, main reads it from them
  $styleFile = Join-Path $PluginRoot "roles\styles\$Style.md"
  if (Test-Path -LiteralPath $styleFile) {
    $text += "`n`n" + (Get-Content -LiteralPath $styleFile -Raw -Encoding UTF8)
  }
  $text = $text.Replace('{{MID}}', "$Slug-mid").Replace('{{LOW}}', "$Slug-low").Replace('{{SCRATCH}}', $Scratch)
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
  # the lanes' own scratch folder is where their scratch files go (the repo is main's), so it is a working directory too
  $argv = @('-n', $name, '--model', $c.Model, '--effort', $c.Effort, '--permission-mode', $PermissionMode,
    '--append-system-prompt-file', (Write-Prompt $tier), '--add-dir', $Scratch)
  if ($c.Fallback -and $c.Fallback -ne 'none') { $argv += @('--fallback-model', $c.Fallback) }
  if ($c.Compact) { $argv += @('--autocompact', $c.Compact) }
  # Lanes report; code edits, commits, pushes and deploys stay with the main session.
  # (register.ts also refuses a lane's Write inside the repo outside .claude/lanes.)
  $git = @('commit', 'push', 'reset', 'checkout', 'restore', 'stash', 'clean', 'switch', 'rebase', 'merge',
    'cherry-pick', 'revert', 'apply', 'am', 'rm', 'mv')
  $argv += @('--disallowedTools', 'Edit', 'NotebookEdit') + ($git | ForEach-Object { "Bash(git ${_}:*)", "PowerShell(git ${_}:*)" })
  if ($Launch -eq 'background') { $argv = @('--bg') + $argv }
  # A .cmd shim hands its arguments to cmd.exe, which runs & | < > ^ and expands % in them
  # (PowerShell quotes only what has a space): a folder named "x&calc&y" would run calc.
  if ($Claude -match '\.(cmd|bat)$' -and ($argv | Where-Object { $_ -match '[&|<>^%!,;="]' })) {
    return "lanes: this project's path or a lane setting has one of & | < > ^ % ! , ; = `", which claude.cmd would hand to cmd.exe to run. Install the native claude (claude.exe), or rename the folder."
  }
  New-Item -ItemType Directory -Force -Path $Scratch | Out-Null

  $run = Join-Path $State "$tier.run.ps1"
  $lines = @(
    "`$Host.UI.RawUI.WindowTitle = $(Quote "$name - $($c.Model)")",
    "Set-Location -LiteralPath $(Quote $Project)",
    "`$env:CLAUDE_LANE = $(Quote $tier)",
    "`$started = Get-Date",
    "& $(Quote $Claude) $(($argv | ForEach-Object { Quote $_ }) -join ' ')"
  )
  if ($Launch -eq 'window') {
    $lines += "if (((Get-Date) - `$started).TotalSeconds -lt 20) { Read-Host 'claude exited early - press Enter to close' }"
  }
  [IO.File]::WriteAllText($run, ($lines -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $true))

  # Run as a script block, not a file, so a managed PC's execution policy doesn't refuse it.
  $load = "& ([scriptblock]::Create([IO.File]::ReadAllText($(Quote $run), [Text.Encoding]::UTF8)))"
  if ($Launch -eq 'window') {
    Start-Process powershell.exe -WorkingDirectory $Project -ArgumentList "-Command `"$load`"" | Out-Null
  } else {
    & powershell.exe -NoProfile -Command $load
  }
  return "$name starting ($($c.Model), effort $($c.Effort)$(if ($c.Fallback -and $c.Fallback -ne 'none') { ", fallback $($c.Fallback)" }))"
}

function Stop-Lane($tier) {
  $name = "$Slug-$tier"
  $peer = Get-Peer $name
  if (-not $peer) { return "$name was not running" }
  # quietly: the lane's child processes that already exited would fill the output with errors
  & cmd.exe /c "taskkill /PID $($peer.pid) /T /F >nul 2>&1"
  # a killed session can't remove its own registry entry, and other sessions would keep messaging it
  Remove-Item -LiteralPath (Join-Path (Join-Path $ConfigHome 'sessions') "$($peer.pid).json") -ErrorAction SilentlyContinue
  return "$name stopped (pid $($peer.pid))"
}

# The lanes' scratch folder, inside this user's temp folder.
$Scratch = Join-Path ([IO.Path]::GetTempPath()) "lanes-$Slug"

# A symbolic link or junction (not a OneDrive placeholder, which is a reparse point too)
function Test-Link($path) {
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  return [bool]($item -and $item.LinkType -in 'SymbolicLink', 'Junction')
}

if ($Verb -eq 'start') {
  # A link under .claude\lanes (a repo can ship one) would take the writes below anywhere.
  $watch = @((Join-Path $Project '.claude'), $Dir, $State, (Join-Path $Dir 'out'), (Join-Path $Dir 'notes'), (Join-Path $Dir 'roles'), (Join-Path $Dir '.gitignore'), $Scratch)
  foreach ($d in $State, (Join-Path $Dir 'roles'), (Join-Path $Dir 'out'), (Join-Path $Dir 'notes')) {
    if ((Test-Path -LiteralPath $d) -and -not (Test-Link $d)) { $watch += @(Get-ChildItem -LiteralPath $d -Force | ForEach-Object FullName) }
  }
  foreach ($p in $watch) {
    if (Test-Link $p) { "lanes: $p is a link; the lanes stay off in this project until it is removed."; exit 1 }
  }
  New-Item -ItemType Directory -Force -Path $State, (Join-Path $Dir 'out'), (Join-Path $Dir 'notes') | Out-Null
  # nothing but '*', whatever a repo shipped: reports, notes and state stay out of git
  $ignore = Join-Path $Dir '.gitignore'
  $kept = @(if (Test-Path -LiteralPath $ignore) { Get-Content -LiteralPath $ignore | ForEach-Object { $_.Trim() } | Where-Object { $_ } })
  if ($kept.Count -ne 1 -or $kept[0] -ne '*') { Set-Content -LiteralPath $ignore -Value '*' -Encoding ASCII }

  # A lane window that can't find claude, or a claude too old for the flags below, only
  # says "exited early"; say why here instead, where the main session reads the output.
  # claude as a program (claude.exe, or npm's claude.cmd), never npm's claude.ps1 shim,
  # which PowerShell finds first and an execution policy that refuses script files refuses
  $Claude = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.exe', '.cmd', '.bat' } | Select-Object -First 1 -ExpandProperty Source
  if (-not $Claude) {
    'lanes: claude is not on PATH in PowerShell, so no lane can open. Install Claude Code there, or add it to PATH.'
    exit 1
  }
  # npm's claude.cmd only starts the claude.exe beside it: start that one, and cmd.exe stays out of it
  if ($Claude -match '\.(cmd|bat)$') {
    $exe = Join-Path (Split-Path -Parent $Claude) 'node_modules\@anthropic-ai\claude-code\bin\claude.exe'
    if (Test-Path -LiteralPath $exe) { $Claude = $exe }
  }
  $found = [regex]::Match((& $Claude --version | Out-String), '\d+\.\d+\.\d+').Value
  if ($found -and [version]$found -lt $MinClaude) {
    "lanes: Claude Code $found is older than $MinClaude, the version lanes is tested on. If a lane closes right away, run claude update."
  }
}

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
