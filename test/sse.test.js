import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseDecoder, readEventStream } from '../lib/sse.js';

/** Feed a decoder chunk by chunk and collect everything it dispatched. */
function decode(chunks, options) {
  const decoder = new SseDecoder(options);
  const events = [];
  for (const chunk of chunks) {
    events.push(...decoder.push(chunk));
  }
  return events;
}

test('a blank line dispatches the event, and the trailing newline leaves the data', () => {
  assert.deepEqual(decode(['data: {"jsonrpc":"2.0"}\n\n']), [{ id: undefined, event: undefined, data: '{"jsonrpc":"2.0"}' }]);
});

test('an event split across chunks arrives once, and only once it is whole', () => {
  const decoder = new SseDecoder();
  assert.deepEqual(decoder.push('data: {"jsonrpc":'), []);
  assert.deepEqual(decoder.push('"2.0","id":1}'), []);
  assert.deepEqual(decoder.push('\n'), []);
  assert.deepEqual(decoder.push('\n'), [{ id: undefined, event: undefined, data: '{"jsonrpc":"2.0","id":1}' }]);
});

test('a CRLF split across two chunks is one line ending, not two', () => {
  // The carriage return ends the first chunk. Treating it as a line ending
  // there would dispatch on the newline that follows, splitting one event
  // into two and losing the data.
  assert.deepEqual(decode(['data: one\r', '\ndata: two\r\n\r\n']), [{ id: undefined, event: undefined, data: 'one\ntwo' }]);
});

test('a lone carriage return ends a line, and the one held back resolves on the next chunk', () => {
  const events = decode(['data: one\rdata: two\r\r', 'data: three\n\n']);
  assert.deepEqual(events, [
    { id: undefined, event: undefined, data: 'one\ntwo' },
    { id: undefined, event: undefined, data: 'three' },
  ]);
});

test('data lines join with a newline and keep their own blank lines', () => {
  assert.deepEqual(decode(['data: a\ndata:\ndata: b\n\n']), [{ id: undefined, event: undefined, data: 'a\n\nb' }]);
});

test('exactly one space after the colon belongs to the separator', () => {
  assert.deepEqual(decode(['data:  padded\n\n'])[0].data, ' padded');
  assert.deepEqual(decode(['data:tight\n\n'])[0].data, 'tight');
});

test('a field with no colon is that field with an empty value', () => {
  assert.deepEqual(decode(['data\ndata: x\n\n'])[0].data, '\nx');
});

test('event and id ride along, and an id holding a NUL is discarded', () => {
  assert.deepEqual(decode(['event: message\nid: 42\ndata: x\n\n']), [{ id: '42', event: 'message', data: 'x' }]);
  assert.equal(decode(['id: 4\u00002\ndata: x\n\n'])[0].id, undefined);
});

test('id does not survive a dispatch', () => {
  const events = decode(['id: 1\ndata: first\n\ndata: second\n\n']);
  assert.equal(events[0].id, '1');
  assert.equal(events[1].id, undefined);
});

test('a comment line is ignored, which is how a server keeps the connection alive', () => {
  assert.deepEqual(decode([': ping\n\ndata: x\n\n']), [{ id: undefined, event: undefined, data: 'x' }]);
});

test('a block with an id and no data dispatches nothing', () => {
  assert.deepEqual(decode(['id: 7\n\n']), []);
});

test('an unknown field is ignored rather than fatal', () => {
  assert.deepEqual(decode(['nonsense: x\ndata: y\n\n']), [{ id: undefined, event: undefined, data: 'y' }]);
});

test('retry reports the server interval as a number', () => {
  const seen = [];
  decode(['retry: 2500\ndata: x\n\n'], { onRetry: (ms) => seen.push(ms) });
  assert.deepEqual(seen, [2500]);
  decode(['retry: soon\ndata: x\n\n'], { onRetry: (ms) => seen.push(ms) });
  assert.deepEqual(seen, [2500]);
});

test('readEventStream decodes a body whose chunks split a multi byte character', async () => {
  // The euro sign is three bytes. Cutting it in half between two chunks is
  // what { stream: true } on the decoder exists to survive.
  const euro = Buffer.from('data: €\n\n', 'utf8');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(euro.subarray(0, 7));
      controller.enqueue(euro.subarray(7));
      controller.close();
    },
  });

  const events = [];
  await readEventStream(body, { onEvent: (event) => events.push(event) });
  assert.deepEqual(events, [{ id: undefined, event: undefined, data: '€' }]);
});

test('readEventStream drops an event the server never terminated', async () => {
  const events = [];
  await readEventStream(new Response('data: {"half":').body, { onEvent: (event) => events.push(event) });
  assert.deepEqual(events, []);
});
