#!/usr/bin/env bun
// dumber-mcp — a minimal MCP server with ZERO model-facing tools.
//
// Purpose: test whether an MCP server can be useful purely as a long-running
// process container, with no model-facing tool surface. This is the pattern
// pulse and dashboard would adopt: they don't need to be callable by Claude,
// they just need to run.
//
// Proof-of-life: writes a heartbeat to /tmp/dumber-mcp-heartbeat.json every
// 1s. The file is the *only* output. We verify the server is alive by
// watching the file's last_tick advance, not by calling any tool.

import { writeFile } from "node:fs/promises";

const BUILD = "v1";
const PROTOCOL_VERSION = "2025-11-25";
const STARTED_AT = new Date().toISOString();
const HEARTBEAT_PATH = "/tmp/dumber-mcp-heartbeat.json";

let tickCount = 0;

async function tick() {
  tickCount++;
  const payload = {
    pid: process.pid,
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
        serverInfo: { name: "dumber-mcp", version: BUILD },
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
