#!/usr/bin/env bash
# Lane sessions for a project (macOS and Linux): a mid lane (tests, verification)
# and a low lane (search, scripts, crawling, notes), each its own Claude Code session.
#
#   lanes.sh start  [all|mid|low]    a Terminal window per lane on macOS, background elsewhere
#   lanes.sh stop   [all|mid|low]
#   lanes.sh status
#
# Settings come from the environment (the lanes plugin sets them from /config):
#   LANES_PROJECT  LANES_LAUNCH=window|background  LANES_PERMISSION_MODE
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
slug="$(basename "$project" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
slug="${slug:-project}"
launch="${LANES_LAUNCH:-window}"
permission_mode="${LANES_PERMISSION_MODE:-auto}"
if [ "$(uname -s)" != "Darwin" ]; then launch="background"; fi

model_of() { case "$1" in mid) echo "${LANES_MID_MODEL:-claude-sonnet-5-5}" ;; *) echo "${LANES_LOW_MODEL:-claude-haiku-5-5}" ;; esac; }
fallback_of() { case "$1" in mid) echo "${LANES_MID_FALLBACK-claude-opus-5-5}" ;; *) echo "${LANES_LOW_FALLBACK:-}" ;; esac; }
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
  local tier="$1" file="$state/$1.prompt.md"
  sed -e "s/{{MID}}/$slug-mid/g" -e "s/{{LOW}}/$slug-low/g" \
      -e "s/{{MID_MODEL}}/$(model_of mid)/g" -e "s/{{LOW_MODEL}}/$(model_of low)/g" \
      "$plugin_root/roles/$tier.md" > "$file"
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
  args=(-n "$name" --model "$(model_of "$tier")" --effort "$(effort_of "$tier")"
        --permission-mode "$permission_mode" --append-system-prompt-file "$prompt")
  [ -n "$fallback" ] && args+=(--fallback-model "$fallback")
  [ -n "$compact" ] && args+=(--autocompact "$compact")
  # Lanes report; code edits, commits, pushes and deploys stay with the main session.
  args+=(--disallowedTools Edit NotebookEdit 'Bash(git commit:*)' 'Bash(git push:*)' 'Bash(git reset:*)' 'Bash(git checkout:*)')
  [ "$launch" = "background" ] && args=(--bg "${args[@]}")

  run="$state/$tier.run.sh"
  {
    echo '#!/usr/bin/env bash'
    printf 'printf "\\033]0;%%s\\007" %s\n' "$(quote "$name")"
    echo "cd $(quote "$project") || exit 1"
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
    osascript -e "tell application \"Terminal\" to do script \"/bin/bash '$run'\"" > /dev/null
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
  echo "$name stopped (pid $pid)"
}

mkdir -p "$state" "$dir/out" "$dir/notes"
[ -f "$dir/.gitignore" ] || echo '*' > "$dir/.gitignore"

tiers=(mid low)
[ "$which" != "all" ] && tiers=("$which")
for tier in "${tiers[@]}"; do
  case "$verb" in
    start) start_lane "$tier" ;;
    stop) stop_lane "$tier" ;;
    *) pid="$(peer_pid "$slug-$tier")"; if [ -n "$pid" ]; then echo "$slug-$tier  running  pid $pid"; else echo "$slug-$tier  off"; fi ;;
  esac
done
