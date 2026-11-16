---
title: "WebSockets"
---
## Overview

There is no Web Standard API for accepting a WebSocket on the server, so each runtime does it its own way. Hono hides that behind one function, `upgradeWebSocket`, imported from the runtime's adapter (`hono/cloudflare-workers`, `hono/deno` or `hono/bun`). The handler describes the connection with event callbacks (`onOpen`, `onMessage`, `onClose`, `onError`) that receive a runtime-neutral `WSContext`; the adapter does the upgrade and wires the runtime's socket events to those callbacks. The shared part lives in `helper/websocket`.

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19), [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)

```ts
import { upgradeWebSocket } from 'hono/cloudflare-workers'

app.get(
  '/ws',
  upgradeWebSocket((c) => ({
    onMessage(event, ws) {
      ws.send(`Echo: ${event.data}`)
    },
    onClose() {
      console.log('Connection closed')
    },
  }))
)
```

Sources: [src/adapter/cloudflare-workers/websocket.ts:5-53](repo://src/adapter/cloudflare-workers/websocket.ts#L5-L53)

## The shared helper

### defineWebSocketHelper

Each adapter builds its `upgradeWebSocket` with `defineWebSocketHelper(handler)`, where `handler(c, events, options)` performs the upgrade and returns the response, or nothing when the request is not an upgrade. The result can be called two ways:

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

- As middleware: `upgradeWebSocket((c) => events, options)`. It calls the factory for each request (the factory may be async), runs the handler, and returns the upgrade response; when the handler returns nothing, it calls `next()` so a normal route can answer the same path.
- Inside a handler: `await upgradeWebSocket(c, events, options)`. It returns the upgrade response and throws `Failed to upgrade WebSocket` when the handler returned nothing.

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

The middleware form is typed with `outputFormat: 'ws'`, which the [[RPC Client]] reads to offer a `$ws()` method that opens a `WebSocket` to the route.

Sources: [src/helper/websocket/index.ts:21-40](repo://src/helper/websocket/index.ts#L21-L40), [src/client/types.ts:112-118](repo://src/client/types.ts#L112-L118)

### WSContext

`WSContext` wraps whatever the runtime's socket is. It is constructed from an init object that supplies `send`, `close`, `readyState`, and optionally `raw`, `url` and `protocol`, and it exposes:

Sources: [src/helper/websocket/index.ts:42-99](repo://src/helper/websocket/index.ts#L42-L99)

| Member | Meaning |
| --- | --- |
| `send(data, { compress })` | Send a string, `ArrayBuffer` or `Uint8Array`; `compress` is only used by Bun |
| `close(code, reason)` | Close the connection |
| `readyState` | 0 connecting, 1 open, 2 closing, 3 closed |
| `url`, `protocol` | The socket's URL as a `URL`, and the negotiated subprotocol |
| `raw` | The runtime's own socket object |
| `binaryType` | Always `arraybuffer` |

Sources: [src/helper/websocket/index.ts:42-99](repo://src/helper/websocket/index.ts#L42-L99)

## Runtime implementations

### Cloudflare Workers

The Workers adapter returns nothing unless the `Upgrade` header is `websocket`. It creates a `WebSocketPair`, builds a `WSContext` around the server end, attaches `close`, `message` and `error` listeners, calls `server.accept()`, and returns a `101` response carrying the client end in its `webSocket` property. Workers have no `open` event, as the code notes, so its type omits `onOpen`.

Sources: [src/adapter/cloudflare-workers/websocket.ts:1-53](repo://src/adapter/cloudflare-workers/websocket.ts#L1-L53)

### Deno

The Deno adapter checks the `upgrade` header and calls `Deno.upgradeWebSocket(c.req.raw, options)`, where `options` is the second argument of `upgradeWebSocket`. When the client requested subprotocols, the first one is passed as `protocol` so the response echoes it back; the comment explains that browsers reject a connection whose requested subprotocol is missing from the response. The socket's `onopen`, `onmessage`, `onclose` and `onerror` call the matching events, and Deno's response is returned.

Sources: [src/adapter/deno/websocket.ts:1-38](repo://src/adapter/deno/websocket.ts#L1-L38)

### Bun

Bun upgrades through its server object, and dispatches socket events to a handler object given to `Bun.serve`, not to per-socket listeners. The adapter therefore has two halves, both exported from `hono/bun`:

Sources: [src/adapter/bun/websocket.ts:24-104](repo://src/adapter/bun/websocket.ts#L24-L104), [src/adapter/bun/server.ts:1-14](repo://src/adapter/bun/server.ts#L1-L14)

1. `upgradeWebSocket` gets the server with `getBunServer(c)`, which reads `c.env.server` or `c.env` itself, since Bun passes the server as the second argument of `fetch`. It calls `server.upgrade(c.req.raw, { data })` with the events, the URL and the first requested subprotocol, and returns an empty response on success. Without a server it throws `env has to include the 2nd argument of fetch.`
2. `websocket` is the handler object for `Bun.serve`. Its `open`, `message` and `close` read the events from `ws.data` and call `onOpen`, `onMessage` (a binary message is passed as its `ArrayBuffer`) and `onClose` with a fresh `WSContext`.

Sources: [src/adapter/bun/websocket.ts:24-104](repo://src/adapter/bun/websocket.ts#L24-L104), [src/adapter/bun/server.ts:1-14](repo://src/adapter/bun/server.ts#L1-L14)

```ts
import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'

const app = new Hono()
app.get('/ws', upgradeWebSocket(() => ({ onMessage: (e, ws) => ws.send(e.data as string) })))

export default { fetch: app.fetch, websocket }
```

Sources: [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/bun/websocket.ts:48-104](repo://src/adapter/bun/websocket.ts#L48-L104)

`createBunWebSocket()` returns the same pair and is deprecated in favour of the direct imports.

Sources: [src/adapter/bun/websocket.ts:106-113](repo://src/adapter/bun/websocket.ts#L106-L113)

## Middleware and upgrades

An upgrade response is an ordinary return value from the chain, so middleware registered before the WebSocket route runs first and can refuse the request, for example an authentication check described in [[Authentication Middleware]].

Sources: [src/helper/websocket/index.ts:121-128](repo://src/helper/websocket/index.ts#L121-L128), [src/adapter/cloudflare-workers/websocket.ts:46-53](repo://src/adapter/cloudflare-workers/websocket.ts#L46-L53)
