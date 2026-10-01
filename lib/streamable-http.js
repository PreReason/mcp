/**
 * The HTTP half of the bridge: MCP Streamable HTTP, client side.
 *
 * A direct replacement for StreamableHTTPClientTransport in
 * @modelcontextprotocol/sdk, narrowed to what a relay does. It POSTs a frame,
 * reads the answer as JSON or as an event stream, carries Mcp-Session-Id back
 * on later requests, and opens the optional GET stream once the session is
 * initialized. The SDK's OAuth client, its schema validation and its session
 * termination are gone: the bridge authenticates with a bearer header it is
 * handed, forwards frames without reading them, and is torn down by the host
 * closing stdin.
 *
 * Headers are read from requestInit on every request rather than copied once,
 * because the claim flow attaches Authorization to that same object minutes
 * after the transport started, and the next request has to carry it.
 */

import { assertJsonRpcPayload, expectsResponse } from './jsonrpc.js';
import { readEventStream } from './sse.js';

/** The SDK's reconnection defaults, kept so a resumable server sees no change. */
const RECONNECT = {
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  growthFactor: 1.5,
  maxRetries: 2,
};

export class StreamableHttpError extends Error {
  constructor(code, message) {
    super(`Streamable HTTP error: ${message}`);
    this.name = 'StreamableHttpError';
    this.code = code;
  }
}

/** "application/json; charset=utf-8" is the same media type as "application/json". */
function mediaType(contentType) {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/** Headers arrive as an object, a Headers, or an array of pairs. */
function toPlainHeaders(headers) {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

/** Release a body we are not going to read, so the socket goes back to the pool. */
async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {
    // A body already consumed or already errored needs nothing from us.
  }
}

export class StreamableHttpClientTransport {
  #url;
  #requestInit;
  #fetch;
  #sessionId;
  #abortController;
  #reconnectTimer;
  #serverRetryMs;

  onmessage;
  onerror;
  onclose;

  constructor(url, { requestInit, fetch: fetchImpl = fetch, sessionId } = {}) {
    this.#url = url;
    this.#requestInit = requestInit;
    this.#fetch = fetchImpl;
    this.#sessionId = sessionId;
  }

  get sessionId() {
    return this.#sessionId;
  }

  async start() {
    if (this.#abortController) {
      throw new Error('StreamableHttpClientTransport already started');
    }
    this.#abortController = new AbortController();
  }

  async close() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#abortController?.abort();
    this.onclose?.();
  }

  /**
   * The session header first, then whatever the caller configured, so a header
   * passed with --header or set by the claim flow wins over ours.
   */
  #headers() {
    const headers = new Headers();
    if (this.#sessionId) {
      headers.set('mcp-session-id', this.#sessionId);
    }
    for (const [name, value] of Object.entries(toPlainHeaders(this.#requestInit?.headers))) {
      if (value !== undefined && value !== null) {
        headers.set(name, String(value));
      }
    }
    return headers;
  }

  async send(message) {
    try {
      const headers = this.#headers();
      headers.set('content-type', 'application/json');
      headers.set('accept', 'application/json, text/event-stream');

      const response = await this.#fetch(this.#url, {
        ...this.#requestInit,
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: this.#abortController?.signal,
      });

      // Stateful servers hand out a session on initialize and expect it back.
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId) {
        this.#sessionId = sessionId;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => null);
        // A refusal the server words as JSON-RPC (a 401 "Authentication
        // required for this tool.", a 429 past the quota) is still the answer
        // to this request, so it goes to the host like any other and the model
        // reads it. Thrown, it only reached stderr and the host waited out its
        // own timeout. Anything else, an HTML error page say, still fails.
        if (expectsResponse(message) && this.#emitAnswers(body)) {
          return;
        }
        throw new StreamableHttpError(response.status, `Error POSTing to endpoint: ${body}`);
      }

      if (response.status === 202) {
        await discard(response);
        // The server accepted the notification and said nothing back. Once the
        // session is initialized, that is the moment to try the GET stream a
        // server may use to push messages. PreReason 405s it, which is fine.
        if (!Array.isArray(message) && message?.method === 'notifications/initialized') {
          this.#openServerStream({}).catch((error) => this.onerror?.(error));
        }
        return;
      }

      if (!expectsResponse(message)) {
        // Nothing was asked, so nothing is read. The body still has to be
        // released or the connection is held open until it times out.
        await discard(response);
        return;
      }

      const type = mediaType(response.headers.get('content-type'));
      if (type === 'application/json') {
        this.#emit(await response.json());
        return;
      }
      if (type === 'text/event-stream') {
        // Not awaited: the answer arrives through onmessage as the stream
        // yields it, and send() should not stay pending for a tool call that
        // streams for a minute.
        this.#readStream(response, { reconnectable: false }).catch((error) => this.onerror?.(error));
        return;
      }

      await discard(response);
      throw new StreamableHttpError(-1, `Unexpected content type: ${response.headers.get('content-type')}`);
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
  }

  /**
   * Forward a refusal's body when it is JSON-RPC answers, every frame carrying
   * a result or an error, and say whether it was. Nothing is forwarded
   * otherwise, so a body that is not an answer can never reach the host.
   */
  #emitAnswers(text) {
    let frames;
    try {
      frames = assertJsonRpcPayload(JSON.parse(text));
    } catch {
      return false;
    }
    const list = Array.isArray(frames) ? frames : [frames];
    if (!list.every((frame) => 'result' in frame || 'error' in frame)) {
      return false;
    }
    for (const frame of list) {
      this.onmessage?.(frame);
    }
    return true;
  }

  /** One JSON payload, one or many frames, each forwarded to the host. */
  #emit(payload) {
    let frames;
    try {
      frames = assertJsonRpcPayload(payload);
    } catch (error) {
      this.onerror?.(error);
      return;
    }
    for (const frame of Array.isArray(frames) ? frames : [frames]) {
      this.onmessage?.(frame);
    }
  }

  /**
   * Read an event stream to the end, forwarding every message event.
   *
   * A frame that will not parse is reported and skipped rather than ending the
   * stream, because the next event is usually fine.
   */
  async #readStream(response, { reconnectable, lastEventId: startingEventId }) {
    let lastEventId = startingEventId;
    let sawResponse = false;
    let sawEventId = false;

    try {
      await readEventStream(response.body, {
        onRetry: (retryMs) => {
          this.#serverRetryMs = retryMs;
        },
        onEvent: (event) => {
          if (event.id) {
            lastEventId = event.id;
            sawEventId = true;
          }
          if (event.event && event.event !== 'message') {
            return;
          }
          let frame;
          try {
            frame = assertJsonRpcPayload(JSON.parse(event.data));
          } catch (error) {
            this.onerror?.(error);
            return;
          }
          for (const one of Array.isArray(frame) ? frame : [frame]) {
            if ('result' in one || 'error' in one) {
              sawResponse = true;
            }
            this.onmessage?.(one);
          }
        },
      });
    } catch (error) {
      this.onerror?.(new Error(`SSE stream disconnected: ${error}`));
    }

    // Reconnect the standalone GET stream, and a POST stream that carried an
    // event id, which is the server saying where to resume from. Never once
    // the answer has arrived: that request is finished, and reopening the
    // stream would only replay it.
    const canResume = reconnectable || sawEventId;
    if (canResume && !sawResponse && this.#abortController && !this.#abortController.signal.aborted) {
      this.#scheduleReconnect(lastEventId, 0);
    }
  }

  #scheduleReconnect(lastEventId, attempt) {
    if (attempt >= RECONNECT.maxRetries) {
      this.onerror?.(new Error(`Maximum reconnection attempts (${RECONNECT.maxRetries}) exceeded.`));
      return;
    }
    const backoff = RECONNECT.initialDelayMs * RECONNECT.growthFactor ** attempt;
    const delay = this.#serverRetryMs ?? Math.min(backoff, RECONNECT.maxDelayMs);

    this.#reconnectTimer = setTimeout(() => {
      this.#openServerStream({ lastEventId }).catch((error) => {
        this.onerror?.(new Error(`Failed to reconnect SSE stream: ${error instanceof Error ? error.message : String(error)}`));
        this.#scheduleReconnect(lastEventId, attempt + 1);
      });
    }, delay);
  }

  /**
   * Open the optional GET stream a server may use to push messages.
   *
   * 405 is the documented way for a server to say it has no such stream, and
   * PreReason's endpoint answers exactly that, so it is a quiet return and not
   * an error.
   */
  async #openServerStream({ lastEventId }) {
    const headers = this.#headers();
    headers.set('accept', 'text/event-stream');
    if (lastEventId) {
      headers.set('last-event-id', lastEventId);
    }

    const response = await this.#fetch(this.#url, {
      ...this.#requestInit,
      method: 'GET',
      headers,
      signal: this.#abortController?.signal,
    });

    if (!response.ok) {
      await discard(response);
      if (response.status === 405) {
        return;
      }
      throw new StreamableHttpError(response.status, `Failed to open SSE stream: ${response.statusText}`);
    }

    // Not awaited: the stream runs for the life of the session while send()
    // keeps working. Errors inside it go to onerror.
    this.#readStream(response, { reconnectable: true, lastEventId }).catch((error) => this.onerror?.(error));
  }
}
