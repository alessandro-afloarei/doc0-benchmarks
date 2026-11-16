---
title: "Runtime Adapters"
---
## Overview

The core app only speaks `fetch(request, env, executionCtx)` (see [[Application and Request Dispatch]]), so each hosting platform needs a thin adapter that translates its own event into a `Request`, calls `app.fetch` and translates the `Response` back. The adapters under `src/adapter` do that, and also supply the pieces that depend on the platform: reading static files, finding the client's address and upgrading WebSockets. Each adapter is a separate subpath import such as `hono/aws-lambda` or `hono/bun`, so an app only loads the code for its platform.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8)

| Adapter | Entry points | What it provides |
| --- | --- | --- |
| `aws-lambda` | `handle`, `streamHandle`, `defaultIsContentTypeBinary`, `getConnInfo` | Lambda handler for API Gateway v1 and v2, ALB, Lambda Function URLs and VPC Lattice |
| `lambda-edge` | `handle`, `getConnInfo` | Lambda@Edge handler for CloudFront events |
| `cloudflare-pages` | `handle`, `handleMiddleware`, `serveStatic`, `getConnInfo` | Pages Functions |
| `cloudflare-workers` | `serveStatic`, `upgradeWebSocket`, `getConnInfo` | KV-asset static files and WebSockets |
| `bun` | `serveStatic`, `toSSG`, `upgradeWebSocket`, `websocket`, `createBunWebSocket`, `getBunServer`, `getConnInfo` | Static files, SSG file system, WebSockets |
| `deno` | `serveStatic`, `toSSG`, `upgradeWebSocket`, `getConnInfo` | Same for Deno |
| `vercel` | `handle`, `getConnInfo` | A function from a `Request` |
| `netlify` | `handle`, `getConnInfo` | Netlify Functions handler |
| `service-worker` | `handle`, `fire` | Service Worker fetch listener |

Sources: [src/adapter/aws-lambda/index.ts:6-9](repo://src/adapter/aws-lambda/index.ts#L6-L9), [src/adapter/lambda-edge/index.ts:6-7](repo://src/adapter/lambda-edge/index.ts#L6-L7), [src/adapter/cloudflare-pages/index.ts:6-8](repo://src/adapter/cloudflare-pages/index.ts#L6-L8), [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/vercel/index.ts:6-7](repo://src/adapter/vercel/index.ts#L6-L7), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2), [src/adapter/service-worker/index.ts:36](repo://src/adapter/service-worker/index.ts#L36)

## Handlers

### Vercel, Netlify and Service Worker

The simplest adapters add almost nothing. Vercel's `handle(app)` returns `(req) => app.fetch(req)`. Netlify's passes the platform `context` in the environment as `{ context }`, so handlers read it from `c.env.context`. The Service Worker `handle(app, opts)` returns a fetch-event listener that calls `app.fetch(evt.request, {}, evt)` inside `evt.respondWith`, and when the app answers 404 and `opts.fetch` is set (it defaults to the global `fetch` bound to `globalThis`) the original request is sent on to the network. `fire(app)` registers that listener with `addEventListener('fetch', ...)`.

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10), [src/adapter/service-worker/handler.ts:10-37](repo://src/adapter/service-worker/handler.ts#L10-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

### AWS Lambda

`handle(app, { isContentTypeBinary })` returns an async Lambda handler. It picks an event processor with `getProcessor`: ALB if the request context has `elb`, v2 (HTTP API and function URLs) if the event has `rawPath` and an `http` request context, VPC Lattice if the context has `serviceArn`, and v1 otherwise. The processor builds the `Request`; the app is called with `{ event, requestContext, lambdaContext }` as its environment; and the processor converts the `Response` back into the shape of that event. Errors while building the request produce a 400 for a `TypeError` and a 500 otherwise.

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/aws-lambda/handler.ts:625-664](repo://src/adapter/aws-lambda/handler.ts#L625-L664)

Binary bodies are base64-encoded. `defaultIsContentTypeBinary` treats everything as binary except `text/plain`, `html`, `css`, `javascript`, `csv`, and JSON or XML types, and a content encoding other than `identity` is also binary; the `isContentTypeBinary` option replaces the content-type rule.

Sources: [src/adapter/aws-lambda/handler.ts:666-674](repo://src/adapter/aws-lambda/handler.ts#L666-L674)

`streamHandle(app)` wraps the same flow in `awslambda.streamifyResponse` for response streaming. It sends status, headers and cookies as stream metadata (collecting each `set-cookie` separately), then pipes the response body to the Lambda stream, answering `Internal Server Error` if anything throws, and always ends the stream.

Sources: [src/adapter/aws-lambda/handler.ts:138-200](repo://src/adapter/aws-lambda/handler.ts#L138-L200)

### Lambda@Edge

`handle(app)` converts the CloudFront event into a `Request` (`https://<host><uri>` plus the query string, with header arrays flattened and the body decoded), runs the app with the event, context, callback, config, request and response in the environment, and converts the result into a CloudFront result with `status`, `headers` and a body that is base64-encoded when binary. If a handler calls the Lambda `callback`, its error or result takes precedence over the response.

Sources: [src/adapter/lambda-edge/handler.ts:116-197](repo://src/adapter/lambda-edge/handler.ts#L116-L197)

### Cloudflare Pages

`handle(app)` returns a Pages Function that calls `app.fetch` with the request, an environment of `{ ...eventContext.env, eventContext }` and an execution context built from the event's `waitUntil` and `passThroughOnException`. `handleMiddleware(middleware)` turns a Hono middleware into a Pages middleware: it builds a `Context`, treats `eventContext.next()` as the downstream, and either returns the middleware's response, or turns an `HTTPException` into its response, rethrows other errors, or returns `context.res`. Its `serveStatic()` forwards the request to the `ASSETS` binding and maps a 404 to `c.notFound()`.

Sources: [src/adapter/cloudflare-pages/handler.ts:32-123](repo://src/adapter/cloudflare-pages/handler.ts#L32-L123)

## Static file serving

The generic `serveStatic` in `src/middleware/serve-static` does the request logic and leaves file access to a `getContent(path, c)` function supplied by each adapter, so one implementation serves every runtime. It skips work when the response is already set, takes the file name from `options.path` or the decoded request path (a path with `.` or `..` segments, repeated slashes or backslashes counts as not found), joins it to `root` (default `./`, after an optional `rewriteRequestPath`), and appends `index.html` when `isDir` says the path is a directory.

Sources: [src/middleware/serve-static/index.ts:35-83](repo://src/middleware/serve-static/index.ts#L35-L83), [src/middleware/serve-static/path.ts:5-25](repo://src/middleware/serve-static/path.ts#L5-L25)

If `getContent` returns a `Response` it is used as is. Otherwise content sets `Content-Type` from the MIME table (with `mimes` overrides, falling back to `application/octet-stream`). With `precompressed`, and for compressible types, the middleware tries `.br`, `.zst` and `.gz` variants in that order for each encoding in `Accept-Encoding`, and sets `Content-Encoding` and `Vary` when one exists. Then `onFound` runs and `c.body(content)` is returned. If nothing was found, `onNotFound` runs and `next()` continues, so a later route can answer.

Sources: [src/middleware/serve-static/index.ts:23-28](repo://src/middleware/serve-static/index.ts#L23-L28), [src/middleware/serve-static/index.ts:85-125](repo://src/middleware/serve-static/index.ts#L85-L125)

| Adapter | How it reads files |
| --- | --- |
| `bun` | `Bun.file(path)` when it exists; directories checked with `stat` |
| `deno` | `Deno.open(path).readable`, null for directories and missing files (other errors are logged) |
| `cloudflare-workers` | KV static assets: the path is looked up in the asset manifest (`options.manifest` or the global `__STATIC_CONTENT_MANIFEST`) and the key is read as a stream from the namespace (`options.namespace`, `c.env.__STATIC_CONTENT`, or the global `__STATIC_CONTENT`) |
| `cloudflare-pages` | The `ASSETS` binding |

Sources: [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32), [src/adapter/deno/serve-static.ts:8-42](repo://src/adapter/deno/serve-static.ts#L8-L42), [src/adapter/cloudflare-workers/serve-static.ts:21-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L21-L42), [src/adapter/cloudflare-workers/utils.ts:11-50](repo://src/adapter/cloudflare-workers/utils.ts#L11-L50), [src/adapter/cloudflare-pages/handler.ts:114-123](repo://src/adapter/cloudflare-pages/handler.ts#L114-L123)

## WebSockets and connection info

Each adapter builds `upgradeWebSocket` with `defineWebSocketHelper` from [[Helpers Catalogue]] and wraps the platform socket in a `WSContext`:

Sources: [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)

- **Bun**: `upgradeWebSocket` gets the server from `getBunServer` (the second argument of `fetch`, or `c.env.server`), calls `server.upgrade` with the events, URL and first requested subprotocol as socket data, and returns an empty response when the upgrade works. The `websocket` object that must be given to `Bun.serve` dispatches open, close and message events to those stored events.
- **Deno**: if the `Upgrade` header is `websocket`, it calls `Deno.upgradeWebSocket`, echoing the requested subprotocol, and wires the four events.
- **Cloudflare Workers**: creates a `WebSocketPair`, wires close, message and error (it has no open event), accepts the server side and returns a 101 response with the client side.

Sources: [src/adapter/bun/websocket.ts:33-113](repo://src/adapter/bun/websocket.ts#L33-L113), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14), [src/adapter/deno/websocket.ts:1-38](repo://src/adapter/deno/websocket.ts#L1-L38), [src/adapter/cloudflare-workers/websocket.ts:1-53](repo://src/adapter/cloudflare-workers/websocket.ts#L1-L53)

Every adapter except `service-worker` also exports `getConnInfo`, a `GetConnInfo` function reading the client address from the platform's own object (for Bun, `server.requestIP(c.req.raw)`; it throws `env has to include the 2nd argument of fetch.` when the server is missing). These are what `ipRestriction` in [[Built-in Middleware Catalogue]] consumes. Bun and Deno also export the `toSSG` described in [[Static Site Generation]].

Sources: [src/adapter/bun/conninfo.ts:9-43](repo://src/adapter/bun/conninfo.ts#L9-L43), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9)
