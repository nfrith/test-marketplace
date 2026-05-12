#!/usr/bin/env bun
/**
 * Mock dispatcher for the test-marketplace sandbox construct.
 *
 * Mirrors the ALS delamain-dispatcher's runtime shape — tick log to stdout,
 * status.json on disk, SIGTERM-ignore — without doing real work. Exists so the
 * Monitor-tool + supervisor pattern has a faithful-shaped process to manage
 * during plugin-monitor experiments.
 *
 * Env / argv:
 *   SANDBOX_SYSTEM_ROOT  where to write status.json (default: cwd)
 *   SANDBOX_POLL_MS      tick interval in ms (default: 5000)
 *   argv[2]              fallback for SANDBOX_SYSTEM_ROOT
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SYSTEM_ROOT =
  process.env.SANDBOX_SYSTEM_ROOT ?? process.argv[2] ?? process.cwd();
const CONSTRUCT_NAME = "sandbox";
const POLL_MS = Number(process.env.SANDBOX_POLL_MS ?? 5000);
const STATUS_PATH = `${SYSTEM_ROOT}/.claude/constructs/${CONSTRUCT_NAME}/status.json`;

// Mirror ALS dispatcher: SIGTERM is ignored. Supervisors must SIGKILL.
process.on("SIGTERM", () => {
  console.log(
    "[mock-dispatcher] SIGTERM received and ignored. use SIGKILL (kill -9).",
  );
});

console.log(
  `[mock-dispatcher] start construct=${CONSTRUCT_NAME} pid=${process.pid}`,
);
console.log(`[mock-dispatcher] system=${SYSTEM_ROOT}`);
console.log(`[mock-dispatcher] poll=${POLL_MS}ms`);
console.log(`[mock-dispatcher] status_path=${STATUS_PATH}`);

mkdirSync(dirname(STATUS_PATH), { recursive: true });

let tickCount = 0;

function writeStatus() {
  writeFileSync(
    STATUS_PATH,
    JSON.stringify(
      {
        construct: CONSTRUCT_NAME,
        pid: process.pid,
        last_tick: new Date().toISOString(),
        poll_ms: POLL_MS,
        tick_count: tickCount,
        blocked: 0,
        lifecycle_mode: "running",
      },
      null,
      2,
    ) + "\n",
  );
}

function tick() {
  tickCount++;
  console.log(
    `[mock-dispatcher] tick #${tickCount} (active=0, blocked=0)`,
  );
  writeStatus();
}

tick();
setInterval(tick, POLL_MS);
