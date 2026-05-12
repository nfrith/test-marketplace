# test-marketplace

Throwaway test bed under `nfrith-repos/`. Mirrors ALS's marketplace + plugin + construct shapes with no domain content.

## Purpose

Exercise marketplace registration, plugin loading, and the construct upgrade engine without using production ALS as the substrate.

## Status

Not for production use. State here is disposable — if a test breaks the repo, blow it away and re-init.

## Layout

- `.claude-plugin/marketplace.json` — Claude Code marketplace catalog (fat form)
- `.claude-plugin/plugin.json` — plugin manifest
- `sandbox-construct/` — single test construct (`lifecycle_strategy: "none"`)
- `sandbox-construct/migrations/` — sequential migration scripts (`vN-to-vM.ts`)

## Test workflow

1. Add the marketplace: `claude plugin marketplace add nfrith/test-marketplace`
2. Install the plugin: `claude plugin install test-marketplace@test-marketplace`
3. To exercise the migration engine:
   - Bump `sandbox-construct/VERSION` from `1` to `2`
   - Bump `sandbox-construct/construct.json` version field to `2`
   - Add `sandbox-construct/migrations/v1-to-v2.ts` with `export async function migrate() {}`
   - Commit and push
   - Run `/update` in a fresh Claude Code session
   - The construct upgrade engine should discover and run the migration
