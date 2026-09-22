/**
 * The stdio half of the bridge: newline delimited JSON-RPC over this process's
 * stdin and stdout, which is the transport Claude Desktop and every other
 * stdio only host speaks.
 *
 * This is a direct replacement for StdioServerTransport in
 * @modelcontextprotocol/sdk, kept to the same framing and the same callback
 * surface (onmessage, onerror, onclose) so bin/cli.js wires it up unchanged.
 * It is here rather than imported because the SDK cannot ship that class on
 * its own: taking it pulled in 90 packages and 22 MB, every one of them for
 * the server and OAuth code a relay never reaches.
 */

import process from 'node:process';
import { assertJsonRpcMessage } from './jsonrpc.js';

/** One line in, one frame out, throwing on anything that is not a frame. */
export function deserializeLine(line) {
  return assertJsonRpcMessage(JSON.parse(line));
}

/** Ten megabytes, the SDK's ceiling. A line longer than this is not a frame. */
export const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

/** Buffers a byte stream into whole lines, each of which is one JSON-RPC frame. */
export class ReadBuffer {
  #buffer;
  #maxBufferSize;

  constructor({ maxBufferSize = MAX_BUFFER_SIZE } = {}) {
    this.#maxBufferSize = maxBufferSize;
  }

  append(chunk) {
    const size = (this.#buffer?.length ?? 0) + chunk.length;
    if (size > this.#maxBufferSize) {
      this.clear();
      throw new Error(`ReadBuffer exceeded maximum size of ${this.#maxBufferSize} bytes`);
    }
    this.#buffer = this.#buffer ? Buffer.concat([this.#buffer, chunk]) : chunk;
  }

  /** The next whole line as a parsed frame, or null while one is still arriving. */
  readMessage(deserialize) {
    if (!this.#buffer) {
      return null;
    }
    const newline = this.#buffer.indexOf('\n');
    if (newline === -1) {
      return null;
    }
    const line = this.#buffer.toString('utf8', 0, newline).replace(/\r$/, '');
    this.#buffer = this.#buffer.subarray(newline + 1);
    return deserialize(line);
  }

  clear() {
    this.#buffer = undefined;
  }
}

export class StdioServerTransport {
  #stdin;
  #stdout;
  #readBuffer;
  #started = false;
  #deserialize;

  onmessage;
  onerror;
  onclose;

  /**
   * @param deserialize turns one line into a frame and throws on anything
   *   that is not one. Injected so the shape check lives in one place and the
   *   tests can drive the framing without it.
   */
  constructor({ stdin = process.stdin, stdout = process.stdout, maxBufferSize, deserialize = deserializeLine } = {}) {
    this.#stdin = stdin;
    this.#stdout = stdout;
    this.#readBuffer = new ReadBuffer({ maxBufferSize });
    this.#deserialize = deserialize;
  }

  // Arrow properties, so the same function identity comes off the emitter in
  // close() as went on in start().
  #ondata = (chunk) => {
    try {
      this.#readBuffer.append(chunk);
      this.#drainReadBuffer();
    } catch (error) {
      this.onerror?.(error);
      this.close().catch(() => {});
    }
  };

  #onstdinerror = (error) => {
    this.onerror?.(error);
  };

  async start() {
    if (this.#started) {
      throw new Error('StdioServerTransport already started');
    }
    this.#started = true;
    this.#stdin.on('data', this.#ondata);
    this.#stdin.on('error', this.#onstdinerror);
  }

  /**
   * A frame that will not parse is reported and skipped, never fatal: one bad
   * line from the host must not take down a session whose next line is fine.
   */
  #drainReadBuffer() {
    while (true) {
      try {
        const message = this.#readBuffer.readMessage(this.#deserialize);
        if (message === null) {
          return;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  async close() {
    this.#stdin.off('data', this.#ondata);
    this.#stdin.off('error', this.#onstdinerror);
    // Only pause stdin if nothing else is reading it, so the bridge never
    // stalls a host that shares the descriptor.
    if (this.#stdin.listenerCount('data') === 0) {
      this.#stdin.pause();
    }
    this.#readBuffer.clear();
    this.onclose?.();
  }

  send(message) {
    return new Promise((resolve) => {
      if (this.#stdout.write(`${JSON.stringify(message)}\n`)) {
        resolve();
      } else {
        this.#stdout.once('drain', resolve);
      }
    });
  }
}
