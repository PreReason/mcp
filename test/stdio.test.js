import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { MAX_BUFFER_SIZE, ReadBuffer, StdioServerTransport, deserializeLine } from '../lib/stdio.js';

/** A stdout that records what it was handed and can refuse to take more. */
function fakeStdout({ backpressure = false } = {}) {
  const out = new EventEmitter();
  out.written = [];
  out.write = (chunk) => {
    out.written.push(chunk);
    return !backpressure;
  };
  return out;
}

/** A transport over a PassThrough stdin, with every callback recorded. */
function harness(options) {
  const stdin = new PassThrough();
  const stdout = fakeStdout(options);
  const messages = [];
  const errors = [];
  let closed = 0;

  const transport = new StdioServerTransport({ stdin, stdout, ...options });
  transport.onmessage = (message) => messages.push(message);
  transport.onerror = (error) => errors.push(error);
  transport.onclose = () => {
    closed += 1;
  };

  return { stdin, stdout, transport, messages, errors, closedCount: () => closed };
}

const FRAME = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

test('a frame split across chunks is delivered once, and only once it is whole', async () => {
  const h = harness();
  await h.transport.start();

  h.stdin.write(Buffer.from('{"jsonrpc":"2.0",'));
  h.stdin.write(Buffer.from('"id":1,"method":"tools/list"}'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.messages, []);

  h.stdin.write(Buffer.from('\n'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.messages, [FRAME]);
});

test('several frames in one chunk each arrive, in order', async () => {
  const h = harness();
  await h.transport.start();

  h.stdin.write(Buffer.from('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","id":2}\n'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.messages, [{ jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: 2 }]);
});

test('a carriage return before the newline is framing, not content', async () => {
  const h = harness();
  await h.transport.start();

  h.stdin.write(Buffer.from('{"jsonrpc":"2.0","id":1}\r\n'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.messages, [{ jsonrpc: '2.0', id: 1 }]);
});

test('a line that will not parse is reported and skipped, and the next line still arrives', async () => {
  // One bad line from the host must never end the session. The host has no
  // way to resend it, and the frames behind it are usually fine.
  const h = harness();
  await h.transport.start();

  h.stdin.write(Buffer.from('not json\n{"jsonrpc":"2.0","id":2}\n'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.messages, [{ jsonrpc: '2.0', id: 2 }]);
  assert.equal(h.closedCount(), 0);
});

test('valid JSON that is not a JSON-RPC frame is rejected the same way', async () => {
  const h = harness();
  await h.transport.start();

  h.stdin.write(Buffer.from('{"hello":"world"}\n["batch"]\n42\n{"jsonrpc":"2.0","id":3}\n'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.errors.length, 3);
  assert.deepEqual(h.messages, [{ jsonrpc: '2.0', id: 3 }]);
});

test('send writes one line per frame', async () => {
  const h = harness();
  await h.transport.send(FRAME);
  assert.deepEqual(h.stdout.written, [`${JSON.stringify(FRAME)}\n`]);
});

test('send waits for drain when stdout is full', async () => {
  const h = harness({ backpressure: true });
  let settled = false;
  const sent = h.transport.send(FRAME).then(() => {
    settled = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'resolved before stdout drained');

  h.stdout.emit('drain');
  await sent;
  assert.equal(settled, true);
});

test('starting twice is an error, because two readers would split the stream', async () => {
  const h = harness();
  await h.transport.start();
  await assert.rejects(() => h.transport.start(), /already started/);
});

test('close stops reading, pauses a stdin nobody else wants, and fires onclose once', async () => {
  const h = harness();
  await h.transport.start();
  assert.equal(h.stdin.listenerCount('data'), 1);

  await h.transport.close();
  assert.equal(h.stdin.listenerCount('data'), 0);
  assert.equal(h.stdin.isPaused(), true);
  assert.equal(h.closedCount(), 1);

  h.stdin.write(Buffer.from('{"jsonrpc":"2.0","id":9}\n'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.messages, []);
});

test('close leaves stdin running when something else is reading it', async () => {
  const h = harness();
  await h.transport.start();
  h.stdin.on('data', () => {});

  await h.transport.close();
  assert.equal(h.stdin.isPaused(), false);
});

test('a chunk past the buffer ceiling throws, empties the buffer and closes', async () => {
  const h = harness({ maxBufferSize: 32 });
  await h.transport.start();

  h.stdin.write(Buffer.from('x'.repeat(64)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /exceeded maximum size of 32 bytes/);
  assert.equal(h.closedCount(), 1);
});

test('ReadBuffer keeps the default ceiling the SDK used', () => {
  assert.equal(MAX_BUFFER_SIZE, 10 * 1024 * 1024);

  const buffer = new ReadBuffer();
  buffer.append(Buffer.from('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":'));
  assert.deepEqual(buffer.readMessage(deserializeLine), { jsonrpc: '2.0', id: 1 });
  assert.equal(buffer.readMessage(deserializeLine), null);
  buffer.clear();
  assert.equal(buffer.readMessage(deserializeLine), null);
});
