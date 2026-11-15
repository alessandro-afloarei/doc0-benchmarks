---
title: "WebSockets"
---
## Overview

Every runtime upgrades a WebSocket connection differently: Bun upgrades through its server object, Deno through `Deno.upgradeWebSocket`, Cloudflare Workers through a `WebSocketPair`. Hono hides the difference behind one function, `upgradeWebSocket`, imported from the runtime's adapter module. A route uses it as middleware that returns event handlers, and the handlers receive a runtime-neutral `WSContext`. The generic part lives in `helper/websocket`; each adapter supplies only the upgrade itself (see [[Runtime Adapters]]).

Sources: [src/helper/websocket/index.ts:14-40](repo://src/helper/websocket/index.ts#L14-L40), [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)

```ts
import { upgradeWebSocket } from 'hono/cloudflare-workers' // or 'hono/deno', or 'hono/bun'

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

## The generic helper

### defineWebSocketHelper

An adapter writes one function `(c, events, options) => Response | void` that performs the upgrade and wires the runtime's socket events to the `events` object. `defineWebSocketHelper` turns it into `upgradeWebSocket`, which can be called two ways:

Sources: [src/helper/websocket/index.ts:101-113](repo://src/helper/websocket/index.ts#L101-L113)

| Call | Returns | Behaviour |
| --- | --- | --- |
| `upgradeWebSocket((c) => events, options)` | A middleware | Builds the events from the context (possibly async), runs the upgrade, and returns its response; if the upgrade did not happen (not a WebSocket request), calls `next()` so a later handler can answer |
| `upgradeWebSocket(c, events, options)` | A promise of the upgrade response | For use inside a handler; throws `Failed to upgrade WebSocket` when the request is not an upgrade |

Sources: [src/helper/websocket/index.ts:114-139](repo://src/helper/websocket/index.ts#L114-L139)

The middleware form is typed with `outputFormat: 'ws'`, which the [[RPC Client]] turns into a `$ws()` method on the route that opens a `WebSocket` to the matching `ws:` or `wss:` URL.

Sources: [src/helper/websocket/index.ts:28-34](repo://src/helper/websocket/index.ts#L28-L34), [src/client/types.ts:112-118](repo://src/client/types.ts#L112-L118)

### WSEvents and WSContext

`WSEvents` has four optional handlers, `onOpen`, `onMessage`, `onClose` and `onError`, each called with the native event and a `WSContext`. `WSContext` wraps the runtime's socket: `send(data, { compress })`, `close(code, reason)`, `readyState`, `url`, `protocol`, `binaryType` (default `arraybuffer`), and `raw`, the native socket for anything not covered. Its constructor takes a `WSContextInit` whose `send`, `close` and `readyState` the adapter implements.

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19), [src/helper/websocket/index.ts:45-99](repo://src/helper/websocket/index.ts#L45-L99)

Because `createEvents` receives the Hono `Context`, it can read parameters, headers or `c.get(...)` values set by authentication middleware before the connection is accepted; the events close over them.

Sources: [src/helper/websocket/index.ts:121-128](repo://src/helper/websocket/index.ts#L121-L128)

## Runtime implementations

### Cloudflare Workers

The Workers adapter returns nothing when the `Upgrade` header is not `websocket`. Otherwise it creates a `WebSocketPair`, wraps the server end in a `WSContext`, attaches `close`, `message` and `error` listeners, calls `server.accept()`, and returns a `101` response carrying the client end as `webSocket`. Workers emit no `open` event on the server end, so the adapter's type removes `onOpen` from the events.

Sources: [src/adapter/cloudflare-workers/websocket.ts:1-53](repo://src/adapter/cloudflare-workers/websocket.ts#L1-L53)

### Deno

The Deno adapter also checks the `upgrade` header, then calls `Deno.upgradeWebSocket(c.req.raw, options)`, passing the first subprotocol the client asked for so the response echoes `Sec-WebSocket-Protocol` (browsers drop the connection otherwise). It assigns the four socket handlers to the events and returns Deno's response. Options are Deno's `UpgradeWebSocketOptions`, such as `idleTimeout`.

Sources: [src/adapter/deno/websocket.ts:1-38](repo://src/adapter/deno/websocket.ts#L1-L38)

### Bun

Bun dispatches WebSocket events to a handler object registered on the server, not to the socket, so the Bun adapter has two parts. `upgradeWebSocket` gets the Bun server with `getBunServer(c)` (from `c.env.server`, or `c.env` itself, which is what Bun passes as the second `fetch` argument) and calls `server.upgrade(req, { data })`, storing the events, URL and first subprotocol on the socket's `data`. It returns an empty `Response` when `upgrade` succeeds, and nothing otherwise, so the middleware form falls through to `next()`.

Sources: [src/adapter/bun/websocket.ts:48-74](repo://src/adapter/bun/websocket.ts#L48-L74), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

The exported `websocket` object is that handler: its `open`, `message` and `close` methods read the events back from `ws.data` and call them with a fresh `WSContext`. Binary messages are normalised to their `ArrayBuffer`. The application must pass it to `Bun.serve`:

Sources: [src/adapter/bun/websocket.ts:76-104](repo://src/adapter/bun/websocket.ts#L76-L104)

```ts
import { upgradeWebSocket, websocket } from 'hono/bun'

export default {
  fetch: app.fetch,
  websocket,
}
```

Sources: [src/adapter/bun/websocket.ts:76-113](repo://src/adapter/bun/websocket.ts#L76-L113)

`createBunWebSocket()` returns the same pair for code written against older versions.

Sources: [src/adapter/bun/websocket.ts:110-113](repo://src/adapter/bun/websocket.ts#L110-L113)
