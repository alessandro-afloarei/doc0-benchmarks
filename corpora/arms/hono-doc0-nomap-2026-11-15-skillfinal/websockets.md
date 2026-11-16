---
title: "WebSockets"
---
## Overview

Each runtime upgrades HTTP connections to WebSockets with a different API, so Hono splits WebSocket support in two. The helper in `hono/ws` defines the common shape: a set of event callbacks (`WSEvents`), a socket wrapper (`WSContext`), and `defineWebSocketHelper`, which turns a runtime-specific upgrade function into an `upgradeWebSocket` middleware. Each adapter (`hono/cloudflare-workers`, `hono/deno`, `hono/bun`) exports its own `upgradeWebSocket` built that way.

Sources: [src/helper/websocket/index.ts:11-99](repo://src/helper/websocket/index.ts#L11-L99), [src/helper/websocket/index.ts:108-140](repo://src/helper/websocket/index.ts#L108-L140), [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11)

Application code is the same on every runtime: register `upgradeWebSocket((c) => ({ onOpen, onMessage, onClose, onError }))` on a route and talk to the client through the `ws` argument of each callback.

Sources: [src/helper/websocket/index.ts:14-40](repo://src/helper/websocket/index.ts#L14-L40)

## The common interface

### WSEvents and WSContext

`WSEvents` has four optional callbacks, `onOpen`, `onMessage`, `onClose` and `onError`, each receiving the DOM-style event and a `WSContext`. `WSContext` wraps whatever the runtime provides: `send(data, { compress })`, `close(code, reason)`, `readyState`, `url`, `protocol`, `binaryType` (defaulting to `arraybuffer`) and `raw`, the runtime's own socket object.

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19), [src/helper/websocket/index.ts:42-99](repo://src/helper/websocket/index.ts#L42-L99)

### defineWebSocketHelper

`defineWebSocketHelper(handler)` takes a function `(c, events, options) => Response | void` that performs the upgrade, and returns an `upgradeWebSocket` with two call forms:

Sources: [src/helper/websocket/index.ts:101-113](repo://src/helper/websocket/index.ts#L101-L113)

| Call | Returns | When the upgrade does not happen |
| --- | --- | --- |
| `upgradeWebSocket(createEvents, options)` | a middleware that awaits `createEvents(c)`, calls the handler, and returns its response | calls `next()`, so a later handler answers the plain HTTP request |
| `upgradeWebSocket(c, events, options)` | a promise of the upgrade response, for use inside a handler | throws `Failed to upgrade WebSocket` |

Sources: [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)

The middleware form is typed with `outputFormat: 'ws'`, which puts that format in the route's schema; the [[RPC Client]] then offers `$ws()` for the route, returning a `WebSocket` to the same URL with the `http` scheme replaced by `ws`.

Sources: [src/helper/websocket/index.ts:21-40](repo://src/helper/websocket/index.ts#L21-L40), [src/client/types.ts:112-118](repo://src/client/types.ts#L112-L118), [src/client/client.ts:187-212](repo://src/client/client.ts#L187-L212)

## Runtime implementations

### Cloudflare Workers

The Workers version returns nothing (so the middleware falls through) unless the `Upgrade` header is exactly `websocket`. It creates a `WebSocketPair`, wraps the server end in a `WSContext`, attaches `close`, `message` and `error` listeners, calls `accept()`, and returns `101` with the client end as the response's `webSocket`. Workers emit no `open` event, so `onOpen` is excluded from its event type and never called.

Sources: [src/adapter/cloudflare-workers/websocket.ts:1-53](repo://src/adapter/cloudflare-workers/websocket.ts#L1-L53)

### Deno

The Deno version checks the `upgrade` header, then calls `Deno.upgradeWebSocket(c.req.raw, options)`. It echoes the first requested subprotocol from `Sec-WebSocket-Protocol`, because, as the comment explains, browsers such as Chrome reject a connection whose response omits a requested subprotocol. All four events are wired to the socket's `on...` properties, and the response from Deno is returned.

Sources: [src/adapter/deno/websocket.ts:1-38](repo://src/adapter/deno/websocket.ts#L1-L38)

### Bun

Bun upgrades through the server object rather than the request, and delivers socket events to a handler object given to `Bun.serve`, not to the socket. The Bun version therefore has two halves: `upgradeWebSocket` and `websocket`.

Sources: [src/adapter/bun/websocket.ts:15-28](repo://src/adapter/bun/websocket.ts#L15-L28)

`upgradeWebSocket` gets the server with `getBunServer(c)`, which reads `c.env.server` or treats `c.env` itself as the server, the second argument Bun passes to `fetch`. It calls `server.upgrade(c.req.raw, { data })` with the event callbacks, the URL and the first requested subprotocol as the socket's `data`, and returns an empty `Response` on success; without a server it throws a `TypeError`.

Sources: [src/adapter/bun/websocket.ts:48-74](repo://src/adapter/bun/websocket.ts#L48-L74), [src/adapter/bun/server.ts:1-14](repo://src/adapter/bun/server.ts#L1-L14)

`websocket` is the handler object for `Bun.serve`. Its `open`, `close` and `message` methods read the callbacks back from `ws.data.events`, build a `WSContext` for the Bun socket, and call `onOpen`, `onClose` (with a `CloseEvent` carrying the code and reason) or `onMessage` (with a `MessageEvent` whose data is the string or the message's `ArrayBuffer`). Sending passes `compress` through to Bun. `createBunWebSocket()` returns both halves and is deprecated in favour of importing them directly.

Sources: [src/adapter/bun/websocket.ts:30-46](repo://src/adapter/bun/websocket.ts#L30-L46), [src/adapter/bun/websocket.ts:76-113](repo://src/adapter/bun/websocket.ts#L76-L113), [src/helper/websocket/index.ts:93-99](repo://src/helper/websocket/index.ts#L93-L99)

## Differences at a glance

| | Cloudflare Workers | Deno | Bun |
| --- | --- | --- | --- |
| Upgrade check | `Upgrade: websocket` | `upgrade: websocket` | delegated to `server.upgrade` |
| `onOpen` | not supported | yes | yes |
| Subprotocol | from the socket | first requested, echoed | first requested |
| Extra setup | none | none | pass `websocket` to `Bun.serve` |
| `options` argument | ignored | `Deno.UpgradeWebSocketOptions` | ignored |

Sources: [src/adapter/cloudflare-workers/websocket.ts:5-53](repo://src/adapter/cloudflare-workers/websocket.ts#L5-L53), [src/adapter/deno/websocket.ts:4-38](repo://src/adapter/deno/websocket.ts#L4-L38), [src/adapter/bun/websocket.ts:48-113](repo://src/adapter/bun/websocket.ts#L48-L113)
