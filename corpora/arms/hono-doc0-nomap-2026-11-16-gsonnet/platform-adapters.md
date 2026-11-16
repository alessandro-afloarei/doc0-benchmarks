---
title: "Platform Adapters and Connection Info"
---
## Overview

An app's only entry point is `app.fetch(request, env, executionCtx)`. Runtimes that already speak `Request` and `Response` (Bun, Deno, Cloudflare Workers modules) can use it directly. Others deliver a different event shape, so `src/adapter/<platform>` holds a `handle(app)` function that converts the platform event into a `Request`, passes platform objects in as `env`, and converts the `Response` back. Each adapter folder also has a `getConnInfo` that reads the client address from wherever that platform puts it.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/index.ts:1-6](repo://src/adapter/netlify/index.ts#L1-L6)

| Platform | Export | What it passes to `fetch` as `env` |
| --- | --- | --- |
| Vercel | `handle(app)` | nothing; calls `app.fetch(req)` |
| Netlify | `handle(app)` | `{ context }` |
| Cloudflare Pages | `handle(app)`, `handleMiddleware` | the Pages `env` plus `eventContext` |
| AWS Lambda | `handle(app)`, `streamHandle(app)` | `{ event, requestContext, lambdaContext }` (`context` when streaming) |
| Lambda@Edge | `handle(app)` | `{ event, context, callback, config, request, response }` |
| Service worker | `handle(app)`, `fire(app)` | `{}`, with the `FetchEvent` as execution context |

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/cloudflare-pages/handler.ts:32-47](repo://src/adapter/cloudflare-pages/handler.ts#L32-L47), [src/adapter/aws-lambda/handler.ts:239-275](repo://src/adapter/aws-lambda/handler.ts#L239-L275), [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147), [src/adapter/service-worker/handler.ts:18-37](repo://src/adapter/service-worker/handler.ts#L18-L37)

Whatever an adapter passes as `env` is what handlers see in `c.env`, which is why connection-info functions and middleware read platform data from it. See [[Context and Responses]].

Sources: [src/context.ts:352-361](repo://src/context.ts#L352-L361)

## Vercel and Netlify

Vercel's `handle` is `(req) => app.fetch(req)`. Netlify's is `(req, context) => app.fetch(req, { context })`, so the Netlify context is available as `c.env.context`.

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10)

## Cloudflare Pages

`handle(app)` returns a Pages function. It calls `app.fetch` with `{ ...eventContext.env, eventContext }` as env and an execution context made of `waitUntil`, `passThroughOnException` and empty `props`.

Sources: [src/adapter/cloudflare-pages/handler.ts:32-47](repo://src/adapter/cloudflare-pages/handler.ts#L32-L47)

`handleMiddleware(middleware)` wraps one Hono middleware as a Pages Functions middleware. It builds a `Context` itself, and the `next` it gives the middleware is `executionCtx.next()`, with its response stored in `context.res`. A response returned by the middleware wins; an `HTTPException` becomes its `getResponse()`; any other error is rethrown; otherwise `context.res` is returned. The module's `serveStatic` is a middleware that asks `env.ASSETS.fetch` and returns `c.notFound()` for a 404.

Sources: [src/adapter/cloudflare-pages/handler.ts:49-102](repo://src/adapter/cloudflare-pages/handler.ts#L49-L102), [src/adapter/cloudflare-pages/handler.ts:114-123](repo://src/adapter/cloudflare-pages/handler.ts#L114-L123)

## Service workers

The service-worker `handle(app, { fetch })` returns an event listener. It calls `app.fetch(evt.request, {}, evt)`, so `c.event` works, and when the response is a 404 and an `opts.fetch` exists (by default `globalThis.fetch` bound to `globalThis`) it forwards the original request to that function instead. `fire(app)` registers the listener with `addEventListener('fetch', ...)`; it replaces the deprecated `app.fire()`.

Sources: [src/adapter/service-worker/handler.ts:10-37](repo://src/adapter/service-worker/handler.ts#L10-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

## AWS Lambda

`handle(app, { isContentTypeBinary })` returns an async handler. It chooses an `EventProcessor` for the event, builds a `Request`, calls `app.fetch` with `{ event, requestContext, lambdaContext }` as env, and builds the Lambda result. A `TypeError` while building the request gives a 400 `Invalid request`; any other failure gives a 500.

Sources: [src/adapter/aws-lambda/handler.ts:239-275](repo://src/adapter/aws-lambda/handler.ts#L239-L275)

`getProcessor` looks at the event: a request context with `elb` is an Application Load Balancer event; a `rawPath` together with `requestContext.http` is API Gateway v2 (HTTP API or function URL); a context with `serviceArn` is VPC Lattice v2; anything else is API Gateway v1. `EventProcessor` is the abstract base: its `createRequest` builds `https://<domain><path>?<query>`, takes the domain from `requestContext.domainName` or the `host` header, and decodes a base64 body when `isBase64Encoded`. Subclasses supply `getPath`, `getMethod`, `getQueryString`, `getHeaders` and cookie handling.

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658), [src/adapter/aws-lambda/handler.ts:278-343](repo://src/adapter/aws-lambda/handler.ts#L278-L343)

`createResult` turns the `Response` into the event's result shape. The body is base64-encoded when `isContentTypeBinary` (default: anything except common text, JSON and XML types) says so or the response has a non-identity `Content-Encoding`; otherwise it is the text. Cookies go where the event format expects: V2 uses a `cookies` array, V1 uses `multiValueHeaders['set-cookie']`, and the ALB processor uses `multiValueHeaders` when enabled and otherwise only the first cookie in `headers`.

Sources: [src/adapter/aws-lambda/handler.ts:344-402](repo://src/adapter/aws-lambda/handler.ts#L344-L402), [src/adapter/aws-lambda/handler.ts:666-674](repo://src/adapter/aws-lambda/handler.ts#L666-L674), [src/adapter/aws-lambda/handler.ts:494-498](repo://src/adapter/aws-lambda/handler.ts#L494-L498), [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579)

The processors differ in query handling too: V1 re-encodes decoded query parameters (preferring `multiValueQueryStringParameters`), while the ALB processor reads query parameters without re-encoding. Non-ASCII header values are percent-encoded by `sanitizeHeaderValue`.

Sources: [src/adapter/aws-lambda/handler.ts:452-492](repo://src/adapter/aws-lambda/handler.ts#L452-L492), [src/adapter/aws-lambda/handler.ts:534-558](repo://src/adapter/aws-lambda/handler.ts#L534-L558), [src/adapter/aws-lambda/handler.ts:18-28](repo://src/adapter/aws-lambda/handler.ts#L18-L28)

`streamHandle(app)` wraps the handler with `awslambda.streamifyResponse`. It builds the request with the same processor, calls `app.fetch` with `{ event, requestContext, context }`, collects headers and `set-cookie` values, creates an `HttpResponseStream` with that metadata, and copies the body reader into the response stream. Errors are logged and answered with `Internal Server Error`.

Sources: [src/adapter/aws-lambda/handler.ts:138-200](repo://src/adapter/aws-lambda/handler.ts#L138-L200)

## Lambda@Edge

The CloudFront event nests the request in `Records[0].cf.request`. `createRequest` builds the URL from the `host` header (or the distribution domain), `uri` and `querystring`, flattens the CloudFront header lists, and decodes a base64 body. `handle` passes `event`, `context`, a wrapped `callback`, and the `config`, `request` and `response` objects as env. If the app called the callback with an error, it is thrown; if it called it with a result, that result is returned; otherwise `createResult` converts the `Response` into `{ status, headers, body }` with `bodyEncoding: 'base64'` for binary types or non-identity encodings.

Sources: [src/adapter/lambda-edge/handler.ts:105-147](repo://src/adapter/lambda-edge/handler.ts#L105-L147), [src/adapter/lambda-edge/handler.ts:149-212](repo://src/adapter/lambda-edge/handler.ts#L149-L212)

## Connection info

`getConnInfo` gives middleware a runtime-neutral way to learn who is calling. The shared types in `src/helper/conninfo/types.ts` define `ConnInfo` as `{ remote: NetAddrInfo }`, where the address, address type (`IPv4` or `IPv6`), port and transport are all optional, and `GetConnInfo` as `(c: Context) => ConnInfo`. IP restriction uses it; see [[Authentication and Security Middleware]].

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45)

Each adapter reads the address from a different place:

Sources: [src/helper/conninfo/types.ts:30-45](repo://src/helper/conninfo/types.ts#L30-L45)

| Adapter | Source of the address |
| --- | --- |
| Bun | `server.requestIP(c.req.raw)`; throws `TypeError` when the server was not passed as env or has no `requestIP` |
| Deno | `c.env.remoteAddr` (hostname, port, transport) |
| Cloudflare Workers and Pages | the `cf-connecting-ip` header |
| Vercel | the `x-real-ip` header |
| Netlify | `c.env.context.ip` |
| Lambda@Edge | the CloudFront request's `clientIp` |
| AWS Lambda | API Gateway v1 `identity.sourceIp`, v2 `http.sourceIp`, else the last entry of `x-forwarded-for` |

Sources: [src/adapter/bun/conninfo.ts:6-37](repo://src/adapter/bun/conninfo.ts#L6-L37), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/cloudflare-workers/conninfo.ts:3-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L3-L7), [src/adapter/cloudflare-pages/conninfo.ts:22-26](repo://src/adapter/cloudflare-pages/conninfo.ts#L22-L26), [src/adapter/vercel/conninfo.ts:3-8](repo://src/adapter/vercel/conninfo.ts#L3-L8), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57), [src/adapter/lambda-edge/conninfo.ts:11-15](repo://src/adapter/lambda-edge/conninfo.ts#L11-L15), [src/adapter/aws-lambda/conninfo.ts:45-73](repo://src/adapter/aws-lambda/conninfo.ts#L45-L73)

For Bun, the server object is found with `getBunServer`, which reads `c.env.server` when present, else treats `c.env` itself as the server, so passing either as the second argument of `fetch` works. The Bun WebSocket adapter uses the same function; see [[WebSocket Support]].

Sources: [src/adapter/bun/server.ts:1-4](repo://src/adapter/bun/server.ts#L1-L4), [src/adapter/bun/conninfo.ts:6-20](repo://src/adapter/bun/conninfo.ts#L6-L20)

## Detecting the runtime

`getRuntimeKey()` returns `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It first compares `navigator.userAgent` with known prefixes (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then checks for `EdgeRuntime`, then a `fastly` global, then `process.release.name`.

Sources: [src/helper/adapter/index.ts:7-8](repo://src/helper/adapter/index.ts#L7-L8), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

`env(c)` returns environment variables for the runtime: `process.env` on Node, Bun and the edge runtime, `Deno.env.toObject()` on Deno, `c.env` on Cloudflare Workers, and `{}` for Fastly and unknown runtimes.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)
