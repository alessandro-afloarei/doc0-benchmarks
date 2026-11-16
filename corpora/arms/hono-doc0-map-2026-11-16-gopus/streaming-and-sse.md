---
title: "Streaming and Server-Sent Events"
---
## Overview

`hono/streaming` lets a handler return a `Response` at once and keep writing its body afterwards. All three helpers, `stream`, `streamText` and `streamSSE`, have the same shape: they take the Context, an async callback that writes to a stream object, and an optional error callback. They return the `Response` immediately, and the callback runs in the background until it finishes, at which point the stream is closed.

Sources: [src/helper/streaming/index.ts:1-9](repo://src/helper/streaming/index.ts#L1-L9), [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45)

```ts
import { streamSSE } from 'hono/streaming'

app.get('/sse', (c) =>
  streamSSE(c, async (stream) => {
    let id = 0
    while (!stream.aborted) {
      await stream.writeSSE({ event: 'time', data: new Date().toISOString(), id: String(id++) })
      await stream.sleep(1000)
    }
  })
)
```

Sources: [src/helper/streaming/sse.ts:72-100](repo://src/helper/streaming/sse.ts#L72-L100), [src/utils/stream.ts:60-97](repo://src/utils/stream.ts#L60-L97)

The callback writes through a `StreamingApi` from `utils/stream`, described next. Streaming HTML from JSX with `Suspense` uses its own stream and is covered on [[Suspense and Streaming JSX]].

Sources: [src/utils/stream.ts:6-46](repo://src/utils/stream.ts#L6-L46)

## StreamingApi

`StreamingApi` wraps a `TransformStream`. Writes go into its writable side; the response body, `responseReadable`, is a new `ReadableStream` that pulls from the readable side one chunk at a time.

Sources: [src/utils/stream.ts:6-46](repo://src/utils/stream.ts#L6-L46)

| Member | Does |
| --- | --- |
| `write(input)` | Writes a `Uint8Array`, or a string encoded as UTF-8 |
| `writeln(input)` | Writes the string followed by `\n` |
| `sleep(ms)` | Resolves after `ms` milliseconds |
| `pipe(body)` | Pipes a `ReadableStream` into the stream without closing it, then resumes normal writes |
| `onAbort(listener)` | Registers a callback for when the client goes away |
| `abort()` | Marks the stream aborted and runs the abort listeners once |
| `close()` | Closes the writer |
| `aborted`, `closed` | State flags |

Sources: [src/utils/stream.ts:10-97](repo://src/utils/stream.ts#L10-L97)

Errors from `write` and `close` are swallowed; the comments say to build a stream by hand if they need handling. After the client disconnects, writes therefore resolve quietly, and the callback should check `stream.aborted` or use `onAbort` to stop its work.

Sources: [src/utils/stream.ts:48-76](repo://src/utils/stream.ts#L48-L76)

## Abort detection

When the runtime cancels the response body because the client disconnected, the `cancel` hook of `responseReadable` calls `abort()` unless the stream was already closed normally. The first abort listener, registered in the constructor, cancels the internal reader; a comment explains this keeps `writeSSE` from blocking forever.

Sources: [src/utils/stream.ts:26-46](repo://src/utils/stream.ts#L26-L46)

Bun before v1.1.27 did not call `cancel()` for responses from `Bun.serve()`, as a comment notes, so on those versions the helpers also listen to the request's `abort` signal. `isOldBunVersion` checks `Bun.version` once and caches the answer.

Sources: [src/helper/streaming/stream.ts:15-22](repo://src/helper/streaming/stream.ts#L15-L22), [src/helper/streaming/utils.ts:1-11](repo://src/helper/streaming/utils.ts#L1-L11)

## stream and streamText

`stream(c, cb, onError?)` creates the `StreamingApi`, starts `cb(stream)` without awaiting it, and returns `c.newResponse(stream.responseReadable)`, so headers and status set on the Context before the call are part of the response ([[Context and Responses]]).

Sources: [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45)

The Context is kept in a `WeakMap` keyed by the response stream for as long as the stream lives. A comment explains that Bun destroys `c` when the handler returns, which would break a callback that still uses it.

Sources: [src/helper/streaming/stream.ts:5-5](repo://src/helper/streaming/stream.ts#L5-L5), [src/helper/streaming/stream.ts:24-25](repo://src/helper/streaming/stream.ts#L24-L25)

When `cb` throws an `Error`, `onError(e, stream)` runs if given; any other value is logged with `console.error`. A rejection with `undefined` is ignored, because the comment says that is how `pipeTo` reports a read cancelled by `StreamingApi`. The stream is closed in every case.

Sources: [src/helper/streaming/stream.ts:26-42](repo://src/helper/streaming/stream.ts#L26-L42)

`streamText(c, cb, onError?)` sets `Content-Type: text/plain; charset=UTF-8`, `X-Content-Type-Options: nosniff` and `Transfer-Encoding: chunked`, and then calls `stream`.

Sources: [src/helper/streaming/text.ts:1-15](repo://src/helper/streaming/text.ts#L1-L15)

## streamSSE

`streamSSE(c, cb, onError?)` sets the headers for an event stream (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and `Transfer-Encoding: chunked`) and gives the callback an `SSEStreamingApi`, a `StreamingApi` with one more method.

Sources: [src/helper/streaming/sse.ts:72-100](repo://src/helper/streaming/sse.ts#L72-L100)

`writeSSE({ data, event?, id?, retry? })` writes one message:

Sources: [src/helper/streaming/sse.ts:6-44](repo://src/helper/streaming/sse.ts#L6-L44)

1. `data` may be a string or a Promise of one, such as rendered JSX; it is resolved with `resolveCallback` ([[HTML and CSS Helpers]]).
2. The data is split on any line ending, and each line becomes a `data:` line, so multi-line payloads keep their lines.
3. `event`, `id` and `retry` must not contain CR or LF; otherwise `writeSSE` throws, which keeps a value from injecting extra fields.
4. The fields are joined in the order `event`, `data`, `id`, `retry`, and the message ends with a blank line.

Sources: [src/helper/streaming/sse.ts:6-44](repo://src/helper/streaming/sse.ts#L6-L44)

```text
event: time
data: 2026-11-16T10:00:00.000Z
id: 0

```

Sources: [src/helper/streaming/sse.ts:33-41](repo://src/helper/streaming/sse.ts#L33-L41)

Errors work as in `stream`, with one addition: after `onError` handles an `Error`, the helper sends a final message with `event: error` and the error's message as data before closing, so the client learns why the stream ended.

Sources: [src/helper/streaming/sse.ts:47-68](repo://src/helper/streaming/sse.ts#L47-L68)

The `compress` middleware leaves `text/event-stream` responses alone, and it also skips any response that already has `Transfer-Encoding`, which all three helpers except `stream` set ([[Response Middleware]]).

Sources: [src/utils/compress.ts:9-10](repo://src/utils/compress.ts#L9-L10), [src/middleware/compress/index.ts:92-102](repo://src/middleware/compress/index.ts#L92-L102)
