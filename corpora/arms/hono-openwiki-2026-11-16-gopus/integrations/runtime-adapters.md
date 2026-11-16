---
type: integration
title: Runtime adapters
description: How Hono runs on Cloudflare Workers and Pages, Deno, Bun, AWS Lambda, Lambda@Edge, Vercel, Netlify and Service Workers — the per-runtime handle() wrappers, what each passes as env and execution context, the shared serveStatic core, getConnInfo, WebSocket upgrade via defineWebSocketHelper, and the env()/getRuntimeKey() adapter helper.
tags: [adapters, runtimes, cloudflare, deno, bun, aws-lambda, websocket, serve-static]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-2c8c4b178ced11e8101be44a
    resource: repo://src/adapter/bun/conninfo.ts
  - id: openwiki-source-b9a8387fef3591f80b327aa9
    resource: repo://src/adapter/bun/serve-static.ts
  - id: openwiki-source-a297b78d110b6653c37db7e1
    resource: repo://src/adapter/bun/server.ts
  - id: openwiki-source-91d3173886899b1d372057c9
    resource: repo://src/adapter/bun/websocket.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-8f07a0b8a762547156ba4abf
    resource: repo://src/adapter/cloudflare-workers/conninfo.ts
  - id: openwiki-source-753f402adff22861f1a61d5b
    resource: repo://src/adapter/cloudflare-workers/serve-static.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-25130f2ad6a932cb2997b2b2
    resource: repo://src/adapter/deno/conninfo.ts
  - id: openwiki-source-32c11363149a03db878ea874
    resource: repo://src/adapter/deno/serve-static.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-3b540c7cdbcadd6a68a916fb
    resource: repo://src/adapter/netlify/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-03c4da4354811c8a9dc29f6f
    resource: repo://src/adapter/service-worker/index.ts
  - id: openwiki-source-9a62de02f61d81368f630ab0
    resource: repo://src/adapter/vercel/handler.ts
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
  - id: openwiki-source-015f2dc60c9d3599ae2b42ec
    resource: repo://src/helper/websocket/index.ts
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Runtime adapters

The Hono core only speaks `fetch(Request, env, executionCtx) → Response` (see [Request lifecycle](../architecture/request-lifecycle.md)). Every runtime-specific piece lives in `src/adapter/<runtime>/`, and each adapter is published as `hono/<runtime>`. An adapter does one or more of the following:

1. converts a platform event into a `Request` and the result back into the platform's format (`handle`);
2. implements file access for the shared `serveStatic` core;
3. implements `getConnInfo(c)`;
4. implements `upgradeWebSocket` on top of `helper/websocket`;
5. supplies a filesystem module for SSG (`toSSG`).

Node.js is not handled in this repository. It uses the external `@hono/node-server` package, which is a dev dependency here for the Node tests.

## Handler adapters

| Adapter | Entry | What reaches `c.env` / `executionCtx` |
| --- | --- | --- |
| Cloudflare Workers | `export default app` (module worker) | The worker's `env` and `ctx`, passed directly to `app.fetch`. There is no `handle` wrapper. |
| Cloudflare Pages | `handle(app)` → `PagesFunction` | `env = { ...eventContext.env, eventContext }`. The ctx carries `waitUntil` and `passThroughOnException`. `handleMiddleware(mw)` runs one Hono middleware as Pages middleware, where `next()` calls `eventContext.next()`. In that mode a thrown `HTTPException` becomes its response, and any other error is re-thrown. |
| Vercel | `handle(app)` | Just `app.fetch(req)`. |
| Netlify | `handle(app)` | `env = { context }` (the Netlify context). |
| Service Worker | `handle(app, { fetch? })`, `fire(app)` | The `FetchEvent` is passed as the execution context. If the app returns 404 and `opts.fetch` exists (by default the bound global `fetch`), the request falls through to the network. |
| AWS Lambda | `handle(app, { isContentTypeBinary? })`, `streamHandle(app)` | `env = { event, requestContext, lambdaContext }`. |
| Lambda@Edge | `handle(app)` | `env = { event, context, callback, config, request, response }` from the CloudFront record. |
| Deno / Bun | `Deno.serve(app.fetch)` / `export default app` | Bun's second `fetch` argument is the server, which `getBunServer(c)` reads from `c.env` (or `c.env.server`). Deno's connection info arrives as `c.env.remoteAddr`. |

### AWS Lambda details (`src/adapter/aws-lambda/handler.ts`)

`getProcessor(event)` chooses an `EventProcessor` subclass:

- `ALBProcessor` when `requestContext.elb` exists;
- `EventV2Processor` (HTTP API or function URL) when the event has both `rawPath` and `requestContext.http`;
- `LatticeV2Processor` when `requestContext.serviceArn` exists;
- `EventV1Processor` (REST API) otherwise.

Each processor builds the `Request` (decoding base64 bodies and multi-value headers) and shapes the result.

- If building the request fails, the handler returns 400 for a `TypeError` and 500 for anything else, without calling the app.
- A response body is base64-encoded when `isContentTypeBinary(contentType)` is true, or when `Content-Encoding` is set to anything other than `identity`. The default treats everything except `text/{plain,html,css,javascript,csv}`, `*/json`, `*+json`, `*/xml` and `*+xml` as binary.
- `streamHandle` uses `awslambda.streamifyResponse` and `HttpResponseStream.from` for response streaming.

Lambda@Edge applies the same base64 rule. If the app calls the provided `callback` (for example to pass the request through to the origin), the first callback result or error wins over the returned `Response`.

## `serveStatic`: shared core plus per-runtime file access

`src/middleware/serve-static/index.ts` holds the runtime-neutral algorithm. Adapters inject `getContent(path, c)`, and optionally `join` and `isDir`:

1. If `c.finalized` is already true, it calls `next()` and does nothing else.
2. The file path is `options.path` if given. Otherwise it is the decoded request path, run through `rewriteRequestPath` and joined under `root` (default `./`). Paths containing `.` or `..` segments, repeated slashes or backslashes are rejected: `onNotFound` is called, then `next()`.
3. A directory gets `index.html` appended.
4. `getContent` may return a `Response`, which is passed through, or `Data`. `Content-Type` comes from `getMimeType`, honouring custom `mimes`, and falls back to `application/octet-stream`.
5. With `precompressed: true`, for compressible types, it looks for sibling files in the order `br` (`.br`), `zstd` (`.zst`), `gzip` (`.gz`), limited to encodings in `Accept-Encoding`. On a match it sets `Content-Encoding` and appends `Vary: Accept-Encoding`.
6. If nothing is found, it calls `onNotFound` and then `next()`, so later routes can still respond.

Per-runtime variants:

- Bun uses `Bun.file`, with `node:fs` `stat` for `isDir`.
- Deno uses `Deno.open` and `Deno.lstatSync`.
- Cloudflare Workers reads Workers Sites KV (`__STATIC_CONTENT` plus a manifest). That variant is marked deprecated.
- Cloudflare Pages delegates to `env.ASSETS.fetch`.

## Connection info (`hono/conninfo`)

`src/helper/conninfo/types.ts` defines `ConnInfo { remote: { address?, port?, transport?, addressType? } }` and `GetConnInfo = (c) => ConnInfo`. Each adapter exports its own `getConnInfo`:

- Workers reads the `cf-connecting-ip` header.
- Deno reads `c.env.remoteAddr`.
- Bun calls `server.requestIP(c.req.raw)`, and throws if that is unavailable.
- Lambda, Vercel and the others read the platform event or headers.

The [ip-restriction middleware](../middleware/security-middleware.md) takes a `GetConnInfo` function, so it works on any runtime.

## WebSockets (`hono/ws` + adapters)

`src/helper/websocket/index.ts` defines the runtime-neutral surface:

- `WSEvents { onOpen, onMessage, onClose, onError }`;
- `WSContext`, a wrapper with `send`, `close`, `readyState`, `url`, `protocol` and `raw`;
- `defineWebSocketHelper(handler)`.

`defineWebSocketHelper` produces an `upgradeWebSocket` usable in two forms:

- as middleware, `upgradeWebSocket((c) => events, options)`. If the handler returns no response (no upgrade happened), it calls `next()`;
- called directly, `upgradeWebSocket(c, events, options)`, which throws `Failed to upgrade WebSocket` when there is no upgrade.

Adapters:

- **Cloudflare Workers**: returns `undefined` unless `Upgrade: websocket` is present. It creates a `WebSocketPair`, wires the close, message and error listeners, calls `server.accept()`, and returns `101` with `webSocket: client`. Workers emits no `open` event, so `onOpen` is not supported.
- **Bun**: calls `server.upgrade(req, { data: { events, url, protocol } })`. Event dispatch happens in the exported `websocket` handler object, which the app must pass to `Bun.serve({ fetch, websocket })`. `createBunWebSocket()` returns both pieces. It throws if `c.env` does not carry the server.
- **Deno**: uses `Deno.upgradeWebSocket`.

The RPC client's `$ws()` connects to these routes (see [Type system and RPC client](../concepts/types-and-rpc-client.md)).

## Runtime detection and env (`hono/adapter`)

`getRuntimeKey()` returns `'node' | 'deno' | 'bun' | 'workerd' | 'fastly' | 'edge-light' | 'other'`. It checks, in order:

1. a `navigator.userAgent` prefix (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`);
2. `globalThis.EdgeRuntime`;
3. `globalThis.fastly`;
4. `process.release.name === 'node'`.

`env(c, runtime?)` returns the environment variables portably:

- `process.env` on Node, Bun and edge-light;
- `Deno.env.toObject()` on Deno;
- `c.env` on workerd;
- `{}` on Fastly and other runtimes.

## Tests

- Unit tests sit next to each adapter (`handler.test.ts`, `conninfo.test.ts`, `websocket.test.ts`).
- Real-runtime suites live in `runtime-tests/` (`deno`, `bun`, `workerd`, `fastly`, `lambda`, `lambda-edge`, `node`). See [Testing strategy](../testing/test-strategy.md).
