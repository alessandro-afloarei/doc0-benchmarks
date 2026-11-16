---
title: "Streaming and Server-Sent Events"
---
## Overview

The streaming helper (`hono/streaming`) lets a handler return a response at once and keep writing its body afterwards. `stream` gives a byte stream, `streamText` the same with text headers, and `streamSSE` a Server-Sent Events stream with a `writeSSE` method. All three create a `TransformStream`, wrap it in a `StreamingApi` writer, start the handler's callback without awaiting it, and return a `Response` whose body is the readable side. Streaming HTML from JSX is covered separately in [[JSX Streaming and Suspense]].

Sources: [src/helper/streaming/index.ts:1-9](repo://src/helper/streaming/index.ts#L1-L9), [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45)

```ts
import { stream, streamText, streamSSE } from 'hono/streaming'

app.get('/text', (c) =>
  streamText(c, async (stream) => {
    await stream.writeln('Hello')
    await stream.sleep(1000)
    await stream.write('Hono!')
  })
)

app.get('/sse', (c) =>
  streamSSE(c, async (stream) => {
    let id = 0
    while (true) {
      await stream.writeSSE({ data: `It is ${new Date().toISOString()}`, event: 'time-update', id: String(id++) })
      await stream.sleep(1000)
    }
  })
)
```

Sources: [src/helper/streaming/text.ts:6-15](repo://src/helper/streaming/text.ts#L6-L15), [src/helper/streaming/sse.ts:72-100](repo://src/helper/streaming/sse.ts#L72-L100), [src/utils/stream.ts:48-67](repo://src/utils/stream.ts#L48-L67)

## StreamingApi

### Writing

`StreamingApi` holds a writer on the writable side of the transform stream:

Sources: [src/utils/stream.ts:6-98](repo://src/utils/stream.ts#L6-L98)

| Member | Behaviour |
| --- | --- |
| `write(input)` | Encodes strings as UTF-8 and writes; errors are swallowed |
| `writeln(input)` | `write(input + '\n')` |
| `sleep(ms)` | Resolves after a `setTimeout` |
| `pipe(body)` | Releases the writer, pipes a `ReadableStream` into the writable without closing it, then takes a new writer |
| `onAbort(listener)` | Registers a listener called when the client goes away |
| `abort()` | Marks the stream aborted and calls every abort listener once |
| `close()` | Marks the stream closed and closes the writer; errors are swallowed |
| `aborted`, `closed` | State flags |

Sources: [src/utils/stream.ts:6-98](repo://src/utils/stream.ts#L6-L98)

The comments on `write` and `close` state the intent of swallowing errors: callers who need to handle write errors should build their own stream.

Sources: [src/utils/stream.ts:48-76](repo://src/utils/stream.ts#L48-L76)

### Client disconnects

The response body is not the transform stream's readable side directly. `StreamingApi` builds its own `responseReadable` that pulls chunks from a reader on that side. When the runtime cancels the response body, which happens when the client disconnects, its `cancel` hook calls `abort()` unless the stream was already closed. The first abort listener, registered in the constructor, cancels the internal reader, so a pending `write` or `writeSSE` does not block forever; user listeners registered with `onAbort` run too, and can stop timers or loops.

Sources: [src/utils/stream.ts:21-46](repo://src/utils/stream.ts#L21-L46), [src/utils/stream.ts:84-97](repo://src/utils/stream.ts#L84-L97)

Bun versions before 1.1.27 did not call `cancel` on such bodies, as a comment notes. For Bun versions starting with `0.`, `1.0` or `1.1`, the helpers also listen for the request signal's `abort` event and abort the stream themselves. They also keep a reference to the context in a `WeakMap` keyed by the response stream, because the comment says Bun destroys `c` once the request is returned.

Sources: [src/helper/streaming/stream.ts:5-25](repo://src/helper/streaming/stream.ts#L5-L25), [src/helper/streaming/utils.ts:1-11](repo://src/helper/streaming/utils.ts#L1-L11)

## stream and streamText

`stream(c, cb, onError)` runs `cb(stream)` in a detached async function and returns `c.newResponse(stream.responseReadable)` immediately, so headers set on the context before the call are kept. When `cb` throws:

Sources: [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45)

- an `undefined` rejection, which `pipeTo` produces when the reader was cancelled, is ignored;
- an `Error` goes to `onError(e, stream)` when given, which can still write to the stream;
- anything else is logged with `console.error`.

Sources: [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45)

The stream is closed in a `finally` in every case. Errors never reach the app's `onError`, because the response has already been returned by then.

Sources: [src/helper/streaming/stream.ts:7-45](repo://src/helper/streaming/stream.ts#L7-L45)

`streamText(c, cb, onError)` sets `Content-Type: text/plain; charset=UTF-8`, `X-Content-Type-Options: nosniff` and `Transfer-Encoding: chunked`, then calls `stream`.

Sources: [src/helper/streaming/text.ts:1-15](repo://src/helper/streaming/text.ts#L1-L15), [src/context.ts:279-279](repo://src/context.ts#L279-L279)

## streamSSE

### Headers and errors

`streamSSE(c, cb, onError)` sets `Transfer-Encoding: chunked`, `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `Connection: keep-alive`, starts the callback with `SSEStreamingApi`, and returns the response. Its error handling differs from `stream`: after `onError` runs, the helper also sends an `error` event whose data is the error message, so the client learns about the failure. Without `onError` the error is only logged. The stream is closed in all cases.

Sources: [src/helper/streaming/sse.ts:47-100](repo://src/helper/streaming/sse.ts#L47-L100)

### writeSSE

`writeSSE({ data, event, id, retry })` formats one event:

Sources: [src/helper/streaming/sse.ts:6-45](repo://src/helper/streaming/sse.ts#L6-L45), [src/utils/html.ts:142-182](repo://src/utils/html.ts#L142-L182)

1. `data` may be a string or a promise, including an `HtmlEscapedString` from JSX or the `html` helper; it is resolved through `resolveCallback` in the `Stringify` phase.
2. The data is split on `\r\n`, `\r` or `\n`, and each line becomes a `data:` line, so multi-line payloads cannot inject fields.
3. `event`, `id` and `retry` must not contain line breaks; one that does makes `writeSSE` throw.
4. The fields are written in the order `event`, `data`, `id`, `retry`, omitting empty ones, and terminated by a blank line.

Sources: [src/helper/streaming/sse.ts:6-45](repo://src/helper/streaming/sse.ts#L6-L45), [src/utils/html.ts:142-182](repo://src/utils/html.ts#L142-L182)

## Interaction with middleware

Because these helpers return before the body is complete, middleware running after `next()` sees a response with a stream body. The `compress` middleware skips responses that already have `Transfer-Encoding`, which `streamText` and `streamSSE` set, and its default content-type filter excludes `text/event-stream`; see [[Response and Observability Middleware]].

Sources: [src/middleware/compress/index.ts:89-102](repo://src/middleware/compress/index.ts#L89-L102), [src/utils/compress.ts:9-10](repo://src/utils/compress.ts#L9-L10)
