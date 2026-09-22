import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertJsonRpcMessage, assertJsonRpcPayload, expectsResponse, isJsonRpcMessage } from '../lib/jsonrpc.js';

test('a frame is an object tagged 2.0, and nothing else is', () => {
  assert.equal(isJsonRpcMessage({ jsonrpc: '2.0', id: 1 }), true);
  assert.equal(isJsonRpcMessage({ jsonrpc: '2.0', method: 'ping' }), true);

  assert.equal(isJsonRpcMessage({ jsonrpc: 2 }), false, 'the version is the string "2.0"');
  assert.equal(isJsonRpcMessage({ id: 1 }), false);
  assert.equal(isJsonRpcMessage([{ jsonrpc: '2.0' }]), false, 'an array is not one frame');
  assert.equal(isJsonRpcMessage(null), false);
  assert.equal(isJsonRpcMessage('{"jsonrpc":"2.0"}'), false);
  assert.equal(isJsonRpcMessage(42), false);
});

test('the stdio side takes one frame and refuses a batch', () => {
  const frame = { jsonrpc: '2.0', id: 1 };
  assert.equal(assertJsonRpcMessage(frame), frame);
  assert.throws(() => assertJsonRpcMessage([frame]), /not a JSON-RPC 2.0 message/);
  assert.throws(() => assertJsonRpcMessage('hello'), /not a JSON-RPC 2.0 message/);
});

test('the HTTP side takes a frame or an array of them, and no empty array', () => {
  const frame = { jsonrpc: '2.0', id: 1 };
  assert.equal(assertJsonRpcPayload(frame), frame);
  assert.deepEqual(assertJsonRpcPayload([frame, frame]), [frame, frame]);
  assert.throws(() => assertJsonRpcPayload([]), /empty JSON-RPC batch/);
  assert.throws(() => assertJsonRpcPayload([frame, { id: 2 }]), /batch entry is not a JSON-RPC 2.0 message/);
});

test('only a frame with a method and an id expects an answer', () => {
  assert.equal(expectsResponse({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), true);
  assert.equal(expectsResponse({ jsonrpc: '2.0', method: 'notifications/initialized' }), false, 'a notification has no id');
  assert.equal(expectsResponse({ jsonrpc: '2.0', id: 1, result: {} }), false, 'a response has no method');
  assert.equal(expectsResponse({ jsonrpc: '2.0', id: undefined, method: 'ping' }), false);
  assert.equal(expectsResponse([{ jsonrpc: '2.0', method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]), true, 'one request in a batch is enough');
});
