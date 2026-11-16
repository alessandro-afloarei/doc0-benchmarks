---
title: "Runtime Adapters"
---
## Overview

Each folder in `src/adapter` connects the app to one runtime. The core modules do not import from `src/adapter`, so the app's `fetch` method is the only interface an adapter needs. An adapter does three things: it receives the runtime's event or request, turns it into a Web `Request` (or uses the runtime's `Request` directly), calls `app.fetch` with the bindings and execution context the runtime provides, and returns the `Response` in the runtime's own shape. Some adapters also export runtime-specific middleware and helpers. The app itself is described in [[Overview]] and the entry point in [[Request Dispatch]].

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

## Request-based adapters

Vercel and Netlify take the simplest form. Each `handle(app)` returns a function that takes a `Request` and calls `app.fetch`. Vercel passes only the request. Netlify passes the runtime's context object as the second argument to `fetch`, where handlers read it through the bindings.

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2)

Cloudflare Pages has a `handle` that passes the request and the event's environment to `fetch`, with `waitUntil` and `passThroughOnException` in the execution context. `handleMiddleware` wraps a Hono middleware so that it can run as a Pages function's middleware. `serveStatic` fetches the request from the `ASSETS` binding and answers with the not-found handler when the asset is missing.

Sources: [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46), [src/adapter/cloudflare-pages/handler.ts:49-58](repo://src/adapter/cloudflare-pages/handler.ts#L49-L58), [src/adapter/cloudflare-pages/handler.ts:114-123](repo://src/adapter/cloudflare-pages/handler.ts#L114-L123)

## Event-based adapters

AWS Lambda is the largest adapter. `handle(app)` returns a function that takes an API Gateway, ALB or VPC Lattice event and returns an object in the shape that the event type expects. `getProcessor` chooses one `EventProcessor` class for the event, and each class converts the path, headers, query string and body. `streamHandle` is the variant for streamed responses, and `defaultIsContentTypeBinary` decides which bodies are base64-encoded.

Sources: [src/adapter/aws-lambda/handler.ts:239-250](repo://src/adapter/aws-lambda/handler.ts#L239-L250), [src/adapter/aws-lambda/handler.ts:278-290](repo://src/adapter/aws-lambda/handler.ts#L278-L290), [src/adapter/aws-lambda/handler.ts:625-640](repo://src/adapter/aws-lambda/handler.ts#L625-L640), [src/adapter/aws-lambda/handler.ts:666-670](repo://src/adapter/aws-lambda/handler.ts#L666-L670)

Lambda@Edge works the same way with CloudFront events. Its `handle` takes the CloudFront request, converts it to a Web `Request`, and returns a CloudFront response; `createBody` and `isContentTypeBinary` decide how the body is carried back.

Sources: [src/adapter/lambda-edge/handler.ts:116-120](repo://src/adapter/lambda-edge/handler.ts#L116-L120), [src/adapter/lambda-edge/handler.ts:198-216](repo://src/adapter/lambda-edge/handler.ts#L198-L216)

## Worker and service-worker adapters

The service-worker adapter's `handle(app, opts)` returns a handler for the `fetch` event. It calls `event.respondWith` with `app.fetch`, and when the app answers `404` it falls back to the global `fetch` with the same request, so static files served by the platform still work. `fire(app)` registers that handler on the global scope.

Sources: [src/adapter/service-worker/handler.ts:18-35](repo://src/adapter/service-worker/handler.ts#L18-L35), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

Cloudflare Workers and the other Workers-style runtimes export `serveStatic`, `upgradeWebSocket` and `getConnInfo`. Cloudflare's `getConnInfo` reads the client address from the request. `serveStatic` reads files from the module bundle through the `serve-static-module` file.

Sources: [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/adapter/cloudflare-workers/conninfo.ts:3-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L3-L7)

## Server runtimes

Bun and Deno export the same set of helpers: `serveStatic` (`bun/serve-static.ts`, `deno/serve-static.ts`), `getConnInfo`, a WebSocket upgrade helper, and `toSSG` with a file system module for static site generation. Bun adds `getBunServer` to reach the server object from a handler and `createBunWebSocket` to create the WebSocket handler.

Sources: [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/bun/ssg.ts:13-25](repo://src/adapter/bun/ssg.ts#L13-L25), [src/adapter/deno/ssg.ts:9-25](repo://src/adapter/deno/ssg.ts#L9-L25)

## Choosing an adapter

Pick the adapter that matches the platform's entry point. A serverless platform that calls a function with an event needs its event-based adapter, and a platform that calls a `fetch` function needs the request-based one. A service worker or a Workers runtime with a `fetch` export uses the matching worker adapter. Bun and Deno apps that run their own server call `app.fetch` directly, and the adapter exists for their static files, sockets and SSG.

Sources: [src/adapter/aws-lambda/handler.ts:239-250](repo://src/adapter/aws-lambda/handler.ts#L239-L250), [src/adapter/service-worker/handler.ts:18-35](repo://src/adapter/service-worker/handler.ts#L18-L35), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11)
