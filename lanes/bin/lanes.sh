#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 jysvai
# Lane sessions for a project (macOS and Linux): a mid lane (side work that needs judgement)
# and a low lane (search, scripts, crawling, notes), each its own Claude Code session.
#
#   lanes.sh start  [all|mid|low]    a Terminal window per lane on macOS, background elsewhere
#   lanes.sh stop   [all|mid|low]
#   lanes.sh status
#
# Settings come from the environment (the lanes plugin sets them from /config):
#   LANES_PROJECT  LANES_LAUNCH=window|background  LANES_PERMISSION_MODE  LANES_STYLE=auto|developer|planner|beginner
#   LANES_MID_MODEL LANES_MID_FALLBACK LANES_MID_EFFORT LANES_MID_COMPACT
#   LANES_LOW_MODEL LANES_LOW_FALLBACK LANES_LOW_EFFORT LANES_LOW_COMPACT
#
# Run it from a terminal you opened yourself, or let the plugin run it (/lane start):
# a window opened from a Claude tool call inherits that call's child-session
# markers and never becomes a peer that can be messaged.
set -euo pipefail

verb="${1:-status}"
which="${2:-all}"
plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$(cd "${LANES_PROJECT:-$PWD}" && pwd)"
dir="$project/.claude/lanes"
state="$dir/state"
config_home="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
min_claude="2.1.296"

# The name the lanes go by: the folder name and a tag from the full path, so two
# projects with the same folder name (or none in ASCII) never share lanes. The tag is
# FNV-1a over the path's UTF-8 bytes, as register.ts computes it.
slug_of() {
  local h=2166136261 b base
  for b in $(printf '%s' "$1" | od -An -v -tu1); do h=$(( ((h ^ b) * 16777619) & 0xFFFFFFFF )); done
  base="$(basename "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]' | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  printf '%s-%s' "${base:-project}" "$(printf '%08x' "$h" | cut -c1-4)"
}

# older_than 2.1.250 2.1.296 succeeds
older_than() {
  awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, "."); for (i = 1; i <= 3; i++) { if (x[i] + 0 != y[i] + 0) exit !(x[i] + 0 < y[i] + 0) } exit 1 }'
}

slug="${LANES_SLUG:-$(slug_of "$project")}"
launch="${LANES_LAUNCH:-window}"
permission_mode="${LANES_PERMISSION_MODE:-auto}"
# how the person works (/config: work style); auto has no block, main reads it from them
case "${LANES_STYLE:-auto}" in developer|planner|beginner) style="$LANES_STYLE" ;; *) style="auto" ;; esac
if [ "$(uname -s)" != "Darwin" ]; then launch="background"; fi

model_of() { case "$1" in mid) echo "${LANES_MID_MODEL:-claude-sonnet-5-5}" ;; *) echo "${LANES_LOW_MODEL:-claude-haiku-5-5}" ;; esac; }
fallback_of() { case "$1" in mid) echo "${LANES_MID_FALLBACK-claude-opus-5-5}" ;; *) echo "${LANES_LOW_FALLBACK-claude-sonnet-5-5}" ;; esac; }
effort_of() { case "$1" in mid) echo "${LANES_MID_EFFORT:-high}" ;; *) echo "${LANES_LOW_EFFORT:-medium}" ;; esac; }
compact_of() { case "$1" in mid) echo "${LANES_MID_COMPACT:-200k}" ;; *) echo "${LANES_LOW_COMPACT:-150k}" ;; esac; }

# pid of the live session registered under a name, or nothing
peer_pid() {
  local f pid
  for f in "$config_home"/sessions/*.json; do
    [ -e "$f" ] || continue
    if grep -q "\"name\":\"$1\"" "$f"; then
      pid="$(sed -E 's/.*"pid":([0-9]+).*/\1/' "$f")"
      if kill -0 "$pid" 2>/dev/null; then echo "$pid"; return; fi
    fi
  done
}

quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

write_prompt() {
  local tier="$1" file="$state/$1.prompt.md" styled="$plugin_root/roles/styles/$style.md"
  # a model can be an ARN (…/application-inference-profile/…): | delimits, and \ & | in a value are escaped
  esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
  { cat "$plugin_root/roles/$tier.md"; if [ -f "$styled" ]; then printf '\n\n'; cat "$styled"; fi; } |
    sed -e "s|{{MID}}|$(esc "$slug-mid")|g" -e "s|{{LOW}}|$(esc "$slug-low")|g" \
        -e "s|{{MID_MODEL}}|$(esc "$(model_of mid)")|g" -e "s|{{LOW_MODEL}}|$(esc "$(model_of low)")|g" > "$file"
  if [ -f "$dir/roles/$tier.md" ]; then
    printf '\n\n## This project\n\n' >> "$file"
    cat "$dir/roles/$tier.md" >> "$file"
  fi
  echo "$file"
}

start_lane() {
  local tier="$1" name="$slug-$1" pid prompt run args fallback compact
  pid="$(peer_pid "$name")"
  if [ -n "$pid" ]; then echo "$name already running (pid $pid)"; return; fi
  prompt="$(write_prompt "$tier")"
  fallback="$(fallback_of "$tier")"; [ "$fallback" = "none" ] && fallback=""
  compact="$(compact_of "$tier")"
  # the temp folder is where a lane's scratch files go (the repo is main's), so it is a working directory too
  args=(-n "$name" --model "$(model_of "$tier")" --effort "$(effort_of "$tier")"
        --permission-mode "$permission_mode" --append-system-prompt-file "$prompt" --add-dir "${TMPDIR:-/tmp}")
  [ -n "$fallback" ] && args+=(--fallback-model "$fallback")
  [ -n "$compact" ] && args+=(--autocompact "$compact")
  # Lanes report; code edits, commits, pushes and deploys stay with the main session.
  # (register.ts also refuses a lane's Write inside the repo outside .claude/lanes.)
  args+=(--disallowedTools Edit NotebookEdit)
  for g in commit push reset checkout restore stash clean switch rebase merge cherry-pick revert apply am rm mv; do
    args+=("Bash(git $g:*)")
  done
  [ "$launch" = "background" ] && args=(--bg "${args[@]}")

  # .command: the file type Terminal runs when it opens one
  run="$state/$tier.run.command"
  {
    echo '#!/usr/bin/env bash'
    # the window's title; a background lane has no window, and the escape would land in the output
    [ "$launch" = "window" ] && printf 'printf "\\033]0;%%s\\007" %s\n' "$(quote "$name")"
    echo "cd $(quote "$project") || exit 1"
    # a Terminal window starts from a fresh login shell: hand it the claude and the config dir this session uses
    echo "export PATH=$(quote "$PATH")"
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then echo "export CLAUDE_CONFIG_DIR=$(quote "$CLAUDE_CONFIG_DIR")"; fi
    # and which provider and region to use (Bedrock, Vertex, Foundry). Never a key: one set only
    # in the shell stays there, so set it in settings.json `env` or a profile, or run lanes in the background.
    for v in CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_MANTLE CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY \
             AWS_REGION AWS_DEFAULT_REGION AWS_PROFILE ANTHROPIC_BEDROCK_REGION_PREFIX \
             ANTHROPIC_VERTEX_PROJECT_ID CLOUD_ML_REGION ANTHROPIC_FOUNDRY_RESOURCE \
             ANTHROPIC_BEDROCK_BASE_URL ANTHROPIC_BEDROCK_MANTLE_BASE_URL ANTHROPIC_VERTEX_BASE_URL ANTHROPIC_FOUNDRY_BASE_URL \
             ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL ANTHROPIC_DEFAULT_FABLE_MODEL; do
      if [ -n "${!v:-}" ]; then echo "export $v=$(quote "${!v}")"; fi
    done
    echo "export CLAUDE_LANE=$tier"
    echo 'started=$(date +%s)'
    printf 'claude'
    for a in "${args[@]}"; do printf ' %s' "$(quote "$a")"; done
    echo
    if [ "$launch" = "window" ]; then
      echo 'if [ $(( $(date +%s) - started )) -lt 20 ]; then read -r -p "claude exited early - press Enter to close" _; fi'
    fi
  } > "$run"
  chmod +x "$run"

  if [ "$launch" = "window" ]; then
    # Opening the file in Terminal needs no Automation permission, which scripting
    # Terminal with osascript would ask for on the first window and wait on.
    if ! open -a Terminal "$run"; then
      echo "lanes: couldn't open a Terminal window for $name. Set the lanes' launch to background in /config." >&2
      exit 1
    fi
  else
    /bin/bash "$run"
  fi
  echo "$name starting ($(model_of "$tier"), effort $(effort_of "$tier")${fallback:+, fallback $fallback})"
}

stop_lane() {
  local name="$slug-$1" pid
  pid="$(peer_pid "$name")"
  if [ -z "$pid" ]; then echo "$name was not running"; return; fi
  kill "$pid"
  # a killed session may not remove its own registry entry, and other sessions would keep messaging it
  rm -f "$config_home/sessions/$pid.json"
  echo "$name stopped (pid $pid)"
}

mkdir -p "$state" "$dir/out" "$dir/notes"
[ -f "$dir/.gitignore" ] || echo '*' > "$dir/.gitignore"

# A lane that can't find claude, or a claude too old for the flags below, only says
# "exited early"; say why here instead, where the main session reads the output.
if [ "$verb" = "start" ]; then
  if ! command -v claude > /dev/null; then
    echo "lanes: claude is not on PATH in bash, so no lane can open. Install Claude Code there, or add it to PATH."
    exit 1
  fi
  found="$(claude --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  if [ -n "$found" ] && older_than "$found" "$min_claude"; then
    echo "lanes: Claude Code $found is older than $min_claude, the version lanes is tested on. If a lane closes right away, run claude update."
  fi
fi

tiers=(mid low)
[ "$which" != "all" ] && tiers=("$which")
for tier in "${tiers[@]}"; do
  case "$verb" in
    start) start_lane "$tier" ;;
    stop) stop_lane "$tier" ;;
    *) pid="$(peer_pid "$slug-$tier")"; if [ -n "$pid" ]; then echo "$slug-$tier  running  pid $pid"; else echo "$slug-$tier  off"; fi ;;
  esac
done
