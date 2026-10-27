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
# Inside JYSV HERA (https://github.com/jysvai/JYSV-HERA), which sets HERA_LANES_HOST in its
# terminals, a lane opens as a HERA tab, on macOS and Linux alike. HERA only does that for
# a project registered in it; anywhere else it says no and the lane opens as before.
hera_host() { HERA_HOST_CWD="$project" HERA_HOST_RUN="${2:-}" hera host --lane "$1" ${3:+--check} >/dev/null 2>&1; }
if [ "$launch" = "window" ] && [ -n "${HERA_LANES_HOST:-}" ] && command -v hera >/dev/null 2>&1 && hera_host mid "" check; then
  launch="hera"
elif [ "$(uname -s)" != "Darwin" ]; then
  launch="background"
fi

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
  local tier="$1" file="$state/$1.prompt.md" styled="$plugin_root/roles/styles/$style.md" tmp
  # a model can be an ARN (…/application-inference-profile/…): | delimits, \ & | in a value are
  # escaped, and a line break (which would end the expression) is dropped
  esc() { printf '%s' "$1" | tr -d '\r\n' | sed -e 's/[\\&|]/\\&/g'; }
  # written beside the file and renamed over it: a rename replaces a link, a write would follow it
  tmp="$(mktemp "$state/.prompt.XXXXXX")"
  { cat "$plugin_root/roles/$tier.md"; if [ -f "$styled" ]; then printf '\n\n'; cat "$styled"; fi; } |
    sed -e "s|{{MID}}|$(esc "$slug-mid")|g" -e "s|{{LOW}}|$(esc "$slug-low")|g" -e "s|{{SCRATCH}}|$(esc "$scratch")|g" \
        -e "s|{{MID_MODEL}}|$(esc "$(model_of mid)")|g" -e "s|{{LOW_MODEL}}|$(esc "$(model_of low)")|g" > "$tmp"
  if [ -f "$dir/roles/$tier.md" ]; then
    printf '\n\n## This project\n\n' >> "$tmp"
    cat "$dir/roles/$tier.md" >> "$tmp"
  fi
  mv -f "$tmp" "$file"
  echo "$file"
}

start_lane() {
  local tier="$1" name="$slug-$1" pid prompt run args fallback compact
  pid="$(peer_pid "$name")"
  if [ -n "$pid" ]; then echo "$name already running (pid $pid)"; return; fi
  prompt="$(write_prompt "$tier")"
  fallback="$(fallback_of "$tier")"; [ "$fallback" = "none" ] && fallback=""
  compact="$(compact_of "$tier")"
  # the lanes' own scratch folder is where their scratch files go (the repo is main's), so it is a working directory too
  args=(-n "$name" --model "$(model_of "$tier")" --effort "$(effort_of "$tier")"
        --permission-mode "$permission_mode" --append-system-prompt-file "$prompt" --add-dir "$scratch")
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
  tmp="$(mktemp "$state/.run.XXXXXX")"
  {
    echo '#!/usr/bin/env bash'
    # the window's title; a background lane has no window, and the escape would land in the output
    [ "$launch" != "background" ] && printf 'printf "\\033]0;%%s\\007" %s\n' "$(quote "$name")"
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
    if [ "$launch" != "background" ]; then
      echo 'if [ $(( $(date +%s) - started )) -lt 20 ]; then read -r -p "claude exited early - press Enter to close" _; fi'
    fi
  } > "$tmp"
  chmod +x "$tmp"
  mv -f "$tmp" "$run"

  if [ "$launch" = "hera" ]; then
    if ! hera_host "$tier" "$run"; then
      echo "lanes: JYSV HERA couldn't open a tab for $name. Is HERA still running?" >&2
      exit 1
    fi
  elif [ "$launch" = "window" ]; then
    # Opening the file in Terminal needs no Automation permission, which scripting
    # Terminal with osascript would ask for on the first window and wait on.
    if ! open -a Terminal "$run"; then
      echo "lanes: couldn't open a Terminal window for $name. Set the lanes' launch to background in /config." >&2
      exit 1
    fi
  else
    /bin/bash "$run"
  fi
  echo "$name starting$([ "$launch" = "hera" ] && echo ' in a HERA tab') ($(model_of "$tier"), effort $(effort_of "$tier")${fallback:+, fallback $fallback})"
}

# the processes under a pid (a lane's shells, and the browsers and servers they started), deepest first
descendants() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do
    descendants "$c"
    echo "$c"
  done
}

stop_lane() {
  local name="$slug-$1" pid kids i k
  pid="$(peer_pid "$name")"
  if [ -z "$pid" ]; then echo "$name was not running"; return; fi
  # what the lane started goes with it, as taskkill /T does on Windows
  kids="$(descendants "$pid")"
  # shellcheck disable=SC2086
  if [ -n "$kids" ]; then kill $kids 2>/dev/null || true; fi
  kill "$pid" 2>/dev/null || true
  # gone before this returns: a lane opened again right after must not meet this one still
  # shutting down, and writing its state over the new one's
  for i in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  # then by force, only what is still there (a pid that has gone may soon be another process's)
  for k in $kids "$pid"; do
    if kill -0 "$k" 2>/dev/null; then kill -9 "$k" 2>/dev/null || true; fi
  done
  # a killed session may not remove its own registry entry, and other sessions would keep messaging it
  rm -f "$config_home/sessions/$pid.json"
  echo "$name stopped (pid $pid)"
}

# The lanes' scratch folder: their own, not the shared temp folder others on this machine can write.
scratch="${TMPDIR:-/tmp}"
scratch="${scratch%/}/lanes-$(id -u)-$slug"

if [ "$verb" = "start" ]; then
  # A link under .claude/lanes (a repo can ship one) would take the writes below anywhere.
  for p in "$project/.claude" "$dir" "$state" "$dir/out" "$dir/notes" "$dir/roles" "$dir/.gitignore" \
           "$state"/* "$state"/.[!.]* "$dir/roles"/* "$dir/out"/* "$dir/notes"/*; do
    if [ -L "$p" ]; then
      echo "lanes: $p is a link; the lanes stay off in this project until it is removed." >&2
      exit 1
    fi
  done
  mkdir -p "$state" "$dir/out" "$dir/notes"
  # nothing but '*', whatever a repo shipped: reports, notes and state stay out of git
  if [ "$(grep -v '^[[:space:]]*$' "$dir/.gitignore" 2>/dev/null | tr -d '\r' | sed 's/[[:space:]]*$//')" != '*' ]; then
    printf '*\n' > "$dir/.gitignore"
  fi
  mkdir -p "$scratch"
  chmod 700 "$scratch" 2>/dev/null || true
  if [ -L "$scratch" ] || [ ! -O "$scratch" ]; then
    echo "lanes: $scratch is a link or someone else's; remove it to open the lanes." >&2
    exit 1
  fi

  # A lane that can't find claude, or a claude too old for the flags below, only says
  # "exited early"; say why here instead, where the main session reads the output.
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
