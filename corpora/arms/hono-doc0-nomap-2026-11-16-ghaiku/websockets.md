---
title: "WebSockets"
---
## Overview

The WebSocket helper turns a route into a WebSocket endpoint. A handler calls `upgradeWebSocket`, which takes a function that returns event listeners, and the helper answers the request with the upgrade response. The listeners get a `WSContext` to send and close with. The helper itself is runtime-neutral: `defineWebSocketHelper` takes a function that does the runtime-specific upgrade, and each runtime adapter supplies one. This page covers the helper's two call forms, the context object, and the Bun, Deno and Cloudflare Workers upgrades. Runtime selection is on [[Runtime Adapters]].

Sources: [src/helper/websocket/index.ts:111-139](repo://src/helper/websocket/index.ts#L111-L139)

## Calling upgradeWebSocket

`defineWebSocketHelper(handler)` returns a function with two call forms. When the first argument is a function, it is a route middleware: the function gets the context and returns the listeners, and the middleware calls the handler with them. If the handler returns a response, that response is the answer. Otherwise the middleware calls `next()`, so a plain HTTP request on the same route still reaches the next handler.

Sources: [src/helper/websocket/index.ts:111-128](repo://src/helper/websocket/index.ts#L111-L128)

When the first argument is the context, the second form is a direct call. It takes the context and the listeners, runs the handler, and returns its result. If the handler returns nothing, the call throws `Failed to upgrade WebSocket`.

Sources: [src/helper/websocket/index.ts:129-137](repo://src/helper/websocket/index.ts#L129-L137)

The listeners are `onOpen`, `onMessage`, `onClose` and `onError`. Each receives an event and the `WSContext`. The interface types only describe them; the runtime decides when each one runs.

Sources: [src/helper/websocket/index.ts:14-19](repo://src/helper/websocket/index.ts#L14-L19)

## The WSContext object

`WSContext` wraps the runtime's socket. Its constructor takes `send`, `close`, a `readyState` and optional `raw`, `url` and `protocol` values, and copies the URL and the protocol into fields. `send` passes the data and an options object, with `compress` as the only option, to the wrapped function. `close` takes a code and a reason.

Sources: [src/helper/websocket/index.ts:50-91](repo://src/helper/websocket/index.ts#L50-L91)

`readyState` is a getter that reads the runtime's value each time, so the state is never stale. `binaryType` defaults to `arraybuffer`.

Sources: [src/helper/websocket/index.ts:82-85](repo://src/helper/websocket/index.ts#L82-L85)

## Bun

The Bun adapter's upgrade calls `server.upgrade` with the request and a data object that holds the listeners, the URL and the first requested subprotocol. It returns an empty `Response` when the upgrade works, and nothing when it fails. The server object comes from the bindings, and without it the helper throws a `TypeError`.

Sources: [src/adapter/bun/websocket.ts:48-74](repo://src/adapter/bun/websocket.ts#L48-L74)

The Bun adapter also exports a `websocket` handler, a set of `open`, `close` and `message` callbacks in the form Bun's server expects. Each callback reads the listeners from the socket's data and calls the matching one with a `WSContext` built from that socket.

Sources: [src/adapter/bun/websocket.ts:30-45](repo://src/adapter/bun/websocket.ts#L30-L45), [src/adapter/bun/websocket.ts:76-100](repo://src/adapter/bun/websocket.ts#L76-L100)

## Deno

The Deno adapter returns nothing for a request whose `Upgrade` header is not `websocket`. Otherwise it echoes the first requested subprotocol back, because browsers reject a connection when the response lacks it, and calls `Deno.upgradeWebSocket`. The socket's `onopen`, `onmessage`, `onclose` and `onerror` handlers forward to the listeners, and the response from Deno is returned.

Sources: [src/adapter/deno/websocket.ts:4-38](repo://src/adapter/deno/websocket.ts#L4-L38)

## Cloudflare Workers

The Workers adapter checks the `Upgrade` header the same way. It creates a `WebSocketPair`, keeps the server end for the `WSContext`, and attaches the close, message and error listeners to it. The `open` listener is not used, because the comment says Workers does not support that event. The server end is accepted, and the client end is returned in a 101 response.

Sources: [src/adapter/cloudflare-workers/websocket.ts:10-53](repo://src/adapter/cloudflare-workers/websocket.ts#L10-L53)
