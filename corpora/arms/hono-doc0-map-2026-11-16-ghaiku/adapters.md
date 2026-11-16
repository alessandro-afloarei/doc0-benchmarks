---
title: "Runtime Adapters"
---
## Overview

The app itself only needs a `fetch` function, so an adapter is a thin layer that calls it with what the runtime provides. Some adapters export a single `handle` function, some export a server or helpers for one runtime, and each one is its own module under `src/adapter`. The adapter does not change routing or dispatch: [[Request Dispatch]] runs the same way behind every adapter.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8)

## Fetch-style runtimes

Vercel and Netlify take the function that the platform calls and pass the request to `app.fetch`. Vercel's `handle` returns a function of the request. Netlify's `handle` adds the platform's context as the bindings argument, which the app reads through `c.env`.

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/adapter/netlify/handler.ts:4-8](repo://src/adapter/netlify/handler.ts#L4-L8)

The service-worker adapter calls the app inside a `respondWith` on the fetch event. When the app answers 404 and the caller gave a `fetch` option, the request is sent to that fetch instead. The default option binds `globalThis.fetch`, so the fallback works without extra setup.

Sources: [src/adapter/service-worker/handler.ts:11-36](repo://src/adapter/service-worker/handler.ts#L11-L36)

Cloudflare Pages wraps the Pages function context into a request and calls `app.fetch` with it. It exports a `handleMiddleware` for Pages middleware and a `serveStatic` for the advanced mode the module comment describes.

Sources: [src/adapter/cloudflare-pages/handler.ts:32-48](repo://src/adapter/cloudflare-pages/handler.ts#L32-L48), [src/adapter/cloudflare-pages/handler.ts:110-114](repo://src/adapter/cloudflare-pages/handler.ts#L110-L114)

## Event-style runtimes

Lambda Edge's `handle` accepts a CloudFront event, converts it to a `Request`, and passes the event and context to `app.fetch` as bindings.

Sources: [src/adapter/lambda-edge/handler.ts:116-130](repo://src/adapter/lambda-edge/handler.ts#L116-L130)

The AWS Lambda adapter converts an API Gateway (v1 and v2), ALB or Function URL event into a `Request`, then calls `app.fetch`. Its module comment lists the event shapes it accepts. `streamHandle` is a second export of the same module.

Sources: [src/adapter/aws-lambda/handler.ts:198-215](repo://src/adapter/aws-lambda/handler.ts#L198-L215), [src/adapter/aws-lambda/handler.ts:138-160](repo://src/adapter/aws-lambda/handler.ts#L138-L160), [src/adapter/aws-lambda/index.ts:6-8](repo://src/adapter/aws-lambda/index.ts#L6-L8)

## Server runtimes

Bun, Deno and Cloudflare Workers export helpers rather than a `handle` function. Bun exports `serveStatic`, `toSSG`, WebSocket helpers, `getConnInfo` and `getBunServer`. Deno exports `serveStatic`, `toSSG`, a file system module, `upgradeWebSocket` and `getConnInfo`. Cloudflare Workers exports `serveStatic`, `upgradeWebSocket` and `getConnInfo`. Each module is listed by its own `@module` comment.

Sources: [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/deno/index.ts:1-9](repo://src/adapter/deno/index.ts#L1-L9), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8)

The Bun static file helper supplies the `getContent` function that the shared `serveStatic` middleware needs. It reads each file with `Bun.file`, so the middleware in [[Built-in Middleware]] stays runtime-neutral. `getBunServer` returns `c.env.server` when the bindings hold one, and the bindings object otherwise.

Sources: [src/adapter/bun/serve-static.ts:12-27](repo://src/adapter/bun/serve-static.ts#L12-L27), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

## Choosing an adapter

Pick the adapter that matches the platform's entry point: the adapter for the runtime whose function signature the platform calls. Helpers such as `serveStatic`, `toSSG` and `upgradeWebSocket` depend on the runtime, so they come from its adapter and not from the core package. [[Static Site Generation]] explains how `toSSG` uses a file system module, and [[Helper Catalogue]] lists the runtime-neutral helpers.

Sources: [src/adapter/bun/index.ts:6-7](repo://src/adapter/bun/index.ts#L6-L7), [src/adapter/deno/index.ts:6-7](repo://src/adapter/deno/index.ts#L6-L7), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2)
