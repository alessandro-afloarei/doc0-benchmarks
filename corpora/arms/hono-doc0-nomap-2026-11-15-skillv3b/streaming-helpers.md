---
title: "Streaming Responses"
---
## Overview

`hono/streaming` turns an async callback into a streaming `Response`. `stream(c, cb)` sends raw bytes, `streamText(c, cb)` sends text with headers that stop browsers and proxies from buffering, and `streamSSE(c, cb)` sends Server-Sent Events. Each returns the `Response` immediately and runs the callback in the background, writing to the response body as it goes. Streaming HTML from JSX uses a different mechanism, described on [[Streaming JSX and Suspense]].

Sources: [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45), [src/helper/streaming/text.ts:6-15](repo://src/helper/streaming/text.ts#L6-L15), [src/helper/streaming/sse.ts:72-100](repo://src/helper/streaming/sse.ts#L72-L100)

```ts
import { streamSSE } from 'hono/streaming'

app.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    let id = 0
    while (!stream.aborted) {
      await stream.writeSSE({ event: 'tick', data: new Date().toISOString(), id: String(id++) })
      await stream.sleep(1000)
    }
  })
)
```

Sources: [src/helper/streaming/sse.ts:18-44](repo://src/helper/streaming/sse.ts#L18-L44), [src/utils/stream.ts:15-19](repo://src/utils/stream.ts#L15-L19)

## How a stream is built

### StreamingApi

`stream` creates a `TransformStream` and wraps both ends in a `StreamingApi`. The callback writes to the writable side through the API; the response body is `responseReadable`, a `ReadableStream` that pulls from the readable side one chunk at a time. `c.newResponse(responseReadable)` produces the response, so headers and status set on the context beforehand are kept (see [[Context and Response Building]]).

Sources: [src/helper/streaming/stream.ts:12-13](repo://src/helper/streaming/stream.ts#L12-L13), [src/helper/streaming/stream.ts:44-44](repo://src/helper/streaming/stream.ts#L44-L44), [src/utils/stream.ts:21-46](repo://src/utils/stream.ts#L21-L46)

| Method | Does |
| --- | --- |
| `write(bytes or string)` | Encodes strings as UTF-8 and writes; errors from a closed stream are swallowed |
| `writeln(string)` | Writes the string and a newline |
| `pipe(readable)` | Pipes another stream into the response without closing it, then resumes normal writes |
| `sleep(ms)` | A `setTimeout` promise |
| `onAbort(fn)` | Registers a listener for client disconnects |
| `close()` | Closes the writer; called automatically when the callback ends |
| `aborted`, `closed` | State flags |

Sources: [src/utils/stream.ts:48-97](repo://src/utils/stream.ts#L48-L97)

### Running the callback

The callback runs in a detached async function. Whatever happens, the `finally` block closes the stream, so the response always ends. Because the `Response` was already returned, an error thrown in the callback cannot reach `app.onError`; instead it goes to the `onError(err, stream)` argument when given, which can still write a final message, or is logged with `console.error`. A rejection with `undefined`, which is what a pipe cancelled by the client produces, is ignored.

Sources: [src/helper/streaming/stream.ts:26-42](repo://src/helper/streaming/stream.ts#L26-L42)

The context is kept in a `WeakMap` keyed by the response stream for as long as the stream lives, because Bun discards the context once the handler returns.

Sources: [src/helper/streaming/stream.ts:5-5](repo://src/helper/streaming/stream.ts#L5-L5), [src/helper/streaming/stream.ts:24-25](repo://src/helper/streaming/stream.ts#L24-L25)

## Client disconnects

When the client goes away, the runtime cancels the response body. `responseReadable`'s `cancel` handler calls `abort()`, which sets `aborted` and runs every `onAbort` listener; the first listener, registered by the constructor, cancels the internal reader so pending writes stop blocking. A callback should check `stream.aborted` in loops or register `onAbort` to release resources such as database cursors.

Sources: [src/utils/stream.ts:26-46](repo://src/utils/stream.ts#L26-L46), [src/utils/stream.ts:84-97](repo://src/utils/stream.ts#L84-L97)

Bun before 1.1.27 did not cancel the body on disconnect, so for those versions the helpers also listen to the request's `AbortSignal` and abort the stream themselves. `isOldBunVersion` computes the check once and then replaces itself with a constant function.

Sources: [src/helper/streaming/stream.ts:15-22](repo://src/helper/streaming/stream.ts#L15-L22), [src/helper/streaming/utils.ts:1-11](repo://src/helper/streaming/utils.ts#L1-L11)

## streamText

`streamText` sets `Content-Type: text/plain; charset=UTF-8`, `X-Content-Type-Options: nosniff` and `Transfer-Encoding: chunked`, then calls `stream`. The `nosniff` header matters: without it some browsers wait for enough bytes to guess the type before showing anything, which defeats streaming text such as LLM output.

Sources: [src/helper/streaming/text.ts:6-15](repo://src/helper/streaming/text.ts#L6-L15)

## streamSSE

### Headers and errors

`streamSSE` builds an `SSEStreamingApi` the same way and sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and `Transfer-Encoding: chunked`. Its error handling differs from `stream`: after `onError(err, stream)` runs, it also sends an `error` event whose data is the error message, so the browser's `EventSource` sees the failure. Without `onError` the error is only logged.

Sources: [src/helper/streaming/sse.ts:47-100](repo://src/helper/streaming/sse.ts#L47-L100)

### Message format

`writeSSE({ data, event, id, retry })` resolves `data` first (it may be a promise or a JSX-rendered string, resolved through `resolveCallback`), splits it on any line ending and prefixes each line with `data: `, so multi-line payloads such as pretty JSON arrive intact. `event`, `id` and `retry` are written on their own lines when present, and the message ends with a blank line. An `event`, `id` or `retry` value containing a line break throws, since it could inject extra fields into the stream.

Sources: [src/helper/streaming/sse.ts:6-44](repo://src/helper/streaming/sse.ts#L6-L44)

```text
event: tick
data: 2026-11-15T10:00:00.000Z
id: 3

```

Sources: [src/helper/streaming/sse.ts:33-41](repo://src/helper/streaming/sse.ts#L33-L41)

## Runtimes and middleware

On AWS Lambda, streaming needs the `streamHandle` adapter instead of `handle`; see [[AWS Lambda and Lambda@Edge]]. Middleware that reads the whole body after `next()`, such as `etag` or `prettyJSON`, would wait for the stream to finish; `compress` streams through `CompressionStream` but skips responses that set `Transfer-Encoding`, as `streamText` and `streamSSE` do (see [[Response Processing Middleware]]).

Sources: [src/middleware/compress/index.ts:92-102](repo://src/middleware/compress/index.ts#L92-L102), [src/middleware/etag/index.ts:96-100](repo://src/middleware/etag/index.ts#L96-L100)
