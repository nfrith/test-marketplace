# test-marketplace

Throwaway test bed under `nfrith-repos/`. Mirrors ALS's marketplace + plugin + construct shapes with no domain content.

## Purpose

Exercise marketplace registration, plugin loading, the construct upgrade engine, AND the plugin-monitor + supervisor pattern — without using production ALS as the substrate. The sandbox construct ships a real bun process (mock dispatcher) so the Monitor tool has something faithful-shaped to manage.

## Status

Not for production use. State here is disposable — if a test breaks the repo, blow it away and re-init.

## Layout

- `.claude-plugin/marketplace.json` — Claude Code marketplace catalog (fat form)
- `.claude-plugin/plugin.json` — plugin manifest
- `sandbox-construct/` — single test construct (`lifecycle_strategy: "process-lifecycle"`)
  - `src/index.ts` — mock dispatcher: tick log, status.json, SIGTERM-ignore (mirrors ALS dispatcher shape)
  - `migrations/` — sequential migration scripts (`vN-to-vM.ts`); empty at v1
  - `package.json`, `tsconfig.json` — bun runtime config

## Running the mock dispatcher

```bash
bun run sandbox-construct/src/index.ts
# or with a custom system root:
SANDBOX_SYSTEM_ROOT=/tmp/sandbox-test bun run sandbox-construct/src/index.ts
# or with a faster poll for stress testing:
SANDBOX_POLL_MS=1000 bun run sandbox-construct/src/index.ts
```

The mock writes `${SYSTEM_ROOT}/.claude/constructs/sandbox/status.json` every tick and logs `[mock-dispatcher] tick #N (active=0, blocked=0)` to stdout. It ignores SIGTERM — you must SIGKILL (`kill -9`) to stop it. Same as the real ALS dispatcher.

## Test workflows

### A. Plugin install / load

```
claude plugin marketplace add nfrith/test-marketplace
claude plugin install test-marketplace@test-marketplace
```

Then verify the plugin appears in `~/.claude/plugins/installed_plugins.json`.

### B. Construct migration engine

1. Bump `sandbox-construct/VERSION` from `1` to `2`
2. Bump `sandbox-construct/construct.json` version field to `2`
3. Add `sandbox-construct/migrations/v1-to-v2.ts` with `export async function migrate() {}`
4. Commit and push
5. Run `/update` in a fresh Claude Code session
6. The construct upgrade engine should discover and run the migration

### C. Monitor + supervisor pattern (the v1 plugin-monitor experiment)

Point the Monitor tool (or a plugin monitor) at a supervisor script that spawns `sandbox-construct/src/index.ts`. The mock will tick + write status.json + ignore SIGTERM, giving the supervisor pattern a realistic process to wrap.
