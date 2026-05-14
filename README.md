# test-marketplace

Throwaway test bed under `nfrith-repos/`. Mirrors ALS's marketplace + plugin + construct + plugin-monitor shapes with no domain content.

## Purpose

Exercise (1) marketplace registration, (2) plugin loading, (3) the construct upgrade engine, and (4) the plugin-monitor auto-start pattern — without using production ALS as the substrate. The sandbox construct ships a real bun process (mock dispatcher) so the plugin monitor has something faithful-shaped to manage.

## Status

Not for production use. State here is disposable — if a test breaks the repo, blow it away and re-init.

## Layout

```
test-marketplace/
├── .claude-plugin/
│   ├── marketplace.json    # thin-catalog form, pinned to nfrith/test-marketplace@main
│   └── plugin.json         # plugin manifest
├── .mcp.json               # MCP server declaration — auto-starts sandbox-mcp at session open
├── monitors/
│   └── monitors.json       # plugin-monitor declaration — auto-starts the supervisor at session open
├── sandbox-construct/
│   ├── src/index.ts        # mock bun dispatcher: tick log, status.json, SIGTERM-ignore
│   ├── supervisor.sh       # wraps the dispatcher with blocker-only chat filter
│   ├── construct.json      # construct manifest (lifecycle_strategy: process-lifecycle)
│   ├── VERSION
│   ├── package.json
│   ├── tsconfig.json
│   └── migrations/         # sequential migration scripts (vN-to-vM.ts); empty at v1
└── sandbox-mcp/
    └── index.ts            # minimal stdio MCP server — `ping` tool returns pid/started_at/build
```

## Ref pinning

`marketplace.json` currently pins the plugin source to `nfrith/test-marketplace@main`. Branch pinning means "install latest from main" — iterate by pushing changes to main, then reinstall.

To switch to deterministic tag pinning instead, change `marketplace.json` to:

```json
"source": { "source": "github", "repo": "nfrith/test-marketplace", "ref": "v0.2.0" }
```

…and create a matching git tag.

## Running the mock dispatcher manually

```bash
bun run sandbox-construct/src/index.ts
# or with a custom system root:
SANDBOX_SYSTEM_ROOT=/tmp/sandbox-test bun run sandbox-construct/src/index.ts
# or with a faster poll for stress testing:
SANDBOX_POLL_MS=1000 bun run sandbox-construct/src/index.ts
```

The mock writes `${SYSTEM_ROOT}/.claude/constructs/sandbox/status.json` every tick and logs `[mock-dispatcher] tick #N (active=0, blocked=0)` to stdout. It ignores SIGTERM — you must `kill -9` to stop it. Same as the real ALS dispatcher.

The supervisor wrapper (`sandbox-construct/supervisor.sh`) pipes the mock's output through a blocker-only filter so chat stays quiet during happy-path operation.

## Test workflows

### A. Plugin install / load

```
claude plugin marketplace add nfrith/test-marketplace
claude plugin install test-marketplace@test-marketplace
```

Verify the plugin appears in `~/.claude/plugins/installed_plugins.json`.

### B. Plugin-monitor auto-start (the absorb-/bootup experiment)

After install, the plugin monitor starts the supervisor (which spawns the mock dispatcher and pipes its output through a blocker-only filter). Empirically, `/reload-plugins` in the install session also triggers the monitor's first spawn — you do not strictly need a fresh session to see it boot.

You should see **nothing** in chat during happy path — the filter drops routine tick lines. To confirm the dispatcher is alive, read:

```
${CLAUDE_PROJECT_DIR}/.claude/constructs/sandbox/status.json
```

Look for an increasing `tick_count`, a recent `last_tick` ISO timestamp, and a `build` field that matches the installed version's marker.

To stop the dispatcher: end the session, or `kill -9` the bun process (SIGTERM is ignored, mirroring the ALS dispatcher).

**Health-probe caveat (validated 2026-05-12):** `status.json` does not self-invalidate after a SIGKILL — it will continue to report `lifecycle_mode: "running"` with a stale `last_tick`. Always cross-check `ps` for the bun pid before trusting status.json as a liveness signal.

### C. Construct migration engine

1. Bump `sandbox-construct/VERSION` from `1` to `2`
2. Bump `sandbox-construct/construct.json` `version` field to `2`
3. Add `sandbox-construct/migrations/v1-to-v2.ts` with `export async function migrate() {}`
4. Commit and push
5. Run `/update` in a fresh Claude Code session
6. The construct upgrade engine should discover and run the migration

### D. Mid-session reload

After bumping the plugin version, two operations are separate and must be understood
distinctly (validated 2026-05-12):

1. **`/reload-plugins`** — when the marketplace ref is pinned to `@main` (or any other
   branch/tag that has moved), this **does** fetch the new version into the on-disk
   cache (`~/.claude/plugins/cache/<plugin>/<plugin>/<version>/`). Skills, slash
   commands, agents, and hooks load from the new version on next invocation. Subsequent
   `/reload-plugins` calls are no-ops against the running state.
2. **Running monitor lifecycle** — `/reload-plugins` does **not** restart already-running
   plugin monitors. The running supervisor stays bound to the bytes it was spawned
   against for the rest of the session, even after fresh bytes appear in the cache.
   SIGKILL on the running process is also not auto-recovered — Claude Code does not
   respawn dead monitors mid-session.

To pick up new monitor bytes: end the session and reopen. The fresh session picks the
latest cached version automatically. Old cache versions remain on disk indefinitely —
no garbage collection.

### F. MCP server lifecycle (the versioning-system precondition)

The plugin ships a minimal stdio MCP server alongside the plugin-monitor (`sandbox-mcp/index.ts`). It exposes one tool, `ping`, returning `{ pid, started_at, build }`. This exists to answer two questions that decide whether ALS dispatchers should migrate from plugin-monitors to MCP servers:

1. **Does `/reload-plugins` kill+respawn the MCP host process?**
   - Capture the server's pid via `ps | grep sandbox-mcp` and call `ping` to record `build`.
   - Bump the `BUILD` constant in `sandbox-mcp/index.ts`, push, run `/reload-plugins`.
   - If the pid changed AND `ping` returns the new `build`: MCP servers hot-reload like skills/hooks. Versioning system simplification confirmed.
   - If the pid is unchanged OR `build` is still the old value: re-registration only. MCP servers have the same monitor-asymmetry — moving the dispatcher there doesn't help.

2. **Does Claude Code auto-respawn the MCP server after SIGKILL?**
   - `kill -9` the server's pid.
   - Wait ≥30s, watch `ps`.
   - Call `ping` again. Success (auto-respawned) or failure (dead like a monitor)?

The MCP server has no overlap with the dispatcher — they run independently. Coexistence in one plugin is part of the test.

### E. Lifecycle / blocker-channel introspection

Two distinct notification channels exist from a plugin monitor to chat:

- **stdout-line-filter-match** — anything the supervisor's stdout pipeline prints (after
  its grep filter) becomes a `task-notification` "Monitor event" line in chat.
- **lifecycle-status-change** — when the monitor process exits or is killed, Claude
  Code emits a separate `task-notification` with a `status` field (`killed`, `exited`,
  etc.). This fires independently of any stdout match.

This means the supervisor's filter pattern only controls the *content* surface; the
*lifecycle* surface is always-on.

### G. Daemon-survival test (the detach pattern)

ALS is being rewritten to put its delamain-dispatcher into a Claude Code plugin MCP server. The new dispatcher needs to spawn a detached daemon process that outlives the MCP server. The unknown: **when Claude Code kills an MCP server (session end, `/reload-plugins`, etc.), does that killing reach down into detached child processes the MCP server spawned?** If yes, the daemon pattern is dead. If no, the pattern works.

Three mechanisms Claude Code might use, each producing a different outcome:

- `kill <mcp_pid>` (single PID, SIGTERM/SIGKILL) → detached child survives (reparented to init when parent dies)
- `kill -- -<pgid>` (process group) → detached child survives IF it called `setsid()` (bun's `detached: true` does this)
- Recursive tree-walk by PPID → detached child only survives if double-forked (PPID is init by walk time)

This rig empirically resolves which mechanism Claude Code uses.

**Components.** The `daemon-launcher/` MCP server is a zero-tools stdio MCP server. On startup it reads `~/.als-test/daemon.pid`. If the PID is alive, it adopts it; otherwise it spawns `daemon/index.ts` via `Bun.spawn({ detached: true, stdio: ["ignore","ignore","ignore"] })` and records the new PID. The daemon then ticks a heartbeat once per second to `/tmp/dst/daemon-heartbeat.json` with no signal handlers — we want to observe whether the harness kills it.

**File locations** (scratch — safe to `rm -rf` between runs):

- PID file: `~/.als-test/daemon.pid`
- Heartbeat: `/tmp/dst/daemon-heartbeat.json`
- Launcher events: `/tmp/dst/launcher-events.jsonl`

**How to find the launcher PID.** The launcher *is* the MCP server process spawned by Claude Code:

```
ps aux | grep daemon-launcher/index.ts | grep -v grep
```

**How to find the daemon PID.**

```
cat ~/.als-test/daemon.pid
```

**Six observations.** Run in order, record the result of each:

| # | Trigger | What it tests | What to check |
|---|---|---|---|
| G1 | Install plugin, open session (baseline) | Launcher spawns daemon | `tail -n 5 /tmp/dst/launcher-events.jsonl` shows `spawned-daemon`; `cat /tmp/dst/daemon-heartbeat.json` exists with `tick_count` climbing |
| G2 | **Close Claude Code session, wait 30s** | Daemon survives session close | `cat /tmp/dst/daemon-heartbeat.json` — is `tick_count` still climbing? Yes → daemon survived. Frozen → harness killed it |
| G3 | Open new Claude Code session | Multi-session client-of-daemon | `tail -n 5 /tmp/dst/launcher-events.jsonl` shows `found-existing`; `cat /tmp/dst/daemon-heartbeat.json` PID unchanged from G2; `tick_count` still climbing |
| G4 | `/reload-plugins` (active session) | Cascade respawn behavior on bytes change | `cat /tmp/dst/daemon-heartbeat.json` — same PID as before? Still ticking? |
| G5 | `kill -9 <mcp_launcher_pid>` directly | Parent-killed scenario | `cat /tmp/dst/daemon-heartbeat.json` — still ticking? Look at `ppid` field: did it flip to 1 (init)? |
| G6 | `kill -9 <daemon_pid>` | Recovery path | Open new session; `tail -n 5 /tmp/dst/launcher-events.jsonl` shows a new `spawned-daemon` entry; new PID in `~/.als-test/daemon.pid` |

**Reading the diagnostic fields.** Each heartbeat carries `{pid, ppid, started_at, build, tick_count, last_tick}`. The `ppid` field is the load-bearing one: a PPID flip from the launcher's PID to `1` (init/launchd) confirms reparenting and is the success signal for detach. A `started_at` that survives across observations confirms it's the same process, not a respawn.

**Reset between runs.**

```
rm -rf /tmp/dst ~/.als-test
```
