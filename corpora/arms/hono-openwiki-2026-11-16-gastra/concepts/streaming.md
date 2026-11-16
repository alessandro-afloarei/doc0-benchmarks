---
type: concept
title: Streaming responses and server-sent events
description: Stream ownership, cancellation, callback failures, SSE framing, and asynchronous JSX response delivery.
tags: [streaming, sse, cancellation, jsx]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-03552d4b400a4485be6e5ac2
    resource: repo://src/helper/streaming/sse.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-f316cf3c3646484fce3f9d04
    resource: repo://src/helper/streaming/text.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-c381d12d61294dab23132187
    resource: repo://src/utils/stream.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Streaming responses and server-sent events

Streaming separates creation of the HTTP response from completion of its body. The route returns a response immediately while a producer writes bytes asynchronously. Handle producer failures and cleanup at the stream boundary.

## Generic and text streams

[stream](../../src/helper/streaming/stream.ts) creates a TransformStream and a [StreamingApi](../../src/utils/stream.ts), starts the producer callback, and returns the readable side through `c.newResponse()`. A WeakMap retains the context for the lifetime associated with the response stream. A compatibility branch connects request abort signals for older Bun versions.

```ts
import { streamText } from 'hono/streaming'

app.get('/lines', (c) => streamText(c, async (stream) => {
  await stream.writeln('first')
  await stream.writeln('second')
}))
```

`streamText()` adds text/plain, nosniff, and chunked-transfer headers. The generic helper leaves content selection to the caller.

Await writes to follow the writer's flow control. `write()` encodes strings to bytes; `writeln()` adds a newline. The utility catches writer errors in write and close, so rejection of those operations is not a reliable application error signal. `pipe()` temporarily releases the writer lock, pipes without closing the destination, and reacquires the writer.

## Cancellation and failures

The response-readable cancel callback calls `abort()` unless the stream has closed normally. Abort sets `aborted` once and invokes subscribers, including an internal reader-cancellation subscriber that unblocks pending writes. Add `onAbort()` cleanup for subscriptions and check `stream.aborted` in long producer loops. Abort listeners are invoked without awaiting their promises.

The generic stream runner catches producer errors. An Error goes to a supplied stream error callback; other failures are logged, while an undefined cancellation rejection is ignored. The runner closes the stream in a finally block. These asynchronous failures are handled by the streaming helper, rather than by returning a new error response from the ordinary route error handler.

## Server-sent events

[streamSSE](../../src/helper/streaming/sse.ts) sets event-stream, no-cache, keep-alive, and chunked-transfer headers and runs a specialized producer. `writeSSE()` resolves promised data, prefixes each data line with `data:`, and terminates messages with a blank line.

```ts
import { streamSSE } from 'hono/streaming'

app.get('/events', (c) => streamSSE(c, async (stream) => {
  await stream.writeSSE({
    event: 'ready',
    id: '1',
    data: JSON.stringify({ ready: true }),
    retry: 3000,
  })
}))
```

Event, id, and retry fields reject embedded CR or LF. Optional fields are emitted only when truthy, so a retry value of zero is omitted by this implementation. JSON encoding is the caller's choice; SSE data itself is a string.

If the producer throws an Error and an error callback exists, the SSE runner awaits that callback and then writes an `error` event containing the error message before closing. Without that callback it logs the failure and closes. Consider the message content when exposing errors to clients.

## JSX streaming

[JSX readable-stream rendering](../../src/jsx/streaming.ts) first resolves BeforeStream callbacks, emits the initial bytes, then emits asynchronous callback results and any nested callbacks. Cancellation suppresses subsequent enqueue and close calls; it does not cancel every underlying application promise.

Suspense can emit fallback markup with a placeholder, followed by a template and script that replace it when content resolves. `StreamingContext` supplies a script nonce for generated scripts. This is the path selected by the streaming option of [jsxRenderer](jsx-and-html.md), rather than an SSE transport.

## Verification and runtime boundaries

[Stream tests](../../src/helper/streaming/stream.test.ts) exercise readable cancellation, legacy abort signaling, and producer errors. [SSE tests](../../src/helper/streaming/sse.test.tsx) cover framing, retry fields, aborts, and invalid line breaks. [JSX streaming tests](../../src/jsx/streaming.test.tsx) cover asynchronous rendering.

The runtime adapter still decides how Web response bytes reach the network. For example, Lambda provides a distinct stream handler. Use [runtime adapter tests](../integrations/runtime-adapters.md) when changing delivery behavior, alongside [dispatch](../architecture/request-lifecycle.md) tests for response creation.
