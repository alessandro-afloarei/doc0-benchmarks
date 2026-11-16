---
type: concept
title: Type System and RPC Client
description: How Hono's Env and Schema generics accumulate typed route definitions as routes are registered, and how the hc client turns an app's type into a typed fetch proxy with URL building, request serialization, WebSocket support and response inference.
tags: [types, rpc, client, hc, schema, typescript]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-4e10f69834474e54fbf1a58f
    resource: repo://src/client/types.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Type System and RPC Client

Hono's "RPC" feature works without code generation. Route registration methods return a `Hono` instance whose `Schema` type parameter has grown by the new route. The `hc` client in `src/client` reads that type and exposes it as a property chain that issues ordinary `fetch` calls. The runtime part is small. Most of the work happens in the types (`src/types.ts` is about 2,800 lines).

## Generics on `Hono`

`HonoBase<E, S, BasePath, CurrentPath>`:

- **`E extends Env`**: `{ Bindings?: object; Variables?: object }`. `Bindings` types `c.env`, and `Variables` types `c.get`/`c.set`/`c.var` (see [Context and HonoRequest](../architecture/context-and-request.md)).
- **`S extends Schema`**: a map from path to `$method` to `Endpoint`, where `Endpoint = { input, output, outputFormat, status }`.
- **`BasePath`** / **`CurrentPath`**: string literals that track `basePath()` and the last registered path, so a chained `.post(handler)` with no path argument is typed against the right path.

## How a route becomes a schema entry

`HandlerInterface` (in `src/types.ts`) has overloads for up to about ten chained handlers. Each overload infers:

1. the path parameter names from the path literal (`ParamKeys`, `ExtractParams`), and adds them to `input.param`;
2. `Input` contributions from middleware. Validators declare `{ in, out }` per target, and these are intersected along the chain;
3. the handler's return type. `c.json()`, `c.text()`, `c.body()` and `c.redirect()` return `Response & TypedResponse<Data, Status, Format>`.

`ToSchema<M, P, I, R>` turns this into `{ [P]: { [$m]: { input, output, outputFormat, status } } }`. A handler that returns `Promise<void>`, the signature of pure middleware, adds **nothing** to the schema (`AddSchemaIfHasResponse`). A handler typed `any` produces an endpoint with an empty output.

Sub-apps combine through `route()`. Its return type is `MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>> | S`, which prefixes the sub-app's paths. To keep the inferred type you must **chain** registrations, or assign the result of each `app.route(...)`. Separate statements on an untyped `const app` drop the schema.

Supporting utilities live in `src/utils/types.ts`. `JSONParsed<T>` models what survives `JSON.stringify`: `Date` becomes `string`, functions are dropped, and so on. `Simplify` and `UnionToIntersection` keep the hover types readable.

## The `hc` client

`hc<typeof app>(baseUrl, options?)` (`src/client/client.ts`) returns a recursive `Proxy`:

- Property access collects path segments. `client.posts[':id']` builds the path `['posts', ':id']`. The `then` key returns `undefined`, so the proxy is not treated as a thenable.
- A call whose last segment starts with `$` is a terminal operation. `$get`, `$post`, etc. run the request with that method. `$url(args?)` returns a `URL`, `$path(args?)` returns the path string, and `$ws(args?)` opens a `WebSocket`. `$ws` swaps the protocol to `ws`/`wss` and accepts an `options.webSocket` factory.
- `index` maps to `/` (`removeIndexString`), so `client.index.$get()` targets the root.

`ClientRequestImpl.fetch(args, opt)` serialises the typed arguments:

| Arg | Encoding |
| --- | --- |
| `param` | Substituted into `:name` (optional `?` and regex `{...}` suffixes are handled by `replaceUrlParam`). An empty value removes the segment |
| `query` | `buildSearchParams` (repeated keys for arrays, `undefined` skipped). Can be overridden with `options.buildSearchParams` |
| `form` | `FormData` (arrays appended, `undefined` skipped) |
| `json` | `JSON.stringify` plus `Content-Type: application/json` |
| `header` | merged with `options.headers` (static or async function) |
| `cookie` | serialised with `utils/cookie` into a `Cookie` header |

No body is sent for `GET`/`HEAD`. The URL string is passed to `options.fetch` or the global `fetch` together with the method, headers and `options.init`. Passing a string rather than a `Request` keeps MSW and `node-fetch` mocks working. Per-call options are deep-merged over the client-level options. When both levels give headers, they are combined in an async function, with per-call headers winning.

Because `options.fetch` can be `app.request`, tests can call an app through `hc` without a network (see `src/helper/testing`).

## Inference helpers

Exported from `hono/client` and partly re-exported from `hono`:

- `InferRequestType<typeof client.posts.$post>` / `InferResponseType<..., Status>`: extract the argument and response data types.
- `ClientResponse<T, Status, Format>`: a typed `Response`. `json()` returns `T` narrowed by `status`/`ok`.
- `parseResponse(promise)`: wraps the fetched result (`fetch-result-please.ts`). It reads the body according to the content type, skips bodies for 101/204/205/304, and throws `DetailedError` for non-`ok` responses. Its return type keeps only the non-error status variants.
- `ApplyGlobalResponse<typeof app, Def>` adds responses that every endpoint may return, for example from `onError`. `PickResponseByStatusCode<typeof app, 200>` goes the other way: it keeps only the given status variants, which helps when errors are handled centrally by a custom fetch.
- `testClient(app, env?, executionCtx?)` (`hono/testing`) is `hc` with `fetch` bound to `app.request`. It calls the app in-process.

## Validation and the schema

`validator(target, fn)` from `hono/validator` is the main way to put types into `input`. The `in` side becomes the client's argument type, and the `out` side is what `c.req.valid(target)` returns. See [Validation](./validation.md).

## Tests

- `src/types.test.ts` (about 4k lines) and `src/hono.test.ts` contain `expectTypeOf` assertions about schema inference. `tsc -p tsconfig.spec.json` type-checks them as part of `npm test`.
- `src/client/client.test.ts` exercises the runtime proxy against MSW handlers. `src/client/types.test.ts` covers the client's type inference.
- `perf-measures/type-check` tracks how long type-checking a large app takes (see [Build, Packaging and Release](../operations/build-and-release.md)).
