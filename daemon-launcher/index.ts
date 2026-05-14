#!/usr/bin/env bun
// daemon-launcher — a minimal MCP server that, on startup, ensures a detached
// daemon process is running. ZERO model-facing tools.
//
// Purpose: test whether a detached child process (the daemon) survives Claude
// Code's MCP server kill mechanism. The unknown: when Claude Code kills the
// MCP server (session end, /reload-plugins, etc.), does that killing reach
// down into detached child processes the MCP server spawned?
//
// The launcher itself is the MCP server. Its single side effect is the
// idempotent spawn-or-adopt of the daemon at startup.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BUILD = "v1";
const PROTOCOL_VERSION = "2025-11-25";

const ALS_TEST_DIR = join(homedir(), ".als-test");
const PID_FILE = join(ALS_TEST_DIR, "daemon.pid");
const DST_DIR = "/tmp/dst";
const LAUNCHER_EVENTS = join(DST_DIR, "launcher-events.jsonl");
const DAEMON_SCRIPT = join(import.meta.dir, "..", "daemon", "index.ts");

function ensureDirs() {
  try {
    mkdirSync(ALS_TEST_DIR, { recursive: true });
  } catch {
    // best-effort
  }
  try {
    mkdirSync(DST_DIR, { recursive: true });
  } catch {
    // best-effort
  }
}

function logEvent(event: Record<string, unknown>) {
  const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + "\n";
  try {
    appendFileSync(LAUNCHER_EVENTS, line);
  } catch {
    // best-effort
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureDaemon() {
  ensureDirs();

  if (existsSync(PID_FILE)) {
    let existing: number | null = null;
    try {
      const raw = readFileSync(PID_FILE, "utf8").trim();
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) existing = parsed;
    } catch {
      // fall through to respawn
    }
    if (existing !== null && isAlive(existing)) {
      logEvent({
        event: "found-existing",
        launcher_pid: process.pid,
        existing_daemon_pid: existing,
      });
      return;
    }
    // stale pid file
    try {
      unlinkSync(PID_FILE);
    } catch {
      // best-effort
    }
  }

  try {
    const child = Bun.spawn(["bun", DAEMON_SCRIPT], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const spawnedPid = child.pid;
    try {
      writeFileSync(PID_FILE, String(spawnedPid) + "\n");
    } catch {
      // best-effort
    }
    // Allow child to outlive parent.
    child.unref?.();
    logEvent({
      event: "spawned-daemon",
      launcher_pid: process.pid,
      spawned_daemon_pid: spawnedPid,
    });
  } catch (err) {
    logEvent({
      event: "spawn-failed",
      launcher_pid: process.pid,
      error: String(err),
    });
  }
}

ensureDaemon();

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
};

function reply(id: number | string | undefined, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function errorReply(id: number | string | undefined, code: number, message: string) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
  );
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    handle(req);
  }
});

function handle(req: JsonRpcRequest) {
  switch (req.method) {
    case "initialize":
      reply(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "daemon-launcher", version: BUILD },
      });
      return;
    case "notifications/initialized":
      return;
    case "tools/list":
      reply(req.id, { tools: [] });
      return;
    case "ping":
      reply(req.id, {});
      return;
    default:
      if (req.id !== undefined) {
        errorReply(req.id, -32601, `Method not found: ${req.method}`);
      }
      return;
  }
}
