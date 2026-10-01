import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const KEY = `pr_test_${'k'.repeat(32)}`;

/**
 * A stand in for api.prereason.com that answers the way the real endpoint
 * does: JSON for a request, 202 for a notification, 405 for the GET stream.
 * It records every request so the test can assert on the headers the bridge
 * put on the wire.
 */
async function stubServer({ refuse } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      seen.push({ method: 'GET', headers: req.headers });
      res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
      res.end('{"error":"METHOD_NOT_ALLOWED"}');
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const frame = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      seen.push({ method: 'POST', headers: req.headers, frame });

      if (frame.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      // A canned refusal, the way the real endpoint refuses: a status, a type, a body.
      const refusal = refuse?.(frame);
      if (refusal) {
        res.writeHead(refusal.status, { 'content-type': refusal.contentType });
        res.end(refusal.body);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { echoed: frame.method } }));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { seen, port, url: `http://127.0.0.1:${port}/api/mcp`, close: () => server.close() };
}

/** Spawn the bridge and read its stdout as newline delimited frames. */
function spawnBridge(url) {
  const child = spawn(process.execPath, [CLI], {
    env: { ...process.env, PREREASON_URL: url, PREREASON_API_KEY: KEY, PREREASON_CLIENT: 'node-test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const frames = [];
  const waiters = [];
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let newline = stdout.indexOf('\n');
    while (newline !== -1) {
      frames.push(JSON.parse(stdout.slice(0, newline)));
      stdout = stdout.slice(newline + 1);
      waiters.shift()?.();
      newline = stdout.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  return {
    child,
    frames,
    stderr: () => stderr,
    send: (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`),
    /** Resolve once one more frame has come back, or fail rather than hang. */
    nextFrame: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no frame from the bridge; stderr was: ${stderr}`)), 10_000);
        waiters.push(() => {
          clearTimeout(timer);
          resolve(frames[frames.length - 1]);
        });
      }),
  };
}

test('the bridge relays stdio to Streamable HTTP and back, with the configured headers', async (t) => {
  const stub = await stubServer();
  const bridge = spawnBridge(stub.url);
  t.after(() => {
    bridge.child.kill();
    stub.close();
  });

  bridge.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'node-test', version: '0' } } });
  assert.deepEqual(await bridge.nextFrame(), { jsonrpc: '2.0', id: 1, result: { echoed: 'initialize' } });

  const [first] = stub.seen;
  assert.equal(first.headers.authorization, `Bearer ${KEY}`);
  assert.equal(first.headers['x-prereason-client'], 'node-test');
  assert.match(first.headers['user-agent'], /^prereason-mcp\/\d+\.\d+\.\d+ node\//);
  assert.equal(first.headers['content-type'], 'application/json');
  assert.equal(first.headers.accept, 'application/json, text/event-stream');
});

test('an accepted notification makes the bridge try the GET stream, and a 405 is not fatal', async (t) => {
  const stub = await stubServer();
  const bridge = spawnBridge(stub.url);
  t.after(() => {
    bridge.child.kill();
    stub.close();
  });

  bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(await bridge.nextFrame(), { jsonrpc: '2.0', id: 2, result: { echoed: 'tools/list' } });

  // The GET is opened once the 202 lands and is not awaited by send, so it
  // may still be in flight when the answer to the next request comes back.
  const deadline = Date.now() + 5000;
  while (!stub.seen.some((request) => request.method === 'GET') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const get = stub.seen.find((request) => request.method === 'GET');
  assert.ok(get, `the bridge never tried the standalone stream; stderr was: ${bridge.stderr()}`);
  assert.equal(get.headers.accept, 'text/event-stream');
  assert.equal(get.headers.authorization, `Bearer ${KEY}`);
  assert.equal(bridge.child.exitCode, null, 'the bridge exited on a 405 it should have ignored');
  assert.equal(bridge.stderr(), '', 'a 405 on the optional stream should say nothing');
});

test('closing stdin ends the bridge', async (t) => {
  const stub = await stubServer();
  const bridge = spawnBridge(stub.url);
  t.after(() => stub.close());

  bridge.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
  await bridge.nextFrame();

  bridge.child.stdin.end();
  const [code] = await once(bridge.child, 'exit');
  assert.equal(code, 0);
});

const TOOL_CALL = (id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'get_context', arguments: { briefing: 'btc.full' } } });

test('a refusal the server words as JSON-RPC reaches the host as the answer, and nothing hangs', async (t) => {
  // PreReason's 429 past the quota and its 401 to a call with no key are both
  // JSON-RPC errors. Before 0.5.2 the bridge threw on the status and the host
  // waited out its own timeout.
  const stub = await stubServer({
    refuse: (frame) =>
      frame.method === 'tools/call'
        ? { status: 429, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32029, message: 'Hourly limit reached (30/hr).' } }) }
        : undefined,
  });
  const bridge = spawnBridge(stub.url);
  t.after(() => {
    bridge.child.kill();
    stub.close();
  });

  bridge.send(TOOL_CALL(4));
  assert.deepEqual(await bridge.nextFrame(), { jsonrpc: '2.0', id: 4, error: { code: -32029, message: 'Hourly limit reached (30/hr).' } });
});

test('a request answered with an error page still gets an answer the host can read', async (t) => {
  const stub = await stubServer({
    refuse: (frame) => (frame.method === 'tools/call' ? { status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' } : undefined),
  });
  const bridge = spawnBridge(stub.url);
  t.after(() => {
    bridge.child.kill();
    stub.close();
  });

  bridge.send(TOOL_CALL(5));
  assert.deepEqual(await bridge.nextFrame(), {
    jsonrpc: '2.0',
    id: 5,
    error: { code: -32000, message: 'The PreReason bridge could not relay this request: HTTP 502.' },
  });
});
