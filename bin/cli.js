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
 *   no key: the bridge asks for access when it is needed, that is when the person
 *   asks the assistant to connect (the bridge's own connect_account tool) or an
 *   answer needs a key. The answer carries one link, the person opens it and
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
import { runClaimFlow } from '../lib/claim.js';
import {
  CONNECT_TOOL_NAME,
  Connection,
  isAuthRequired,
  isKeyRefusal,
  readHealth,
  toolResult,
  withConnectInstructions,
  withConnectTool,
} from '../lib/connect.js';
import { failureResponse } from '../lib/jsonrpc.js';

// Keep in sync with package.json on each release
const PKG_NAME = '@prereason/mcp';
const PKG_VERSION = '0.6.0';
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

const toHost = (frame) =>
  stdio.send(frame).catch((e) => {
    process.stderr.write(`[prereason:recv] ${e.message}\n`);
  });

/**
 * Requests the bridge sends on its own behalf (connect_account confirms a key
 * with get_health), answered here and never shown to the host. Their ids are
 * strings with this prefix, which no host request is told to use.
 */
const INTERNAL_ID = 'prereason-bridge-';
const internal = new Map();
let internalSeq = 0;

function askServer(method, params, timeoutMs = 10_000) {
  const id = `${INTERNAL_ID}${++internalSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      internal.delete(id);
      reject(new Error('no answer within 10 s'));
    }, timeoutMs);
    internal.set(id, (frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
    http.send({ jsonrpc: '2.0', id, method, params }).catch((e) => {
      clearTimeout(timer);
      internal.delete(id);
      reject(e);
    });
  });
}

/**
 * The account this bridge reads with: the key it holds, and the claim it runs
 * when it holds none. The claim starts when it is needed, not at start up.
 */
const connection = new Connection({
  ...claimContext,
  source: resolved.source,
  env: process.env,
  argHeaders: args.headers,
  verify: async () => readHealth(await askServer('tools/call', { name: 'get_health', arguments: {} })),
});

/** Host requests whose answers the bridge adds to: initialize (the sentence) and the first tools/list page (the tool). */
const decorate = new Map();

/** Send to PreReason; a key the server refuses is set aside and the request sent once more without it. */
async function relay(msg) {
  try {
    await http.send(msg);
  } catch (e) {
    if (isKeyRefusal(e) && connection.hasKey()) {
      connection.keyRefused();
      await http.send(msg);
      return;
    }
    throw e;
  }
}

stdio.onmessage = (msg) => {
  if (msg && msg.method === 'tools/call' && msg.params?.name === CONNECT_TOOL_NAME && msg.id !== undefined) {
    connection
      .connect()
      .then(({ text, isError }) => toHost(toolResult(msg.id, text, isError)))
      .catch((e) => toHost(toolResult(msg.id, `PreReason could not finish connecting: ${e.message}. Call connect_account again.`, true)));
    return;
  }
  if (msg && msg.id !== undefined && msg.method === 'initialize') decorate.set(msg.id, withConnectInstructions);
  if (msg && msg.id !== undefined && msg.method === 'tools/list' && !msg.params?.cursor) decorate.set(msg.id, withConnectTool);

  relay(msg).catch((e) => {
    process.stderr.write(`[prereason:send] ${e.message}\n`);
    // Never leave the host waiting on an id that will not come back: a
    // request the relay could not deliver gets an error answer of its own.
    decorate.delete(msg?.id);
    const answer = failureResponse(msg, e);
    if (answer) toHost(answer);
  });
};

async function fromServer(msg) {
  if (msg && typeof msg.id === 'string' && internal.has(msg.id)) {
    const settle = internal.get(msg.id);
    internal.delete(msg.id);
    settle(msg);
    return;
  }
  let frame = msg;
  const add = msg && msg.id !== undefined ? decorate.get(msg.id) : undefined;
  if (add) {
    decorate.delete(msg.id);
    frame = add(frame);
  }
  // An answer that needs a key asks for one now, so it can carry the link.
  if (isAuthRequired(frame) && !connection.hasKey()) await connection.ensureClaim();
  await toHost(connection.decorate(frame));
}

http.onmessage = (msg) => {
  fromServer(msg).catch((e) => {
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
  process.stderr.write(
    'PreReason: no API key yet. The free tools work now; ask the assistant to connect PreReason (connect_account), or ask for any briefing, and it shows one link to approve.\n'
  );
}
