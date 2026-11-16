---
title: "WebSocket"
---
## Overview

The Fetch API has no standard way to accept a WebSocket on the server, so each runtime has its own: Deno has `Deno.upgradeWebSocket`, Cloudflare Workers have `WebSocketPair`, Bun upgrades through its server object. Hono gives them one interface. `upgradeWebSocket((c) => events)` returns a middleware that upgrades the request and calls `onOpen`, `onMessage`, `onClose` and `onError` with a `WSContext` that behaves the same everywhere. The runtime-neutral part is `hono/ws` (`helper/websocket`); each adapter (`hono/bun`, `hono/deno`, `hono/cloudflare-workers`) supplies an `upgradeWebSocket` built from it.

Sources: [src/helper/websocket/index.ts:14-40](repo://src/helper/websocket/index.ts#L14-L40), [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)

```ts
import { upgradeWebSocket } from 'hono/cloudflare-workers' // or 'hono/deno', or createBunWebSocket()

app.get(
  '/ws',
  upgradeWebSocket((c) => ({
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`)
    },
    onClose() {
      console.log('closed')
    },
  }))
)
```

Sources: [src/helper/websocket/index.ts:24-34](repo://src/helper/websocket/index.ts#L24-L34)

## The shared helper

### defineWebSocketHelper

`defineWebSocketHelper(handler)` takes a runtime function `(c, events, options) => Response | void` and returns an `upgradeWebSocket` with two call forms:

Sources: [src/helper/websocket/index.ts:102-140](repo://src/helper/websocket/index.ts#L102-L140)

| Form | Returns | When the request is not an upgrade |
| --- | --- | --- |
| `upgradeWebSocket((c) => events, options)` | A middleware; `createEvents` may be async and can read the context | Calls `next()`, so a later route can answer |
| `upgradeWebSocket(c, events, options)` | A promise of the upgrade `Response`, for use inside a handler | Throws `Failed to upgrade WebSocket` |

Sources: [src/helper/websocket/index.ts:114-139](repo://src/helper/websocket/index.ts#L114-L139)

The middleware form is typed with `outputFormat: 'ws'`, which adds the route to the app's schema as a WebSocket endpoint, so the [[RPC Client]] exposes `$ws()` for it.

Sources: [src/helper/websocket/index.ts:28-34](repo://src/helper/websocket/index.ts#L28-L34), [src/client/types.ts:111-118](repo://src/client/types.ts#L111-L118)

Because the events are created per request from `c`, handlers can close over request data: the authenticated user from `c.get(...)`, path parameters, or a room name. Authentication middleware placed before `upgradeWebSocket` on the same route runs before the upgrade.

Sources: [src/helper/websocket/index.ts:119-128](repo://src/helper/websocket/index.ts#L119-L128)

### WSContext

`WSContext` wraps the runtime socket behind a small interface:

Sources: [src/helper/websocket/index.ts:45-91](repo://src/helper/websocket/index.ts#L45-L91)

| Member | Meaning |
| --- | --- |
| `send(data, { compress })` | Sends a string, `ArrayBuffer` or `Uint8Array`; `compress` is honoured where the runtime supports it (Bun) |
| `close(code, reason)` | Closes the socket |
| `readyState` | `0` connecting, `1` open, `2` closing, `3` closed |
| `url`, `protocol` | The request URL and the negotiated subprotocol |
| `raw` | The runtime's own socket object |
| `binaryType` | Always `arraybuffer` |

Sources: [src/helper/websocket/index.ts:45-91](repo://src/helper/websocket/index.ts#L45-L91)

`onMessage` receives a `MessageEvent` whose `data` is a string, a `Blob` or an `ArrayBuffer`. Adapters that do not get a real event from the runtime build one with `createWSMessageEvent`.

Sources: [src/helper/websocket/index.ts:93-99](repo://src/helper/websocket/index.ts#L93-L99)

## Runtime implementations

### Deno

The Deno adapter checks `Upgrade: websocket` and calls `Deno.upgradeWebSocket(c.req.raw, options)`. It wires the socket's `onopen`, `onmessage`, `onclose` and `onerror` to the events and returns Deno's `101` response. It echoes the first subprotocol the client requested, because browsers such as Chrome reject a connection that requested a subprotocol and got none back. Options such as `idleTimeout` pass through to Deno.

Sources: [src/adapter/deno/websocket.ts:4-38](repo://src/adapter/deno/websocket.ts#L4-L38)

### Cloudflare Workers

The Workers adapter creates a `WebSocketPair`, keeps the server end, accepts it, and returns `new Response(null, { status: 101, webSocket: client })`. Workers have no `open` event for accepted sockets, so `onOpen` is not supported and its type is omitted; send greetings from the first message instead.

Sources: [src/adapter/cloudflare-workers/websocket.ts:5-53](repo://src/adapter/cloudflare-workers/websocket.ts#L5-L53)

### Bun

Bun delivers socket events to handlers registered on `Bun.serve`, not to the request, so its adapter has two halves. `createBunWebSocket()` (or the direct exports) gives both:

Sources: [src/adapter/bun/websocket.ts:20-28](repo://src/adapter/bun/websocket.ts#L20-L28), [src/adapter/bun/websocket.ts:110-113](repo://src/adapter/bun/websocket.ts#L110-L113)

1. `upgradeWebSocket` calls `server.upgrade(c.req.raw, { data })` on the Bun server found in `c.env`, storing the events, URL and first requested subprotocol in the socket's `data`. On success it returns an empty response that Bun discards; it throws if the env does not hold the server.
2. `websocket` is the handler object for `Bun.serve`. Its `open`, `message` and `close` read the events back from `ws.data` and call them with a fresh `WSContext`. Binary messages are passed as their `ArrayBuffer`, and `send` forwards the `compress` option.

Sources: [src/adapter/bun/websocket.ts:33-104](repo://src/adapter/bun/websocket.ts#L33-L104)

```ts
import { createBunWebSocket } from 'hono/bun'

const { upgradeWebSocket, websocket } = createBunWebSocket()
app.get('/ws', upgradeWebSocket(() => ({ onMessage: (e, ws) => ws.send(e.data as string) })))

export default { fetch: app.fetch, websocket }
```

Sources: [src/adapter/bun/websocket.ts:48-113](repo://src/adapter/bun/websocket.ts#L48-L113)

The Bun `WSContext` copies `readyState` when it is created for each event, so it reflects the state at the moment the event fired. Bun has no `error` event handler here, so `onError` is not called.

Sources: [src/adapter/bun/websocket.ts:33-46](repo://src/adapter/bun/websocket.ts#L33-L46), [src/adapter/bun/websocket.ts:76-104](repo://src/adapter/bun/websocket.ts#L76-L104)

## Middleware and upgrades

The upgrade response is special on every runtime (status 101 or a placeholder), so middleware that rewrites responses after `next()` can break it. Examples are `compress`, `etag`, or anything that builds a new `Response` from `c.res` (see [[ETag, Cache and Compression]]). Register such middleware on paths that exclude WebSocket routes, or skip it with `except` from `hono/combine` ([[Middleware Composition and Error Handling]]).

Sources: [src/adapter/cloudflare-workers/websocket.ts:48-52](repo://src/adapter/cloudflare-workers/websocket.ts#L48-L52), [src/adapter/bun/websocket.ts:70-73](repo://src/adapter/bun/websocket.ts#L70-L73)
