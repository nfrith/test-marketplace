#!/usr/bin/env bun
// daemon — the would-be detached daemon. NOT an MCP server.
//
// Purpose: write a heartbeat to /tmp/dst/daemon-heartbeat.json every 1s and
// run forever. Captures process.ppid each tick so we can detect reparenting
// to init (a PPID flip to 1 mid-flight = orphaned to init = detach worked).
//
// Deliberately has NO signal handlers — we want to observe whether Claude
// Code's MCP kill mechanism reaches this process.

import { writeFile } from "node:fs/promises";

const BUILD = "v1";
const STARTED_AT = new Date().toISOString();
const HEARTBEAT_PATH = "/tmp/dst/daemon-heartbeat.json";

let tickCount = 0;

async function tick() {
  tickCount++;
  const payload = {
    pid: process.pid,
    ppid: process.ppid,
    started_at: STARTED_AT,
    build: BUILD,
    tick_count: tickCount,
    last_tick: new Date().toISOString(),
  };
  try {
    await writeFile(HEARTBEAT_PATH, JSON.stringify(payload, null, 2) + "\n");
  } catch {
    // best-effort; don't crash on transient fs errors
  }
}

setInterval(tick, 1000);
tick();
