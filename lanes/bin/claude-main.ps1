# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 jysvai

# Starts a main Claude Code session the way the lanes plugin expects it:
# Opus 5.5 (1M context) with Fable 5.1 as the fallback, effort xhigh.
# Anything after the options goes to claude as is:  claude-main.ps1 -c
param(
  [string]$Model = 'claude-opus-5-5[1m]',
  [string]$Fallback = 'claude-fable-5-1',
  [string]$Effort = 'xhigh'
)
& claude --model $Model --fallback-model $Fallback --effort $Effort @args
