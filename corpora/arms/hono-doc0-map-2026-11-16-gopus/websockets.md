---
title: "WebSockets"
---
## Overview

Each runtime upgrades a WebSocket connection with a different API: Bun upgrades through its server object, Deno through `Deno.upgradeWebSocket`, and Cloudflare Workers through a `WebSocketPair`. Hono hides those differences behind one function, `upgradeWebSocket`, which each adapter exports with the same calling convention. The shared part lives in `helper/websocket`: the event interface, the `WSContext` wrapper around a socket, and `defineWebSocketHelper`, which turns a runtime-specific upgrade function into the middleware form.

Sources: [src/helper/websocket/index.ts:14-91](repo://src/helper/websocket/index.ts#L14-L91), [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140), [src/adapter/deno/websocket.ts:4-38](repo://src/adapter/deno/websocket.ts#L4-L38)

```ts
import { upgradeWebSocket } from 'hono/cloudflare-workers'

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

Sources: [src/helper/websocket/index.ts:24-40](repo://src/helper/websocket/index.ts#L24-L40), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8)

## Events and WSContext

The callback passed to `upgradeWebSocket` receives the Context and returns `WSEvents`, optionally through a Promise. Every event handler receives the event and a `WSContext`:

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19), [src/helper/websocket/index.ts:93-99](repo://src/helper/websocket/index.ts#L93-L99)

| Event | Argument |
| --- | --- |
| `onOpen` | `Event` |
| `onMessage` | `MessageEvent` whose `data` is a string, a `Blob` or an `ArrayBuffer` |
| `onClose` | `CloseEvent` |
| `onError` | `Event` |

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19), [src/helper/websocket/index.ts:93-99](repo://src/helper/websocket/index.ts#L93-L99)

`WSContext` gives handlers one interface over the runtime's socket: `send(data, { compress? })`, `close(code?, reason?)`, a live `readyState`, `url` as a `URL` or `null`, the negotiated `protocol`, and `raw`, the runtime's own socket object. `binaryType` is `'arraybuffer'`. Adapters build it from a `WSContextInit` that maps each member to the native call.

Sources: [src/helper/websocket/index.ts:45-91](repo://src/helper/websocket/index.ts#L45-L91)

## Two calling forms

`defineWebSocketHelper(handler)` returns a function that works in two ways, both typed by `UpgradeWebSocket`:

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

| Call | Returns | When the request is not an upgrade |
| --- | --- | --- |
| `upgradeWebSocket((c) => events, options?)` | Middleware | Calls `next()`, so other handlers on the route answer |
| `upgradeWebSocket(c, events, options?)` | `Promise<Response>` from inside a handler | Throws `Failed to upgrade WebSocket` |

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140)

The runtime `handler(c, events, options)` returns a `Response` when it upgraded the connection and nothing when it did not; the helper decides from that which row applies. In the middleware form, `createEvents(c)` runs per request, so handlers can close over request data such as an authenticated user.

Sources: [src/helper/websocket/index.ts:102-128](repo://src/helper/websocket/index.ts#L102-L128)

The middleware form is typed with `outputFormat: 'ws'`, which is what makes the [[RPC Client]] offer `$ws()` on that route.

Sources: [src/helper/websocket/index.ts:24-34](repo://src/helper/websocket/index.ts#L24-L34), [src/client/types.ts:113-118](repo://src/client/types.ts#L113-L118)

## Deno

The Deno adapter returns nothing unless the `upgrade` header is `websocket`. It then calls `Deno.upgradeWebSocket(c.req.raw, options)` and returns the `response` that call gives. The first subprotocol the client requested is echoed through the `protocol` option; a comment explains that browsers such as Chrome reject the connection when a requested subprotocol is missing from the response. The socket's `onopen`, `onmessage`, `onclose` and `onerror` call the matching events with one shared `WSContext`.

Sources: [src/adapter/deno/websocket.ts:1-38](repo://src/adapter/deno/websocket.ts#L1-L38)

## Cloudflare Workers

The Cloudflare adapter checks the `Upgrade` header, creates a `WebSocketPair`, keeps the server end and answers `101` with the client end in the response's `webSocket` field. It registers `close`, `message` and `error` listeners only for events that were given, and calls `server.accept()`.

Sources: [src/adapter/cloudflare-workers/websocket.ts:1-53](repo://src/adapter/cloudflare-workers/websocket.ts#L1-L53)

Its type omits `onOpen` from the events, because, as a comment says, Cloudflare Workers does not support the `open` event. The `createEvents` callback of the middleware form still runs on every request, right before the upgrade.

Sources: [src/adapter/cloudflare-workers/websocket.ts:5-10](repo://src/adapter/cloudflare-workers/websocket.ts#L5-L10), [src/adapter/cloudflare-workers/websocket.ts:34-34](repo://src/adapter/cloudflare-workers/websocket.ts#L34-L34), [src/helper/websocket/index.ts:121-123](repo://src/helper/websocket/index.ts#L121-L123)

## Bun

Bun splits WebSocket handling between the request and the server. `upgradeWebSocket` in `hono/bun` gets the server object with `getBunServer(c)`, which reads `c.env.server` or `c.env` itself, and throws `env has to include the 2nd argument of fetch.` when there is none. It calls `server.upgrade(c.req.raw, { data })`, where `data` carries the events, the request URL and the first requested subprotocol, and returns an empty `Response` when Bun accepted the upgrade.

Sources: [src/adapter/bun/websocket.ts:48-74](repo://src/adapter/bun/websocket.ts#L48-L74), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

The socket events then arrive at Bun's server-level handler, not at a per-socket listener. The exported `websocket` object is that handler: its `open`, `close` and `message` methods read the events from `ws.data` and call them with a new `WSContext`. A binary message arrives as an object with `buffer`, which is passed on as the `ArrayBuffer`.

Sources: [src/adapter/bun/websocket.ts:76-104](repo://src/adapter/bun/websocket.ts#L76-L104), [src/adapter/bun/websocket.ts:33-46](repo://src/adapter/bun/websocket.ts#L33-L46)

So a Bun app hands both the app's `fetch` and this `websocket` object to Bun's server:

Sources: [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/bun/websocket.ts:76-104](repo://src/adapter/bun/websocket.ts#L76-L104)

```ts
import { upgradeWebSocket, websocket } from 'hono/bun'

app.get('/ws', upgradeWebSocket(() => ({ onMessage: (e, ws) => ws.send(e.data as string) })))

export default { fetch: app.fetch, websocket }
```

Sources: [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/bun/websocket.ts:76-104](repo://src/adapter/bun/websocket.ts#L76-L104)

`send` on Bun passes `options.compress` to Bun's own `send`, the only adapter that uses that option. `createBunWebSocket()`, which returned both values, is deprecated in favour of the direct imports.

Sources: [src/adapter/bun/websocket.ts:33-46](repo://src/adapter/bun/websocket.ts#L33-L46), [src/adapter/bun/websocket.ts:106-113](repo://src/adapter/bun/websocket.ts#L106-L113)

## Writing an adapter

`defineWebSocketHelper` is exported from `hono/ws`, so other runtimes can provide `upgradeWebSocket` the same way: check that the request asks for an upgrade, perform the runtime's upgrade, wrap the socket in a `WSContext`, wire its events to the `WSEvents`, and return the upgrade `Response`, or return nothing to decline.

Sources: [src/helper/websocket/index.ts:101-140](repo://src/helper/websocket/index.ts#L101-L140), [package.json:399-403](repo://package.json#L399-L403)
