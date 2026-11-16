---
type: integration
title: Streaming responses and WebSockets
description: Response stream lifetime and cancellation, SSE framing and errors, and runtime-owned WebSocket upgrades behind shared event helpers.
tags: [streaming, sse, websocket, runtime, cancellation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:16:56.556Z
sources:
  - id: openwiki-source-91d3173886899b1d372057c9
    resource: repo://src/adapter/bun/websocket.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-03552d4b400a4485be6e5ac2
    resource: repo://src/helper/streaming/sse.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-015f2dc60c9d3599ae2b42ec
    resource: repo://src/helper/websocket/index.ts
  - id: openwiki-source-c381d12d61294dab23132187
    resource: repo://src/utils/stream.ts
generated: { by: "codex", at: "2026-11-16T06:16:56.556Z" }
---

# Streaming responses and WebSockets

Streaming helpers return a Response while asynchronous production continues. WebSocket helpers hand transport ownership to a runtime after an upgrade. Both extend beyond ordinary handler execution, so understand the producer or socket lifetime separately from the [request dispatch chain](../architecture/request-lifecycle.md).

## A streaming response

`stream`, `streamText`, and `streamSSE` are exported from `hono/streaming`. [stream](../../src/helper/streaming/stream.ts) creates a TransformStream and a `StreamingApi`, starts the producer callback asynchronously, and returns `c.newResponse` with the readable side. A WeakMap keeps the context reachable through the response stream while production continues.

```ts
import { streamText } from 'hono/streaming'

app.get('/lines', (c) => streamText(c, async (output) => {
  await output.writeln('first')
  await output.writeln('second')
}))
```

The base helper does not select a content type. `streamText` adds text/plain, nosniff, and chunked-transfer headers. `streamSSE` adds event-stream, no-cache, keep-alive, and chunked-transfer headers. The actual wire behavior still depends on the runtime adapter and infrastructure.

[StreamingApi](../../src/utils/stream.ts) owns the writable writer and exposes async `write`, `writeln`, `pipe`, `sleep`, and `close`, plus abort subscriptions. Await writes to coordinate production with the writable stream. `pipe` temporarily releases the writer lock and uses `preventClose`, allowing subsequent writes.

Write and close failures are swallowed by this convenience API. If an application needs low-level writer failure control, it must own that stream handling. The `aborted` and `closed` flags represent distinct transitions, and abort notifies subscribers only once.

## Cancellation and failures

Canceling the response readable triggers `abort()` when the stream is not already closed. An internal subscriber cancels the underlying reader, unblocking production. Producers can register `onAbort` to release application resources and check `aborted` in long-running loops. The helpers also contain a compatibility path that listens to the raw request's abort signal on older Bun versions.

The generic stream helper catches producer errors. An Error reaches its supplied `onError` callback; otherwise it is logged, except an undefined cancellation reason is ignored. The stream is closed in `finally`. These failures happen in asynchronous production after the Response is created, so use the stream callback contract to handle them rather than relying on `app.onError` to replace an already returned response.

## Server-sent events

```ts
import { streamSSE } from 'hono/streaming'

app.get('/events', (c) => streamSSE(c, async (output) => {
  await output.writeSSE({ event: 'ready', id: '1', data: 'connected' })
}))
```

[SSEStreamingApi](../../src/helper/streaming/sse.ts) resolves the message data, splits newline variants into individual `data:` lines, writes optional event/id/retry fields, and terminates a message with a blank line. It rejects CR/LF in event, id, and retry metadata to preserve framing. Its run wrapper calls a supplied error callback for Error failures, then writes an `error` event containing the error message, and closes the stream. Without that callback, it logs the failure. Decide whether that message is appropriate for the client when choosing the SSE error path.

JSX's Suspense stream is another producer built around HTML callbacks and fallback replacement, explained in [HTML and JSX](../concepts/jsx-rendering.md).

## Shared WebSocket contract, host-specific upgrade

[WebSocket helpers](../../src/helper/websocket/index.ts) define `WSEvents` and `WSContext`. Event handlers receive open/message/close/error events and a context with send, close, raw socket, protocol, URL, and ready-state access. Those operations delegate to the runtime's socket implementation.

`defineWebSocketHelper` supports two call forms. As middleware, a callback creates event handlers; if the host does not upgrade, processing continues with `next()`. The direct context/events form instead throws `Failed to upgrade WebSocket` when no upgrade response is returned. This distinction matters for mixed HTTP/WebSocket routes.

On [Bun](../../src/adapter/bun/websocket.ts), pass the Bun server into Hono's environment and install the exported `websocket` handlers on the Bun server. `upgradeWebSocket` calls `server.upgrade`, storing events, request URL, and the first requested subprotocol as socket data. Missing server context throws; success returns a placeholder Response because Bun owns the upgraded transport. The exported server callbacks normalize incoming binary data and deliver events through `WSContext`.

On [Cloudflare Workers](../../src/adapter/cloudflare-workers/websocket.ts), the helper checks the Upgrade header, creates a WebSocketPair, accepts the server side, installs event listeners, and returns status 101 with the client socket. This adapter intentionally omits the open event from its event type. Deno has its own native upgrade implementation. Do not infer identical event availability or response mutation rules across runtimes.

An HTTP middleware that mutates headers after `next()` also runs on responses returned by upgrade middleware. Test that combination on the target runtime; socket acceptance and special response fields belong to the host rather than a general HTTP body writer.

## Verification

[Stream tests](../../src/helper/streaming/stream.test.ts), [SSE tests](../../src/helper/streaming/sse.test.tsx), and [StreamingApi tests](../../src/utils/stream.test.ts) cover framing, cancellation, error callbacks, and subscriber behavior. [Bun WebSocket tests](../../src/adapter/bun/websocket.test.ts) cover upgrade integration, while [shared helper tests](../../src/helper/websocket/index.test.ts) cover the call forms. Use [runtime tests](../workflows/development-and-testing.md) for transport changes and [adapter documentation](runtime-adapters.md) for invocation context.
