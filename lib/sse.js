/**
 * A Server-Sent Events decoder, sized for this bridge.
 *
 * PreReason's own endpoint answers POST with application/json and 405s a GET,
 * so nothing here runs against api.prereason.com today. It exists because
 * PREREASON_URL can point the bridge at any Streamable HTTP server, and the
 * transport half of that spec is allowed to answer a POST with an event
 * stream. Keeping the decoder costs forty lines and keeps the bridge honest
 * against a server that does.
 *
 * The field rules are the WHATWG ones, and the buffering rules follow
 * eventsource-parser, which is what the MCP SDK used before this file
 * replaced it:
 *
 *   a blank line dispatches, and only if data was collected
 *   data lines join with a newline, and one trailing newline is dropped
 *   one space after the colon is part of the separator, not the value
 *   a line with no colon is a field with an empty value
 *   an id holding a NUL is discarded, and id does not survive a dispatch
 *   a line starting with a colon is a comment, which is how servers keep alive
 */

/** Split text into complete lines plus the tail that has not ended yet. */
function splitLines(chunk) {
  const lines = [];
  let index = 0;

  while (index < chunk.length) {
    const cr = chunk.indexOf('\r', index);
    const lf = chunk.indexOf('\n', index);
    let end = -1;

    if (cr !== -1 && lf !== -1) {
      end = Math.min(cr, lf);
    } else if (cr !== -1) {
      // A lone carriage return at the very end may be the first half of a
      // CRLF that the next chunk completes, so hold the line back.
      end = cr === chunk.length - 1 ? -1 : cr;
    } else if (lf !== -1) {
      end = lf;
    }

    if (end === -1) {
      return [lines, chunk.slice(index)];
    }

    lines.push(chunk.slice(index, end));
    index = end + 1;
    if (chunk[index - 1] === '\r' && chunk[index] === '\n') {
      index += 1;
    }
  }

  return [lines, ''];
}

export class SseDecoder {
  #incomplete = '';
  #data = '';
  #eventType = '';
  #id;
  #onRetry;

  constructor({ onRetry } = {}) {
    this.#onRetry = onRetry;
  }

  /**
   * Feed one decoded text chunk and get back the events that completed inside
   * it. A chunk may end mid line, so the tail is carried to the next call.
   */
  push(text) {
    const [lines, incomplete] = splitLines(this.#incomplete + text);
    this.#incomplete = incomplete;

    const events = [];
    for (const line of lines) {
      const event = this.#readLine(line);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  #readLine(line) {
    if (line === '') {
      return this.#dispatch();
    }
    if (line.startsWith(':')) {
      return null;
    }

    const separator = line.indexOf(':');
    if (separator === -1) {
      this.#setField(line, '');
      return null;
    }

    const offset = line[separator + 1] === ' ' ? 2 : 1;
    this.#setField(line.slice(0, separator), line.slice(separator + offset));
    return null;
  }

  #setField(field, value) {
    if (field === 'data') {
      this.#data += `${value}\n`;
    } else if (field === 'event') {
      this.#eventType = value;
    } else if (field === 'id') {
      this.#id = value.includes('\u0000') ? undefined : value;
    } else if (field === 'retry' && /^\d+$/.test(value)) {
      this.#onRetry?.(Number.parseInt(value, 10));
    }
    // Any other field is ignored, which is what the spec asks for.
  }

  #dispatch() {
    const data = this.#data;
    const event = this.#eventType;
    const id = this.#id;

    this.#data = '';
    this.#eventType = '';
    this.#id = undefined;

    if (data.length === 0) {
      return null;
    }
    return {
      id,
      event: event || undefined,
      data: data.endsWith('\n') ? data.slice(0, -1) : data,
    };
  }
}

/**
 * Read an event stream body to the end, handing each event to onEvent.
 *
 * Takes the reader rather than the stream so the caller keeps the handle it
 * needs to cancel, and decodes with TextDecoder rather than piping through a
 * TextDecoderStream, because a multi byte character may straddle two chunks
 * and { stream: true } is what carries the partial one across.
 */
export async function readEventStream(body, { onEvent, onRetry } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDecoder({ onRetry });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      for (const event of sse.push(decoder.decode(value, { stream: true }))) {
        onEvent?.(event);
      }
    }
    // Flush any half decoded character. An event the server never terminated
    // with a blank line is dropped on purpose: its data is a truncated frame,
    // and forwarding half a JSON-RPC message is worse than losing it.
    for (const event of sse.push(decoder.decode())) {
      onEvent?.(event);
    }
  } finally {
    reader.releaseLock();
  }
}
