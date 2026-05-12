#!/usr/bin/env bash
# supervisor — wraps the sandbox mock dispatcher with a blocker-only chat
# surface. Stdout from this script is what the Monitor / plugin-monitor
# turns into chat notifications, so the filter keeps routine ticks silent
# and only surfaces blocker-shaped events.
#
# Routine dispatcher state (tick count, pid, last_tick) lives in
# ${SYSTEM_ROOT}/.claude/constructs/sandbox/status.json — read it directly
# to confirm liveness; don't rely on chat for that.
#
# argv[1] (optional)  SYSTEM_ROOT for the dispatcher (default: $CLAUDE_PROJECT_DIR
#                     or $PWD)
# env CLAUDE_PLUGIN_ROOT  set by the plugin host; used to locate the dispatcher
set -uo pipefail

SYSTEM_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}")")")}"
DISPATCHER="$PLUGIN_ROOT/sandbox-construct/src/index.ts"

if [ ! -f "$DISPATCHER" ]; then
  echo "[supervisor] ERROR dispatcher source missing: $DISPATCHER"
  exit 2
fi

SANDBOX_SYSTEM_ROOT="$SYSTEM_ROOT" bun run "$DISPATCHER" 2>&1 \
  | awk '{ print "[sandbox] " $0; fflush(); }' \
  | grep -E --line-buffered "ERROR|FAIL|fail|blocked=true|blocked=[1-9][0-9]*|orphaned=[1-9][0-9]*|incident|recommended_next_actor|\\[supervisor\\] ERROR|exited code=[1-9]"

CODE=${PIPESTATUS[0]}
echo "[supervisor] dispatcher exited code=$CODE"
exit "$CODE"
