#!/usr/bin/env node
/**
 * @prereason/mcp — MCP bridge for Claude Desktop
 *
 * Connects Claude Desktop (stdio) to PreReason's Streamable HTTP MCP endpoint.
 *
 * Auth (preferred — works on all platforms):
 *   Set PREREASON_API_KEY env var in your MCP client config.
 *
 * Usage:
 *   npx @prereason/mcp
 *   npx @prereason/mcp [--header Key:Value]...
 *   npx @prereason/mcp <URL> [--header Key:Value]...
 *
 * Environment variables:
 *   PREREASON_API_KEY   Your API key (adds Authorization: Bearer header)
 *   PREREASON_URL       Override the default endpoint URL
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Keep in sync with package.json on each release
const PKG_NAME = '@prereason/mcp';
const PKG_VERSION = '0.1.9';
const DEFAULT_URL = 'https://api.prereason.com/api/mcp';

// --- Help / Version ---
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(`${PKG_NAME} v${PKG_VERSION}\n\n`);
  process.stderr.write('Usage:\n');
  process.stderr.write('  npx @prereason/mcp\n');
  process.stderr.write('  npx @prereason/mcp [--header Key:Value]...\n\n');
  process.stderr.write('Environment variables (recommended):\n');
  process.stderr.write('  PREREASON_API_KEY    Your API key (adds Authorization: Bearer header)\n');
  process.stderr.write('  PREREASON_URL        Override the default endpoint URL\n\n');
  process.stderr.write('Options:\n');
  process.stderr.write('  --header Key:Value   Add HTTP header (can be repeated)\n');
  process.stderr.write('  --help, -h           Show this help\n');
  process.stderr.write('  --version, -v        Show version\n\n');
  process.stderr.write(`Default URL: ${DEFAULT_URL}\n`);
  process.exit(0);
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stderr.write(`${PKG_VERSION}\n`);
  process.exit(0);
}

// --- Read environment variables (preferred, avoids Windows cmd.exe quoting issues) ---
let urlArg = process.env.PREREASON_URL || DEFAULT_URL;
const headers = {};

if (process.env.PREREASON_API_KEY) {
  headers['Authorization'] = `Bearer ${process.env.PREREASON_API_KEY}`;
}

// --- Parse CLI arguments (override env vars) ---
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--header' && process.argv[i + 1]) {
    const val = process.argv[++i];
    const colonIdx = val.indexOf(':');
    if (colonIdx > 0) {
      headers[val.slice(0, colonIdx).trim()] = val.slice(colonIdx + 1).trim();
    }
  } else if (!process.argv[i].startsWith('-')) {
    urlArg = process.argv[i];
  }
}

const url = new URL(urlArg);

// --- Create transports ---
const stdio = new StdioServerTransport();
const http = new StreamableHTTPClientTransport(url, {
  requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
});

// --- Wire message routing ---
stdio.onmessage = (msg) => {
  http.send(msg).catch((e) => {
    process.stderr.write(`[prereason:send] ${e.message}\n`);
  });
};

http.onmessage = (msg) => {
  stdio.send(msg).catch((e) => {
    process.stderr.write(`[prereason:recv] ${e.message}\n`);
  });
};

// --- Error handling ---
stdio.onerror = (e) => process.stderr.write(`[prereason:stdio] ${e.message}\n`);
http.onerror = (e) => process.stderr.write(`[prereason:http] ${e.message}\n`);

// --- Graceful shutdown ---
stdio.onclose = () => {
  http.close();
  process.exit(0);
};

http.onclose = () => {
  stdio.close();
  process.exit(0);
};

// --- Start ---
await http.start();
await stdio.start();
