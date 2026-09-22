import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamableHttpClientTransport, StreamableHttpError } from '../lib/streamable-http.js';

const URL_UNDER_TEST = 'https://api.prereason.test/api/mcp';
const REQUEST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const NOTIFICATION = { jsonrpc: '2.0', method: 'notifications/initialized' };
const RESULT = { jsonrpc: '2.0', id: 1, result: { tools: [] } };

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function sse(text, { status = 200, headers = {} } = {}) {
  return new Response(text, { status, headers: { 'content-type': 'text/event-stream', ...headers } });
}

/**
 * A transport whose fetch is a queue of canned responses, recording every
 * request it was asked to make.
 */
function harness(responses, { requestInit } = {}) {
  const calls = [];
  const queue = [...responses];

  const transport = new StreamableHttpClientTransport(URL_UNDER_TEST, {
    requestInit,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      const next = queue.shift();
      if (!next) {
        throw new Error(`no canned response for ${init.method} ${url}`);
      }
      return typeof next === 'function' ? next() : next;
    },
  });

  const messages = [];
  const errors = [];
  transport.onmessage = (message) => messages.push(message);
  transport.onerror = (error) => errors.push(error);

  return { transport, calls, messages, errors };
}

/** Let a not awaited stream read finish before asserting on it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a request is POSTed as JSON and the answer reaches onmessage', async () => {
  const h = harness([json(RESULT)]);
  await h.transport.start();
  await h.transport.send(REQUEST);

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, 'POST');
  assert.equal(h.calls[0].url, URL_UNDER_TEST);
  assert.equal(h.calls[0].body, JSON.stringify(REQUEST));
  assert.equal(h.calls[0].headers.get('content-type'), 'application/json');
  assert.equal(h.calls[0].headers.get('accept'), 'application/json, text/event-stream');
  assert.deepEqual(h.messages, [RESULT]);
});

test('a content type with parameters is still JSON', async () => {
  const h = harness([json(RESULT, { headers: { 'content-type': 'Application/JSON; charset=utf-8' } })]);
  await h.transport.start();
  await h.transport.send(REQUEST);
  assert.deepEqual(h.messages, [RESULT]);
});

test('an array of frames is forwarded one at a time', async () => {
  const second = { jsonrpc: '2.0', id: 2, result: {} };
  const h = harness([json([RESULT, second])]);
  await h.transport.start();
  await h.transport.send([REQUEST, { jsonrpc: '2.0', id: 2, method: 'ping' }]);
  assert.deepEqual(h.messages, [RESULT, second]);
});

test('a header set after start rides on the next request', async () => {
  // The claim flow attaches Authorization to this same object minutes after
  // the transport started. Copying the headers once would mean the key never
  // reaches the server without a restart.
  const headers = { 'User-Agent': 'prereason-mcp/test' };
  const h = harness([json(RESULT), json(RESULT)], { requestInit: { headers } });
  await h.transport.start();

  await h.transport.send(REQUEST);
  assert.equal(h.calls[0].headers.get('authorization'), null);

  headers.Authorization = 'Bearer pr_live_x';
  await h.transport.send(REQUEST);
  assert.equal(h.calls[1].headers.get('authorization'), 'Bearer pr_live_x');
  assert.equal(h.calls[1].headers.get('user-agent'), 'prereason-mcp/test');
});

test('a session handed out on the first answer is sent back on the next request', async () => {
  const h = harness([json(RESULT, { headers: { 'mcp-session-id': 's-42' } }), json(RESULT)]);
  await h.transport.start();

  await h.transport.send(REQUEST);
  assert.equal(h.calls[0].headers.get('mcp-session-id'), null);
  assert.equal(h.transport.sessionId, 's-42');

  await h.transport.send(REQUEST);
  assert.equal(h.calls[1].headers.get('mcp-session-id'), 's-42');
});

test('an accepted initialized notification tries the GET stream, and a 405 is quiet', async () => {
  // PreReason's endpoint answers 405 here on purpose: it is POST only. That
  // is the server saying it has no stream, not an error worth reporting.
  const h = harness([
    new Response(null, { status: 202 }),
    new Response('{"error":"METHOD_NOT_ALLOWED"}', { status: 405, headers: { allow: 'POST' } }),
  ]);
  await h.transport.start();
  await h.transport.send(NOTIFICATION);
  await settle();

  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].method, 'GET');
  assert.equal(h.calls[1].headers.get('accept'), 'text/event-stream');
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.messages, []);
});

test('any other accepted notification opens nothing', async () => {
  const h = harness([new Response(null, { status: 202 })]);
  await h.transport.start();
  await h.transport.send({ jsonrpc: '2.0', method: 'notifications/cancelled' });
  await settle();
  assert.equal(h.calls.length, 1);
});

test('a 200 with nothing asked reads no body and calls nothing back', async () => {
  const h = harness([json({ jsonrpc: '2.0', result: {} })]);
  await h.transport.start();
  await h.transport.send({ jsonrpc: '2.0', method: 'notifications/cancelled' });
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.errors, []);
});

test('a failing status throws with the body and reports through onerror', async () => {
  const h = harness([new Response('rate limited', { status: 429 })]);
  await h.transport.start();

  await assert.rejects(() => h.transport.send(REQUEST), (error) => {
    assert.ok(error instanceof StreamableHttpError);
    assert.equal(error.code, 429);
    assert.match(error.message, /rate limited/);
    return true;
  });
  assert.equal(h.errors.length, 1);
});

test('an unexpected content type is an error rather than a silent drop', async () => {
  const h = harness([new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })]);
  await h.transport.start();
  await assert.rejects(() => h.transport.send(REQUEST), /Unexpected content type: text\/html/);
});

test('an event stream answer is forwarded event by event', async () => {
  const h = harness([sse(`event: message\ndata: ${JSON.stringify(RESULT)}\n\n: keep alive\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n\n`)]);
  await h.transport.start();
  await h.transport.send(REQUEST);
  await settle();

  assert.deepEqual(h.messages, [RESULT, { jsonrpc: '2.0', method: 'notifications/progress' }]);
  assert.deepEqual(h.errors, []);
});

test('one unparseable event does not end the stream', async () => {
  const h = harness([sse(`data: {"broken"\n\ndata: ${JSON.stringify(RESULT)}\n\n`)]);
  await h.transport.start();
  await h.transport.send(REQUEST);
  await settle();

  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.messages, [RESULT]);
});

test('an event that is not a message event is skipped', async () => {
  const h = harness([sse(`event: ping\ndata: nonsense\n\ndata: ${JSON.stringify(RESULT)}\n\n`)]);
  await h.transport.start();
  await h.transport.send(REQUEST);
  await settle();

  assert.deepEqual(h.messages, [RESULT]);
  assert.deepEqual(h.errors, []);
});

test('starting twice is an error', async () => {
  const h = harness([]);
  await h.transport.start();
  await assert.rejects(() => h.transport.start(), /already started/);
});

test('close aborts in flight work and fires onclose once', async () => {
  const h = harness([]);
  let closed = 0;
  h.transport.onclose = () => {
    closed += 1;
  };
  await h.transport.start();
  await h.transport.close();
  assert.equal(closed, 1);
});
