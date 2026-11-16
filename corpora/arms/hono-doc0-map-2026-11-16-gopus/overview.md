---
title: "Hono Overview"
---
## Overview

Hono is a small web framework built on Web Standards. An application is a `Hono` object that maps HTTP methods and paths to handlers. It takes a standard `Request` and answers a standard `Response`, so the same app code runs on Cloudflare Workers, Fastly Compute, Deno, Bun, Vercel, AWS Lambda, Lambda@Edge and Node.js. The package has no runtime dependencies: `package.json` lists only `devDependencies`.

Sources: [README.md:24-35](repo://README.md#L24-L35), [package.json:668-696](repo://package.json#L668-L696)

The main entry point, `hono`, exports the `Hono` class, the `Context` class and the core types (`Env`, `Handler`, `MiddlewareHandler`, `Schema`, `TypedResponse`, …). Each other feature has its own subpath export, such as `hono/cors`, `hono/jsx`, `hono/client` or `hono/cloudflare-workers`, so an app only bundles the parts it imports.

Sources: [src/index.ts:17-53](repo://src/index.ts#L17-L53), [package.json:38-60](repo://package.json#L38-L60), [package.json:344-415](repo://package.json#L344-L415)

## Parts of the framework

| Area | What it does | Page |
| --- | --- | --- |
| Application | Registers routes, groups sub-apps, mounts other frameworks, exposes `fetch` | [[Hono Application]] |
| Dispatch | Matches a request, builds the `Context`, runs the middleware chain, handles errors | [[Request Dispatch and Middleware]] |
| Context | The `c` object handlers receive: variables, headers, response builders, renderer | [[Context and Responses]] |
| Request | Params, query, headers, body parsing and validated data | [[HonoRequest]] |
| Routers | The `Router` contract, `SmartRouter` and the presets | [[Router Interface and Presets]] |
| RegExpRouter | Compiles every route into one regular expression | [[RegExpRouter]] |
| TrieRouter | Tree router that accepts every path pattern | [[TrieRouter]] |
| Validation | `validator()` middleware and `c.req.valid()` | [[Validator]] |
| Types | Env, path params and schemas carried in generics | [[Route Types and Schema]] |
| RPC client | `hc()` typed client and `testClient` | [[RPC Client]] |
| Auth middleware | Basic and bearer authentication | [[Authentication Middleware]] |
| JWT | Token signing and verification, `jwt` and `jwk` middleware | [[JWT and JWK]] |
| Security middleware | CORS, CSRF, secure headers, IP restriction | [[Security Middleware]] |
| Response middleware | Compression, ETag, caching, pretty JSON | [[Response Middleware]] |
| Request control | Body limit, method override, trailing slash, timeout, combine, context storage | [[Request Control Middleware]] |
| Observability | Logger, Server-Timing, request IDs | [[Logging, Timing and Request IDs]] |
| Negotiation | Accept header parsing and language detection | [[Content Negotiation]] |
| Static files | `serveStatic` and its runtime file readers | [[Serving Static Files]] |
| Cookies | Plain and signed cookies | [[Cookies]] |
| Streaming | `stream`, `streamText`, `streamSSE` | [[Streaming and Server-Sent Events]] |
| WebSockets | `upgradeWebSocket` per runtime | [[WebSockets]] |
| Factory | Typed middleware and handlers outside an app | [[Factory Helper]] |
| Introspection | Listing routes and reading the matched route | [[Route Introspection]] |
| Proxy | Forwarding a request to another origin | [[Proxy Helper]] |
| Runtime info | Runtime detection, env variables, connection info | [[Runtime and Connection Info]] |
| HTML and CSS | `html` template and CSS-in-JS | [[HTML and CSS Helpers]] |
| SSG | Writing an app's routes to static files | [[Static Site Generation]] |
| JSX (server) | Rendering JSX to HTML strings | [[JSX Server Rendering]] |
| JSX streaming | `Suspense` and `renderToReadableStream` | [[Suspense and Streaming JSX]] |
| JSX renderer | Layouts as the Context renderer | [[JSX Renderer Middleware]] |
| Hooks | React-style hooks | [[JSX Hooks]] |
| DOM renderer | `hono/jsx/dom` client rendering | [[Client-Side DOM Rendering]] |
| DOM elements | Head hoisting, form actions, DOM CSS | [[DOM Elements, Forms and CSS]] |
| Lambda | AWS Lambda and Lambda@Edge events | [[AWS Lambda and Lambda@Edge]] |
| Adapters | Cloudflare, Bun, Deno, Netlify, Vercel, Service Worker | [[Runtime Adapters]] |
| Build | Build, export validation and test suites | [[Building and Testing Hono]] |

Sources: [src/index.ts:17-53](repo://src/index.ts#L17-L53), [package.json:344-415](repo://package.json#L344-L415)

## Main request flow

```mermaid
flowchart TD
  adapter["Runtime adapter or export default app"] --> fetch["app.fetch(request, env, executionCtx)"]
  fetch --> getPath["getPath(request)"]
  getPath --> match["router.match(method, path)"]
  match --> ctx["new Context(request, matchResult)"]
  ctx --> single{"One handler?"}
  single -->|yes| call["Call handler directly"]
  single -->|no| compose["compose(handlers, onError, notFound)"]
  compose --> call
  call --> res["Response"]
```

Sources: [src/hono-base.ts:406-485](repo://src/hono-base.ts#L406-L485), [src/compose.ts:15-73](repo://src/compose.ts#L15-L73)

1. A runtime hands the app a `Request`, either by calling the exported app's `fetch` directly or through an adapter's `handle()` that converts its own event first ([[Runtime Adapters]], [[AWS Lambda and Lambda@Edge]]).
2. `fetch` passes the request, the bindings and the execution context to the private `#dispatch` method ([[Hono Application]]).
3. `getPath` extracts the path from the URL, and `router.match` returns the handlers and middleware registered for that method and path ([[Router Interface and Presets]]).
4. A `Context` is created around the request and the match result; handlers read the request through `c.req` ([[Context and Responses]], [[HonoRequest]]).
5. With one matched handler the app calls it directly; otherwise `compose` chains every handler and middleware with `next()` ([[Request Dispatch and Middleware]]).
6. The handler returns a `Response`, built with helpers such as `c.json` or `c.html`, which the app returns to the runtime.

Sources: [src/hono-base.ts:406-485](repo://src/hono-base.ts#L406-L485)

## Design decisions

**Only Web Standard objects cross the boundary.** `fetch` has the signature `(request, Env?, executionCtx?) => Response | Promise<Response>`, the same shape Cloudflare Workers and Deno expect from a module's default export. Runtime-specific code lives in the adapters, which translate their own events into a `Request`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

**The router is pluggable, and presets pick one.** `HonoBase` has no router of its own; a comment says the class "is like an abstract class" and a subclass must set `router` in its constructor. The default `Hono` uses a `SmartRouter` over `RegExpRouter` and `TrieRouter`, unless `options.router` names another. `hono/quick` uses `LinearRouter` and `TrieRouter`, and `hono/tiny` uses `PatternRouter`. The README notes that the `hono/tiny` preset is under 12kB.

Sources: [src/hono-base.ts:114-118](repo://src/hono-base.ts#L114-L118), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:16-23](repo://src/preset/quick.ts#L16-L23), [src/preset/tiny.ts:16-19](repo://src/preset/tiny.ts#L16-L19), [README.md:39-41](repo://README.md#L39-L41)

**A route with one handler skips composition.** When the match result holds a single handler, `#dispatch` calls it without building a `compose` chain, and only falls back to the not-found handler when nothing is returned.

Sources: [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)

**Types travel in generics.** `Hono` has three type parameters: `E` (the `Env` with `Bindings` and `Variables`), `S` (the `Schema` of the routes registered so far) and `BasePath`. Each method returns a `Hono` with a widened schema, and `route()` merges a sub-app's schema under its path. The [[RPC Client]] reads that schema to type its calls ([[Route Types and Schema]]).

Sources: [src/hono.ts:16-20](repo://src/hono.ts#L16-L20), [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

**A router's result has two shapes.** `Router.match` answers either a list of handlers, each with a map from parameter name to an index, plus one array of captured values that all handlers share, or a list of handlers each with its own parameter object. Every router returns one of the two, and `HonoRequest` reads both ([[Router Interface and Presets]]).

Sources: [src/router.ts:29-103](repo://src/router.ts#L29-L103)
