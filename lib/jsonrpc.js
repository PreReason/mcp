/**
 * The smallest shape check that keeps garbage out of the relay.
 *
 * The bridge forwards JSON-RPC frames between a stdio host and PreReason's
 * HTTP endpoint without reading them, so it has no reason to validate methods
 * or params, and no reason to carry a schema library to do it. It only has to
 * be sure that what it forwards is a JSON-RPC object: a host that receives a
 * bare string or a number on stdout treats the stream as corrupt and drops the
 * connection, which is the one failure the relay must not cause itself.
 */

/** A single JSON-RPC 2.0 frame: an object, not an array, tagged "2.0". */
export function isJsonRpcMessage(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.jsonrpc === '2.0';
}

/**
 * Throws on anything that is not one JSON-RPC message.
 *
 * Used on the stdio side, which is framed one message per line and has never
 * carried a batch.
 */
export function assertJsonRpcMessage(value) {
  if (!isJsonRpcMessage(value)) {
    throw new Error('not a JSON-RPC 2.0 message');
  }
  return value;
}

/**
 * Throws on anything that is not a JSON-RPC message or an array of them.
 *
 * Used on the HTTP side. Batching left the MCP spec in 2025-06-18, but a
 * server is still free to answer with an array and the relay should pass it
 * on rather than decide the stream is broken.
 */
export function assertJsonRpcPayload(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error('empty JSON-RPC batch');
    }
    for (const entry of value) {
      if (!isJsonRpcMessage(entry)) {
        throw new Error('batch entry is not a JSON-RPC 2.0 message');
      }
    }
    return value;
  }
  return assertJsonRpcMessage(value);
}

/**
 * True when the frame expects an answer, which is what decides whether a POST
 * reads a response body or just releases the connection. A notification has a
 * method and no id; a response has an id and no method.
 */
export function expectsResponse(message) {
  const frames = Array.isArray(message) ? message : [message];
  return frames.some((frame) => typeof frame === 'object' && frame !== null && 'method' in frame && 'id' in frame && frame.id !== undefined);
}
