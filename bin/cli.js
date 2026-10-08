#!/usr/bin/env node
/**
 * @prereason/mcp: the stdio bridge to PreReason's Streamable HTTP MCP endpoint.
 *
 * Connects a stdio only client (Claude Desktop and others) to
 * https://api.prereason.com/api/mcp.
 *
 * Where the key comes from, highest first:
 *   PREREASON_API_KEY in the environment
 *   --header "Authorization:Bearer pr_live_..."
 *   the credentials file (~/.prereason/credentials.json, or PREREASON_CREDENTIALS_FILE)
 *   no key: the bridge asks for access. It prints one link, the person opens it and
 *   approves, and the key arrives here and is saved. Free tools work meanwhile.
 *
 * Usage:
 *   npx @prereason/mcp
 *   npx @prereason/mcp --login          request access now and save the key, then exit
 *   npx @prereason/mcp --logout         delete the saved key, then exit
 *   npx @prereason/mcp [--header Key:Value]... [--credentials-file <path>] [<URL>]
 *
 * Environment:
 *   PREREASON_API_KEY           Your API key (adds Authorization: Bearer)
 *   PREREASON_URL               Override the endpoint URL
 *   PREREASON_CREDENTIALS_FILE  Where a claimed key is kept
 *   PREREASON_CLIENT            The app this bridge runs in (claude-desktop, cursor, ...),
 *                               sent as X-PreReason-Client so your dashboard names it
 */

import { platform } from 'node:os';
import { StdioServerTransport } from '../lib/stdio.js';
import { StreamableHttpClientTransport } from '../lib/streamable-http.js';
import { credentialsPath, deleteCredentials, parseArgs, resolveApiKey } from '../lib/credentials.js';
import { decorateForClaimState, runClaimFlow } from '../lib/claim.js';
import { failureResponse } from '../lib/jsonrpc.js';

// Keep in sync with package.json on each release
const PKG_NAME = '@prereason/mcp';
const PKG_VERSION = '0.5.4';
const DEFAULT_URL = 'https://api.prereason.com/api/mcp';
const USER_AGENT = `prereason-mcp/${PKG_VERSION} node/${process.versions.node} (${platform()})`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stderr.write(`${PKG_NAME} v${PKG_VERSION}\n\n`);
  process.stderr.write('Usage:\n');
  process.stderr.write('  npx @prereason/mcp                      run the bridge (asks for access when no key is configured)\n');
  process.stderr.write('  npx @prereason/mcp --login              request access now, save the key, exit\n');
  process.stderr.write('  npx @prereason/mcp --logout             delete the saved key, exit\n');
  process.stderr.write('  npx @prereason/mcp [--header Key:Value]... [--credentials-file <path>] [<URL>]\n\n');
  process.stderr.write('Environment variables:\n');
  process.stderr.write('  PREREASON_API_KEY            Your API key (adds Authorization: Bearer header)\n');
  process.stderr.write('  PREREASON_URL                Override the default endpoint URL\n');
  process.stderr.write('  PREREASON_CREDENTIALS_FILE   Where a claimed key is kept (default ~/.prereason/credentials.json)\n');
  process.stderr.write('  PREREASON_CLIENT             The app this bridge runs in, e.g. claude-desktop\n\n');
  process.stderr.write('Options:\n');
  process.stderr.write('  --header Key:Value           Add an HTTP header (can be repeated)\n');
  process.stderr.write('  --credentials-file <path>    Use this credentials file\n');
  process.stderr.write('  --login                      Ask for access now and save the key\n');
  process.stderr.write('  --logout                     Forget the saved key\n');
  process.stderr.write('  --help, -h                   Show this help\n');
  process.stderr.write('  --version, -v                Show version\n\n');
  process.stderr.write(`Default URL: ${DEFAULT_URL}\n`);
  process.exit(0);
}

if (args.version) {
  process.stderr.write(`${PKG_VERSION}\n`);
  process.exit(0);
}

// --- Resolve the endpoint, the headers and the key ---
const url = new URL(args.url || process.env.PREREASON_URL || DEFAULT_URL);
const credentialsFile = credentialsPath({ env: process.env, flag: args.credentialsFile });

if (args.logout) {
  const existed = deleteCredentials(credentialsFile);
  process.stderr.write(existed ? `PreReason: removed ${credentialsFile}\n` : `PreReason: nothing saved at ${credentialsFile}\n`);
  process.exit(0);
}

/** Headers every request carries. The claim flow adds Authorization to this same object once a key arrives. */
const headers = { 'User-Agent': USER_AGENT, ...args.headers };

// Which app this bridge runs in, forwarded as X-PreReason-Client so the
// dashboard can name the connection. Only the documented ids are useful, and
// only a header safe value is ever sent.
const clientApp = /^[a-z0-9-]{1,32}$/.test(process.env.PREREASON_CLIENT || '') ? process.env.PREREASON_CLIENT : null;
if (clientApp) headers['X-PreReason-Client'] = clientApp;

const resolved = resolveApiKey({ env: process.env, headers: args.headers, credentialsFile });
if (resolved.key && !Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')) {
  headers.Authorization = `Bearer ${resolved.key}`;
}

const claimContext = {
  mcpUrl: url.toString(),
  headers,
  clientName: `${PKG_NAME} ${PKG_VERSION} (${platform()})`,
  purpose: clientApp ? `MCP bridge for ${clientApp}` : 'MCP bridge on this computer',
  credentialsFile,
  requestHeaders: clientApp ? { 'user-agent': USER_AGENT, 'x-prereason-client': clientApp } : { 'user-agent': USER_AGENT },
};

// --- --login: run the claim flow in the foreground and exit ---
if (args.login) {
  if (resolved.key && resolved.source !== 'file') {
    process.stderr.write(`PreReason: a key is already configured through ${resolved.source === 'env' ? 'PREREASON_API_KEY' : '--header'}; --login is for the credentials file. Nothing to do.\n`);
    process.exit(0);
  }
  const outcome = await runClaimFlow(claimContext);
  process.exit(outcome.outcome === 'approved' ? 0 : 1);
}

// --- Transports: stdio to the host, Streamable HTTP to PreReason ---
const stdio = new StdioServerTransport();
const http = new StreamableHttpClientTransport(url, { requestInit: { headers } });

/**
 * What AUTH_REQUIRED tool results carry: the approve link while a claim is
 * pending, or the key limit notice once a claim ended there.
 */
const pending = { approveUrl: null, claimCode: null, notice: null };

stdio.onmessage = (msg) => {
  http.send(msg).catch((e) => {
    process.stderr.write(`[prereason:send] ${e.message}\n`);
    // Never leave the host waiting on an id that will not come back: a
    // request the relay could not deliver gets an error answer of its own.
    const answer = failureResponse(msg, e);
    if (answer) {
      stdio.send(answer).catch((err) => {
        process.stderr.write(`[prereason:recv] ${err.message}\n`);
      });
    }
  });
};

http.onmessage = (msg) => {
  stdio.send(decorateForClaimState(msg, pending)).catch((e) => {
    process.stderr.write(`[prereason:recv] ${e.message}\n`);
  });
};

stdio.onerror = (e) => process.stderr.write(`[prereason:stdio] ${e.message}\n`);
http.onerror = (e) => process.stderr.write(`[prereason:http] ${e.message}\n`);

stdio.onclose = () => {
  http.close();
  process.exit(0);
};

http.onclose = () => {
  stdio.close();
  process.exit(0);
};

// Start serving first: the host must never see "server disconnected" because
// a claim is waiting on a person. The free tools work without a key.
await http.start();
await stdio.start();

if (!resolved.key) {
  // Fire and forget: the flow logs its own lines and attaches the key to
  // `headers` when the person approves, which the transport reads per request.
  runClaimFlow({ ...claimContext, state: pending }).catch((e) => {
    process.stderr.write(`[prereason:claim] ${e.message}\n`);
  });
}
