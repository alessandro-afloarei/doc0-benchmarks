---
type: integration
title: Runtime adapters and WebSocket integration
description: The fetch portability boundary, platform bindings, Lambda event translation, WebSocket upgrades, and runtime regression tests.
tags: [adapters, runtimes, websocket, lambda]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-33324115ee2aa60ceff3fd10
    resource: repo://runtime-tests/node/index.test.ts
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-a297b78d110b6653c37db7e1
    resource: repo://src/adapter/bun/server.ts
  - id: openwiki-source-91d3173886899b1d372057c9
    resource: repo://src/adapter/bun/websocket.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-742c2cb89906fa46f1243028
    resource: repo://src/adapter/deno/websocket.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-3b540c7cdbcadd6a68a916fb
    resource: repo://src/adapter/netlify/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-9a62de02f61d81368f630ab0
    resource: repo://src/adapter/vercel/handler.ts
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
  - id: openwiki-source-015f2dc60c9d3599ae2b42ec
    resource: repo://src/helper/websocket/index.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Runtime adapters and WebSocket integration

The portable application boundary is `app.fetch(request, bindings, executionContext)`. Adapters translate platform events into that call or supply runtime-specific helpers. They own network/event conversion, while [core dispatch](../architecture/request-lifecycle.md) owns matching and handler execution.

## Selecting the boundary

| Runtime surface | Integration in this repository |
| --- | --- |
| Fetch-native host | Pass a Web Request to `app.fetch` and return its response. |
| Cloudflare Pages | `handle(app)` forwards request, environment plus eventContext, and waitUntil/passThroughOnException capabilities. |
| Vercel | `handle(app)` forwards the request to fetch. |
| Netlify | `handle(app)` passes the platform context as `c.env.context`. |
| AWS Lambda | Selects an event processor, creates a Request, runs the app, and serializes a platform result. |
| Lambda@Edge | Converts CloudFront events and exposes event, context, callback, config, request, and response bindings. |
| Service Worker | Responds to fetch events; by default a Hono 404 falls back to the bound global fetch. |
| Bun / Deno / Cloudflare Workers helpers | Export platform-specific static serving, connection information, and WebSocket helpers; Bun and Deno also export SSG filesystem adapters. |
| Node.js | Runtime tests use the separate `@hono/node-server` package as the HTTP server bridge. |

The [adapter environment helper](../../src/helper/adapter/index.ts) reads process.env for Node/Bun/edge-light, Deno.env for Deno, and context bindings for workerd; Fastly and unknown runtimes return an empty object. Runtime detection uses user-agent and runtime-global checks. This helper does not merge all environment sources.

## Lambda request and response conversion

[handle(app)](../../src/adapter/aws-lambda/handler.ts) chooses ALB, API Gateway v2, Lattice v2, or the v1 fallback from event shape. V2 detection requires both rawPath and requestContext.http, because rawPath alone can also occur on v1 events.

Request creation derives URL, method, query, headers, and cookies through the selected processor. A body is decoded from base64 or encoded as UTF-8; Content-Length is replaced with its actual byte length. The application receives event, requestContext, and lambdaContext bindings.

Conversion errors occur before app dispatch. TypeError during request construction becomes a serialized 400 response; other construction failures become 500. These do not pass through the application's route error handler.

Result construction consumes the entire response body. It selects text or base64 using a configurable content-type predicate and content-encoding check, emits the status, and delegates cookie representation to the event processor. Multi-value headers and cookie arrays differ across event formats; preserve those differences when editing the converter.

`streamHandle(app)` is a separate path using the Lambda streaming global, response metadata, and a bridge from the Web stream reader to the platform stream. The buffered handler does not automatically become streaming because a route returns a ReadableStream. See [stream lifetime](../concepts/streaming.md) and the [Lambda stream runtime tests](../../runtime-tests/lambda/stream.test.ts).

## WebSocket upgrade ownership

The [shared WebSocket helper](../../src/helper/websocket/index.ts) gives handlers a WSContext for send, close, ready state, URL, protocol, and raw socket access. `defineWebSocketHelper()` adapts a runtime upgrade operation to either middleware or direct invocation. Middleware continues when no response is returned; direct invocation throws if no upgrade response exists.

| Adapter | Upgrade and event behavior |
| --- | --- |
| Bun | Calls server.upgrade with request-specific event data. Supply the exported `websocket` callbacks to the Bun server. The server is read from c.env.server or c.env. |
| Deno | Calls Deno.upgradeWebSocket and wires open/message/close/error events; the first requested subprotocol is the default, with explicit options able to override it. |
| Cloudflare Workers | Creates and accepts a WebSocketPair and returns the client socket with status 101. Its event type omits onOpen. |

Authentication and request checks should occur before upgrade. A WebSocket handshake is a platform response contract, so test middleware that mutates response headers with the actual adapter.

## Extending and verifying adapters

Implement conversions at the platform edge and keep the core Request/Response contract intact. Verify method and URL fidelity, repeated headers, cookie representation, body bytes, malformed input, bindings, cancellation, and streaming separately.

<!-- openwiki: broken internal link [../../runtime-tests] file "../../runtime-tests" does not exist. Fix the href or restore the target, then delete this comment. -->
[Lambda unit tests](../../src/adapter/aws-lambda/handler.test.ts) include invalid headers, v1 routing with rawPath, repeated headers, cookies, binary responses, and body-limit interaction. Bun, Deno, and Workers have focused WebSocket tests beside their implementations. The [runtime-tests](../../runtime-tests) directory exercises platform behavior beyond in-process fetch.

Use [testing workflows](../workflows/testing.md) for project commands and [static content](../workflows/static-content.md) for filesystem and asset-storage boundaries.
