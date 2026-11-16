---
type: concept
title: Streaming, SSE, and WebSocket Helpers
description: How hono/streaming (stream, streamText, streamSSE) builds streaming responses on the StreamingApi TransformStream wrapper with abort and error semantics, and how hono/ws's defineWebSocketHelper/WSContext contract is implemented by the Cloudflare Workers, Deno, and Bun adapters.
tags: [helper, streaming, sse, websocket, bun, deno, cloudflare]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:28:44.415Z
sources:
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-91d3173886899b1d372057c9
    resource: repo://src/adapter/bun/websocket.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-742c2cb89906fa46f1243028
    resource: repo://src/adapter/deno/websocket.ts
  - id: openwiki-source-03552d4b400a4485be6e5ac2
    resource: repo://src/helper/streaming/sse.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-f8283656749016211f705030
    resource: repo://src/helper/streaming/utils.ts
  - id: openwiki-source-015f2dc60c9d3599ae2b42ec
    resource: repo://src/helper/websocket/index.ts
  - id: openwiki-source-c381d12d61294dab23132187
    resource: repo://src/utils/stream.ts
generated: { by: "claude-code", at: "2026-11-15T17:28:44.415Z" }
---

# Streaming, SSE, and WebSocket Helpers

Hono's long-lived response features are runtime-agnostic helpers that return ordinary `Response` objects. Streaming works everywhere Web Streams work; WebSockets need a per-runtime adapter because each platform exposes upgrades differently (see [Runtime Adapters](../adapters/runtime-adapters.md)).

## `StreamingApi` (`src/utils/stream.ts`)

All streaming helpers create a `TransformStream` and wrap it in `StreamingApi(writable, readable)`:

- `write(string | Uint8Array)` (strings are UTF-8 encoded), `writeln`, `sleep(ms)`, `close()`, and `pipe(readableStream)` (temporarily releases the writer lock and pipes with `preventClose: true`).
- **Write and close errors are swallowed** — the helper is meant for "best effort" streaming; build your own stream if you need to observe write failures.
- `responseReadable` is a pull-based `ReadableStream` that proxies the transform's readable side. Its `cancel()` (triggered when the client disconnects and the runtime cancels the body) calls `abort()` unless the stream was already closed.
- `abort()` runs once: it sets `aborted = true` and calls every `onAbort` listener. The first listener, registered in the constructor, cancels the internal reader so pending writes don't block forever.
- `aborted` and `closed` flags let callbacks stop work early (`while (!stream.aborted) ...`).

## `stream`, `streamText`, `streamSSE` (`hono/streaming`)

`stream(c, cb, onError?)`:

1. Creates the `StreamingApi`, stores the Context in a `WeakMap` keyed by the response stream (Bun may otherwise release the context when the handler returns), and returns `c.newResponse(stream.responseReadable)` **immediately** — headers set on `c` before the call are included.
2. Runs `cb(stream)` in the background. If it throws an `Error` and `onError` is given, `onError(err, stream)` runs; an `undefined` rejection (from cancellation via `pipeTo`) is ignored; anything else is logged with `console.error`. The stream is always closed afterwards.
3. For Bun < 1.1.27 (which never cancelled response bodies), it listens to `c.req.raw.signal`'s `abort` event instead. The version check result is memoized (`isOldBunVersion`).

`streamText` sets `Content-Type: text/plain; charset=UTF-8`, `X-Content-Type-Options: nosniff`, and `Transfer-Encoding: chunked`, then delegates to `stream`.

`streamSSE(c, cb, onError?)` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `Transfer-Encoding: chunked`, and passes an `SSEStreamingApi` with `writeSSE({ data, event?, id?, retry? })`:

- `data` may be a string or a promise / `HtmlEscapedString` (resolved via `resolveCallback`, so JSX output works). Multi-line data is split on `\r\n`, `\r`, or `\n` and each line becomes its own `data:` field.
- `event`, `id`, and `retry` containing `\r` or `\n` cause an error to be thrown (prevents SSE field injection).
- Messages are terminated with a blank line.
- On callback error with an `onError` handler, `onError` runs **and then** an SSE message `event: error` with the error message is written to the client. Without `onError` the error is only logged.

## WebSockets (`hono/ws`)

`src/helper/websocket/index.ts` (published as the `hono/ws` subpath) defines the contract shared by all runtimes:

- `WSEvents` — `onOpen`, `onMessage`, `onClose`, `onError`, each receiving the event and a `WSContext`.
- `WSContext` — a runtime-neutral wrapper with `send(data, { compress? })`, `close(code?, reason?)`, `readyState`, `url`, `protocol`, `binaryType` (default `'arraybuffer'`), and `raw` (the native socket).
- `defineWebSocketHelper(handler)` — turns a runtime-specific `(c, events, options) => Response | void` into an `UpgradeWebSocket` with two call forms:
  - **Middleware form** `upgradeWebSocket((c) => events, options)` — resolves events per request; if the runtime handler returns a response it is returned, otherwise `next()` is called (so non-upgrade requests fall through to later handlers). The middleware's type marks the route output format as `'ws'` for the [RPC client](../typing/rpc-client.md)'s `$ws()`.
  - **Direct form** `await upgradeWebSocket(c, events, options)` — throws `Failed to upgrade WebSocket` if the runtime handler returns nothing.

### Runtime implementations

| Runtime | Upgrade detection | Mechanism | Notes |
| --- | --- | --- | --- |
| Cloudflare Workers | `Upgrade` header must equal `websocket` | `new WebSocketPair()`, `server.accept()`, returns `101` with `webSocket: client` | No `onOpen` (Workers has no open event); typed with `Omit<WSEvents, 'onOpen'>`. |
| Deno | `upgrade` header must equal `websocket` | `Deno.upgradeWebSocket(c.req.raw, options)` | Echoes the first requested `Sec-WebSocket-Protocol` as the negotiated protocol (browsers reject a missing echo); user options override it. |
| Bun | delegated to `server.upgrade()` returning `false` | `server.upgrade(req, { data: { events, url, protocol } })`, returns `new Response(null)` on success | Requires exporting the `websocket` handler object to `Bun.serve` alongside `fetch`; events are dispatched from `websocket.open/message/close` using `ws.data.events`. Binary messages are normalized to `ArrayBufferLike`. Throws `TypeError` if the Bun server isn't reachable through `c.env`. |

`createBunWebSocket()` is retained for compatibility and simply returns `{ upgradeWebSocket, websocket }`.

## Tests

`src/helper/streaming/*.test.ts(x)` (abort handling, SSE formatting/injection checks, error events), `src/helper/websocket/index.test.ts`, and per-adapter `websocket.test.ts` files.

See also: [JSX Server Rendering](../jsx/server-rendering.md) for streaming JSX via `renderToReadableStream` and Suspense.
