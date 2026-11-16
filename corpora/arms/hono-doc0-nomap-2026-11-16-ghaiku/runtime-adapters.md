---
title: "Runtime Adapters"
---
## Overview

Each runtime calls an app in its own way. Some call `fetch` with a `Request`, some pass an event object that must be turned into a `Request`, and some need a `fetch` event listener. An adapter is the small module that does that translation for one runtime and exports what the runtime needs beyond the handler, such as `getConnInfo` or `upgradeWebSocket`. This page lists the adapter entry points, what each exports, and the helpers that find the runtime and the client address. The app code stays the same: [[Quickstart]] shows the default export that most adapters call.

Sources: [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8), [src/adapter/vercel/index.ts:1-3](repo://src/adapter/vercel/index.ts#L1-L3)

## Entry points

The table lists each adapter, the subpath it is imported from, and the functions it exports. The handler column names the function an application calls to get the runtime's entry function.

Sources: [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/service-worker/index.ts:1-19](repo://src/adapter/service-worker/index.ts#L1-L19)

| Adapter | Entry function | Other exports |
| --- | --- | --- |
| AWS Lambda | `handle(app)` returns a function of an API Gateway or ALB event | `streamHandle`, `getConnInfo` |
| Lambda@Edge | `handle(app)` returns a function of a CloudFront event | `getConnInfo` |
| Vercel | `handle(app)` returns a function of a `Request` | `getConnInfo` |
| Netlify | `handle(app)` returns a function of a `Request` and a context | `getConnInfo` |
| Cloudflare Pages | `handle(app)` returns a Pages function | `handleMiddleware`, `serveStatic`, `getConnInfo` |
| Cloudflare Workers | the app itself is the export | `serveStatic`, `upgradeWebSocket`, `getConnInfo` |
| Deno | the app itself is the export | `serveStatic`, `toSSG`, `upgradeWebSocket`, `getConnInfo` |
| Bun | the app itself is the export | `serveStatic`, `toSSG`, `upgradeWebSocket`, `websocket`, `getBunServer`, `getConnInfo` |
| Service worker | `handle(app, options)` returns a `fetch` event listener, and `fire(app)` registers it | none |

Sources: [src/adapter/aws-lambda/index.ts:1-14](repo://src/adapter/aws-lambda/index.ts#L1-L14), [src/adapter/lambda-edge/index.ts:1-10](repo://src/adapter/lambda-edge/index.ts#L1-L10), [src/adapter/vercel/index.ts:1-2](repo://src/adapter/vercel/index.ts#L1-L2), [src/adapter/netlify/index.ts:1-1](repo://src/adapter/netlify/index.ts#L1-L1), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2), [src/adapter/cloudflare-pages/index.ts:1-6](repo://src/adapter/cloudflare-pages/index.ts#L1-L6), [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/adapter/deno/index.ts:1-8](repo://src/adapter/deno/index.ts#L1-L8), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/service-worker/index.ts:1-19](repo://src/adapter/service-worker/index.ts#L1-L19)

The Vercel and Netlify handlers are the simplest. Each one returns a function that calls `app.fetch` with the request, and the Netlify version passes the context as the bindings.

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10)

The Cloudflare Pages handler passes the Pages environment as the bindings, along with the `waitUntil` and `passThroughOnException` functions as the execution context. The Lambda handler reads the event, builds a `Request` from it, and turns the response back into the Lambda result shape, with a separate path for binary content types.

Sources: [src/adapter/cloudflare-pages/handler.ts:32-45](repo://src/adapter/cloudflare-pages/handler.ts#L32-L45), [src/adapter/aws-lambda/handler.ts:239-262](repo://src/adapter/aws-lambda/handler.ts#L239-L262), [src/adapter/aws-lambda/handler.ts:666-674](repo://src/adapter/aws-lambda/handler.ts#L666-L674)

The service worker handler responds to a `fetch` event. It calls `app.fetch` with the event as its execution context, and if the app answers 404 and the `fetch` option is set, it asks that function for the response instead.

Sources: [src/adapter/service-worker/handler.ts:18-35](repo://src/adapter/service-worker/handler.ts#L18-L35)

## Finding the runtime

`getRuntimeKey` returns one of `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It first compares `navigator.userAgent` with the known user agents, then checks for the Edge runtime and Fastly globals, and last for `process.release.name`. `env(c, runtime)` reads the environment variables for the detected runtime: from `process.env` on Node, Bun and Edge, from `Deno.env` on Deno, and from the context bindings on Workers.

Sources: [src/helper/adapter/index.ts:8-9](repo://src/helper/adapter/index.ts#L8-L9), [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41), [src/helper/adapter/index.ts:50-84](repo://src/helper/adapter/index.ts#L50-L84)

## Client address

The `conninfo` helper types describe `getConnInfo`, which each adapter implements for its runtime. It returns the remote address and its type, which the IP restriction middleware reads. The Lambda version reads the request context of the event, and the Bun version reads the server object from the bindings.

Sources: [src/helper/conninfo/index.ts:6-6](repo://src/helper/conninfo/index.ts#L6-L6), [src/adapter/aws-lambda/conninfo.ts:1-8](repo://src/adapter/aws-lambda/conninfo.ts#L1-L8), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

`getBunServer` returns the server object from the bindings, which is the `server` field when present and the bindings object otherwise. The WebSocket upgrade needs this object, so the Bun adapter depends on it.

Sources: [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)
