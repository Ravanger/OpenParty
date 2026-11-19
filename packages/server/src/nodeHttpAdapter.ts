import type { IncomingMessage, ServerResponse } from "node:http";

/** A Node request converted to a fetch `Request`, or undefined when the method cannot be represented. */
export function toFetchRequest(req: IncomingMessage): Request | undefined {
  // Node's parser never leaves a present header value undefined; the assertion drops it from the type.
  const rawHeaders = req.headers as Record<string, string | string[]>;
  const headers = new Headers();
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      for (const one of value) headers.append(name, one);
    } else {
      headers.set(name, value);
    }
  }
  // A connection that reached the server has a request method; the assertion keeps that branch out of coverage.
  try {
    return new Request(`http://127.0.0.1${req.url}`, {
      method: req.method as string,
      headers,
    });
  } catch {
    // Node's parser accepts methods the Request constructor forbids (TRACE, TRACK).
    return undefined;
  }
}

/** Writes a fetch `Response` to a Node response. The body is read before any header goes out: a body that fails to read must still reach the caller with unsent headers so it can answer with its fixed error. */
export async function writeNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  const body = await response.text();
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(body);
}
