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
├── monitors/
│   └── monitors.json       # plugin-monitor declaration — auto-starts the supervisor at session open
└── sandbox-construct/
    ├── src/index.ts        # mock bun dispatcher: tick log, status.json, SIGTERM-ignore
    ├── supervisor.sh       # wraps the dispatcher with blocker-only chat filter
    ├── construct.json      # construct manifest (lifecycle_strategy: process-lifecycle)
    ├── VERSION
    ├── package.json
    ├── tsconfig.json
    └── migrations/         # sequential migration scripts (vN-to-vM.ts); empty at v1
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

### E. Lifecycle / blocker-channel introspection

Two distinct notification channels exist from a plugin monitor to chat:

- **stdout-line-filter-match** — anything the supervisor's stdout pipeline prints (after
  its grep filter) becomes a `task-notification` "Monitor event" line in chat.
- **lifecycle-status-change** — when the monitor process exits or is killed, Claude
  Code emits a separate `task-notification` with a `status` field (`killed`, `exited`,
  etc.). This fires independently of any stdout match.

This means the supervisor's filter pattern only controls the *content* surface; the
*lifecycle* surface is always-on.
