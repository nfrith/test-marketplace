#!/usr/bin/env bun
/**
 * Minimal stdio MCP server for ALS lifecycle experiments.
 *
 * Exposes one tool, `ping`, returning { pid, started_at, build }. Used to
 * answer: does /reload-plugins kill+respawn the MCP host process (pid
 * changes, build flips), and does Claude Code auto-respawn the server
 * after SIGKILL?
 *
 * Hand-rolled JSON-RPC over stdio — no SDK dep, easy to audit.
 */

const BUILD = "v2";
const STARTED_AT = new Date().toISOString();
const PROTOCOL_VERSION = "2025-11-25";
const SERVER_NAME = "sandbox-mcp";
const SERVER_VERSION = "0.1.0";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

function write(msg: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(msg: JsonRpcMessage): void {
  if (msg.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }

  if (msg.method === "notifications/initialized") {
    return;
  }

  if (msg.method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "ping",
            description:
              "Returns this MCP server's pid, ISO start time, and build marker. Used for ALS lifecycle experiments — call before and after /reload-plugins or SIGKILL to detect respawn behavior.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: string };
    if (params.name === "ping") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                pid: process.pid,
                started_at: STARTED_AT,
                build: BUILD,
              }),
            },
          ],
        },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Unknown tool: ${params.name}` },
    });
    return;
  }

  if (msg.method === "ping") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }

  if (msg.id !== undefined) {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
  }
}

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line) as JsonRpcMessage;
      handle(msg);
    } catch (err) {
      process.stderr.write(`[sandbox-mcp] parse error: ${String(err)}\n`);
    }
  }
});

process.stdin.on("end", () => process.exit(0));
