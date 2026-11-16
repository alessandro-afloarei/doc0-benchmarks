---
title: "WebSocket Helper"
---
## Overview

The Fetch API has no standard way to accept a WebSocket, so every runtime offers its own: `Bun.serve` upgrades through its server object, Deno has `Deno.upgradeWebSocket`, and Cloudflare Workers create a `WebSocketPair`. `hono/ws` defines one interface over them. An app writes event handlers against `WSContext` and calls the `upgradeWebSocket` exported by its runtime's adapter (`hono/bun`, `hono/deno` or `hono/cloudflare-workers`); each adapter is built with `defineWebSocketHelper`. The client side, `$ws()` on the [[RPC Client]], is typed from the `ws` output format the middleware declares.

Sources: [src/helper/websocket/index.ts:14-40](repo://src/helper/websocket/index.ts#L14-L40), [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140), [src/client/types.ts:112-118](repo://src/client/types.ts#L112-L118)

```ts
import { upgradeWebSocket } from 'hono/cloudflare-workers'

app.get(
  '/ws',
  upgradeWebSocket((c) => ({
    onMessage(event, ws) {
      ws.send(`Echo: ${event.data}`)
    },
    onClose() {
      console.log('closed')
    },
  }))
)
```

Sources: [src/adapter/cloudflare-workers/websocket.ts:5-53](repo://src/adapter/cloudflare-workers/websocket.ts#L5-L53)

## The common interface

### Events

`WSEvents` has four optional handlers, each receiving the event and a `WSContext`: `onOpen`, `onMessage`, `onClose` and `onError`. A message's `data` is a string, a `Blob` or an `ArrayBuffer`-like value.

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19), [src/helper/websocket/index.ts:93-99](repo://src/helper/websocket/index.ts#L93-L99)

### WSContext

`WSContext` wraps the runtime's socket behind the same members everywhere:

Sources: [src/helper/websocket/index.ts:45-91](repo://src/helper/websocket/index.ts#L45-L91)

| Member | Meaning |
| --- | --- |
| `send(data, { compress? })` | Sends a string, `ArrayBuffer` or `Uint8Array`; `compress` is passed on where the runtime supports it. |
| `close(code?, reason?)` | Closes the socket. |
| `readyState` | `0` connecting, `1` open, `2` closing, `3` closed, read from the socket each time. |
| `url`, `protocol` | The connection URL and the negotiated subprotocol, or `null`. |
| `raw` | The runtime's own socket object. |
| `binaryType` | `arraybuffer`. |

Sources: [src/helper/websocket/index.ts:45-91](repo://src/helper/websocket/index.ts#L45-L91)

### Two ways to call upgradeWebSocket

`defineWebSocketHelper(handler)` turns a runtime-specific `handler(c, events, options)` into an `UpgradeWebSocket` with two call forms:

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

1. `upgradeWebSocket((c) => events, options)` returns a middleware. It builds the events from the Context, possibly asynchronously, and calls the handler. When the handler returns a response, that is the answer; when it returns nothing, because the request was not an upgrade, the middleware calls `next()` so another route can answer.
2. `upgradeWebSocket(c, events, options)` inside a handler returns a promise of the upgrade response and throws `Failed to upgrade WebSocket` when the handler returns nothing.

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

The middleware form is typed with `outputFormat: 'ws'`, which is what puts it into the route's schema for the RPC client, as [[Typed Routes and Schemas]] describes.

Sources: [src/helper/websocket/index.ts:24-40](repo://src/helper/websocket/index.ts#L24-L40)

## Runtime implementations

### Cloudflare Workers

The handler returns nothing unless the `Upgrade` header is `websocket`. It creates a `WebSocketPair`, wires `close`, `message` and `error` listeners on the server end to the events, calls `accept()`, and returns status 101 with the client end as `webSocket`. The comment notes that Workers have no `open` event, so `onOpen` is excluded from the events type for this adapter.

Sources: [src/adapter/cloudflare-workers/websocket.ts:4-53](repo://src/adapter/cloudflare-workers/websocket.ts#L4-L53)

### Deno

The handler also requires `Upgrade: websocket`. It calls `Deno.upgradeWebSocket` with the first subprotocol the client asked for, plus the options passed to `upgradeWebSocket`, attaches the four events to the socket's `on*` properties, and returns Deno's response. The comment explains why the subprotocol is echoed: some browsers reject the connection when they requested one and the response does not name it.

Sources: [src/adapter/deno/websocket.ts:4-38](repo://src/adapter/deno/websocket.ts#L4-L38)

### Bun

Bun splits an upgrade in two. `upgradeWebSocket` gets Bun's server from the Context with `getBunServer`, which reads `c.env.server` or `c.env` itself, and calls `server.upgrade(request, { data })`, storing the events, the URL and the first requested subprotocol in the socket's `data`. On success it returns an empty response; without a server in the environment it throws `env has to include the 2nd argument of fetch.`

Sources: [src/adapter/bun/websocket.ts:48-74](repo://src/adapter/bun/websocket.ts#L48-L74), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

The events then fire from Bun's server-level `websocket` handler, which the app must pass to `Bun.serve` next to `fetch`. Its `open`, `close` and `message` callbacks read the events from `ws.data` and call them with a fresh `WSContext`; binary messages are passed as their `ArrayBuffer`.

Sources: [src/adapter/bun/websocket.ts:76-104](repo://src/adapter/bun/websocket.ts#L76-L104)

```ts
import { upgradeWebSocket, websocket } from 'hono/bun'

app.get('/ws', upgradeWebSocket(() => ({ onMessage: (e, ws) => ws.send(String(e.data)) })))

export default { fetch: app.fetch, websocket }
```

Sources: [src/adapter/bun/websocket.ts:48-113](repo://src/adapter/bun/websocket.ts#L48-L113)

`createBunWebSocket()` returns both and is deprecated in favour of importing them from `hono/bun` directly.

Sources: [src/adapter/bun/websocket.ts:106-113](repo://src/adapter/bun/websocket.ts#L106-L113)

## Behaviour that differs by runtime

| | Bun | Deno | Cloudflare Workers |
| --- | --- | --- | --- |
| Non-upgrade request | Bun's `upgrade` decides | Passed to `next()` | Passed to `next()` |
| `onOpen` | Yes | Yes | Not available |
| `onError` | Not wired | Yes | Yes |
| `send` options | `compress` honoured | Ignored | Ignored |
| Response returned | Empty `Response` | Deno's upgrade response | Status 101 with `webSocket` |

Sources: [src/adapter/bun/websocket.ts:33-104](repo://src/adapter/bun/websocket.ts#L33-L104), [src/adapter/deno/websocket.ts:4-38](repo://src/adapter/deno/websocket.ts#L4-L38), [src/adapter/cloudflare-workers/websocket.ts:10-53](repo://src/adapter/cloudflare-workers/websocket.ts#L10-L53)

Every other adapter is listed on [[Runtime Adapters]].

Sources: [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9)
