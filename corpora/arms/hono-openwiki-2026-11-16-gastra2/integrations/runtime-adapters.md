---
type: integration
title: Runtime adapters and WebSockets
description: How platform adapters preserve the Fetch application boundary while translating events, bindings, responses, and WebSocket upgrades.
tags: [runtime, adapters, websocket, deployment]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-91d3173886899b1d372057c9
    resource: repo://src/adapter/bun/websocket.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# Runtime adapters and WebSockets

Hono's core boundary is `app.fetch(Request, bindings?, executionContext?)`. Adapters translate platform inputs into that boundary and translate the response back. They also supply capabilities that cannot be inferred from the Fetch request itself. [Request dispatch](../architecture/request-lifecycle.md) remains shared across runtimes.

## Fetch-native entry points

| Adapter or integration | Boundary behavior in this checkout |
| --- | --- |
| Cloudflare Pages `handle` | Passes the request, environment plus eventContext, and waitUntil/passThroughOnException execution methods |
| Vercel `handle` | Forwards the request to app.fetch |
| Netlify `handle` | Forwards the request with the platform context in bindings |
| Node runtime tests | Use the separate @hono/node-server package to create/serve an HTTP server |
| Bun and Deno | Supply runtime-specific asset, connection, and WebSocket helpers alongside the Fetch app |

Pages also exposes `handleMiddleware` to wrap a Hono middleware around Pages' `next()`. It captures Error instances in the context, converts HTTPException to a response, and rethrows other errors. This is a distinct execution path from a full Hono app's composer. Its asset helper delegates to `env.ASSETS.fetch` and invokes the application's not-found handler on a 404.

The `hono/adapter` environment helper chooses a source by runtime: process.env for Node/Bun/edge-light, Deno.env.toObject for Deno, and c.env for workerd. Fastly and unknown runtimes return an empty object. It does not merge all these sources. Runtime detection checks known user agents, EdgeRuntime/Fastly globals, then Node's process.release fallback.

## Lambda event translation

The AWS Lambda `handle(app)` adapter selects an event processor for ALB, API Gateway v2, Lattice v2, or the v1 fallback. Processors own event-specific path, method, query, headers, and cookie representations.

The common request builder reconstructs an HTTPS URL, decodes base64 event bodies when necessary, and sets Content-Length to the decoded byte count. Before entering the application, request conversion failures are logged and mapped to 400 for TypeError or 500 otherwise. Successful calls supply `event`, `requestContext`, and `lambdaContext` as bindings.

Response conversion buffers the body as text or base64 according to content type/content encoding, preserves status, and chooses ordinary or multi-value headers based on the event shape. Cookie extraction has its own processor seam. A custom `isContentTypeBinary` changes binary classification.

`streamHandle(app)` is separate: it uses the platform's `awslambda.streamifyResponse` and HttpResponseStream APIs, writes status/headers/cookies metadata, and copies the Fetch response stream to the writable response. It always ends the stream in finally. Its bindings use `context` for the Lambda context, unlike the buffered handler's `lambdaContext`. Streaming failures are handled in that adapter's own catch block.

## WebSocket ownership

The shared WebSocket helper provides event/context abstractions; each platform performs its own upgrade.

Bun's `upgradeWebSocket` gets the server from the Fetch environment argument (directly or under `server`) and throws if it is missing. It calls server.upgrade with event handlers, URL, and protocol data. The separately exported `websocket` callbacks translate Bun open/close/message events into the shared interface. Wire both the Fetch entrypoint and these server callbacks when integrating Bun; the older createBunWebSocket helper is deprecated.

Cloudflare uses WebSocketPair, attaches close/message/error listeners, accepts the server socket, and returns the client socket in a 101 response. Its helper intentionally omits onOpen. Deno calls Deno.upgradeWebSocket, uses the first requested subprotocol unless options override it, and attaches the four socket event callbacks.

These differences belong in adapter tests, not in core HTTP dispatch. Do not assume a normal in-process Response implementation can exercise a runtime-specific upgrade response.

## Where to verify changes

Use neighboring adapter tests for conversion and helper logic, then the corresponding runtime project for actual platform integration. Lambda and Lambda@Edge have separate runtime suites; Node tests explicitly cover only representative integration patterns because the server adapter is maintained separately. See [testing and build](../operations/testing-and-build.md) for commands and [static assets](../workflows/static-assets-and-generation.md) for filesystem and asset-service boundaries.
