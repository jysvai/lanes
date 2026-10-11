#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 jysvai
# Starts a main Claude Code session the way the lanes plugin expects it:
# Opus 5.5 (1M context) with Fable 5.1 as the fallback, effort xhigh.
# Override with LANES_MAIN_MODEL, LANES_MAIN_FALLBACK, LANES_MAIN_EFFORT;
# anything else goes to claude as is:  claude-main.sh -c
exec claude \
  --model "${LANES_MAIN_MODEL:-claude-opus-5-5[1m]}" \
  --fallback-model "${LANES_MAIN_FALLBACK:-claude-fable-5-1}" \
  --effort "${LANES_MAIN_EFFORT:-xhigh}" \
  "$@"
