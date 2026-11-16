---
title: "WebSockets"
---
## Overview

Every runtime upgrades HTTP connections to WebSockets with its own API: Bun's `server.upgrade`, Deno's `Deno.upgradeWebSocket`, Cloudflare's `WebSocketPair`. Hono hides the differences behind one interface. `hono/ws` defines the event callbacks (`WSEvents`), a socket wrapper (`WSContext`) and `defineWebSocketHelper`, and each adapter uses them to export an `upgradeWebSocket` with the same signature. Application code is written once and only the import changes. Node.js support lives in `@hono/node-ws`.

Sources: [src/helper/websocket/index.ts:14-91](repo://src/helper/websocket/index.ts#L14-L91), [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

```ts
import { upgradeWebSocket } from 'hono/cloudflare-workers' // or 'hono/deno'

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

Sources: [src/adapter/cloudflare-workers/websocket.ts:5-53](repo://src/adapter/cloudflare-workers/websocket.ts#L5-L53)

## The shared interface

### Events and context

`WSEvents` has four optional callbacks: `onOpen`, `onMessage`, `onClose` and `onError`. Each receives the native event and a `WSContext`. `WSContext` exposes `send(data, { compress? })`, `close(code?, reason?)`, `readyState`, `url`, `protocol`, `binaryType` (default `arraybuffer`) and `raw`, the runtime's own socket for anything the wrapper does not cover. Its constructor takes a `WSContextInit` with the adapter's implementations of `send`, `close` and `readyState`.

Sources: [src/helper/websocket/index.ts:14-91](repo://src/helper/websocket/index.ts#L14-L91)

### Two call styles

`defineWebSocketHelper(handler)` turns an adapter's `(c, events, options) => Response | void` function into an `upgradeWebSocket` that can be called two ways.

Sources: [src/helper/websocket/index.ts:111-118](repo://src/helper/websocket/index.ts#L111-L118)

| Call | Result |
| --- | --- |
| `upgradeWebSocket((c) => events, options?)` | A middleware. It builds the events from `c`, runs the adapter handler, returns its response, or calls `next()` when the request was not an upgrade |
| `upgradeWebSocket(c, events, options?)` | A promise of the upgrade response for use inside a handler; throws `Failed to upgrade WebSocket` when the adapter returned nothing |

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

The middleware form falls through to `next()` for ordinary requests, so the same path can serve an HTML page to browsers and a socket to WebSocket clients. Its type marks the route's output format as `ws`, which gives the RPC client a typed `$ws()` method for that route ([[RPC Client]]).

Sources: [src/helper/websocket/index.ts:24-40](repo://src/helper/websocket/index.ts#L24-L40), [src/helper/websocket/index.ts:119-128](repo://src/helper/websocket/index.ts#L119-L128)

## Adapters

### Cloudflare Workers

`hono/cloudflare-workers` returns nothing unless the `Upgrade` header is `websocket`. It creates a `WebSocketPair`, wraps the server end in a `WSContext`, adds `close`, `message` and `error` listeners for the callbacks that were given, calls `server.accept()`, and answers `101 Switching Protocols` with the client end as the response's `webSocket`. Workers do not emit `open` on the server socket, so `onOpen` is excluded from this adapter's event type.

Sources: [src/adapter/cloudflare-workers/websocket.ts:1-53](repo://src/adapter/cloudflare-workers/websocket.ts#L1-L53)

### Deno

`hono/deno` also checks the `upgrade` header, then calls `Deno.upgradeWebSocket(c.req.raw, options)`. When the client requested subprotocols, the first is echoed back with the `protocol` option, because browsers such as Chrome drop the connection when a requested subprotocol is not confirmed. The socket's four handlers forward to the events, and Deno's prepared response is returned. The options argument is passed through, so `idleTimeout` and similar settings work.

Sources: [src/adapter/deno/websocket.ts:1-38](repo://src/adapter/deno/websocket.ts#L1-L38)

### Bun

Bun dispatches socket events to a `websocket` object passed to `Bun.serve`, not to listeners on the socket, so the Bun adapter has two parts.

Sources: [src/adapter/bun/websocket.ts:15-28](repo://src/adapter/bun/websocket.ts#L15-L28)

1. `upgradeWebSocket` gets the Bun server from `c.env` (the second argument of `fetch`), calls `server.upgrade(c.req.raw, { data: { events, url, protocol } })`, and returns an empty response on success. Without the server in `env` it throws `env has to include the 2nd argument of fetch.`
2. The exported `websocket` handler reads `events` back from `ws.data` in `open`, `message` and `close`, wraps the socket with `createWSContext`, and calls the matching callback. Binary messages are normalised to their `ArrayBuffer`.

Sources: [src/adapter/bun/websocket.ts:33-104](repo://src/adapter/bun/websocket.ts#L33-L104), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

```ts
import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'

const app = new Hono()
app.get('/ws', upgradeWebSocket(() => ({ onMessage: (e, ws) => ws.send(String(e.data)) })))

export default { fetch: app.fetch, websocket }
```

Sources: [src/adapter/bun/websocket.ts:48-113](repo://src/adapter/bun/websocket.ts#L48-L113)

`createBunWebSocket()` returns both parts as one object and remains for compatibility.

Sources: [src/adapter/bun/websocket.ts:110-113](repo://src/adapter/bun/websocket.ts#L110-L113)

## Behaviour that differs by runtime

| Concern | Cloudflare Workers | Deno | Bun |
| --- | --- | --- | --- |
| `onOpen` | Not supported | Supported | Supported |
| `onError` | Supported | Supported | Not wired |
| Non-upgrade request | Falls through to `next()` | Falls through to `next()` | `server.upgrade` decides; returns nothing on failure |
| Subprotocol | Native `protocol` | First requested one echoed | First requested one stored in `data.protocol` |
| `send` options | Ignored | Ignored | `compress` passed to Bun |

Sources: [src/adapter/cloudflare-workers/websocket.ts:34-47](repo://src/adapter/cloudflare-workers/websocket.ts#L34-L47), [src/adapter/deno/websocket.ts:6-35](repo://src/adapter/deno/websocket.ts#L6-L35), [src/adapter/bun/websocket.ts:33-74](repo://src/adapter/bun/websocket.ts#L33-L74)

Middleware that modifies headers after `next()`, such as CORS or secure headers, can break WebSocket routes: the `101` response from Workers carries a `webSocket` that is lost when the response is re-created to make its headers mutable ([[Context and Responses]]). Registering such middleware on paths that exclude the socket route, or with `except` from [[Combining Middleware and Context Storage]], avoids this.

Sources: [src/adapter/cloudflare-workers/websocket.ts:48-52](repo://src/adapter/cloudflare-workers/websocket.ts#L48-L52), [src/context.ts:414-434](repo://src/context.ts#L414-L434)
