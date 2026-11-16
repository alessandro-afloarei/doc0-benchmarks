---
type: concept
title: Type system and RPC client
description: How Hono's types.ts accumulates a route Schema from chained route definitions, validators and TypedResponse return values, and how the hc client in src/client turns `typeof app` into a typed fetch proxy with $get/$post, $url, $path and $ws helpers plus parseResponse.
tags: [types, typescript, rpc, client, hc, schema-inference]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-4e10f69834474e54fbf1a58f
    resource: repo://src/client/types.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Type system and RPC client

Hono's "RPC" feature is purely a type-level contract between server and client. At runtime the server registers ordinary routes, and the client issues ordinary `fetch` calls built from property access. The link between them is the `Schema` type parameter, which accumulates on `Hono<E, S, BasePath>` as routes are chained.

## Core generics (`src/types.ts`)

- **`Env`** is `{ Bindings?: object; Variables?: object }`. It types `c.env` and `c.get`/`c.set`/`c.var` (see [Context and HonoRequest](context-and-request.md)).
- **`Input`** is `{ in?, out?, outputFormat? }`. `in` is the client-side request shape and `out` is the validated server-side shape returned by `c.req.valid()`. [Validators](validation.md) contribute both.
- **`Schema`** is `{ [Path]: { [`$${method}`]: Endpoint } }`. **`Endpoint`** is `{ input, output, outputFormat, status }`.
- **`TypedResponse<T, Status, Format>`** is a phantom-typed marker attached to the return values of `c.json`, `c.text`, `c.body` and `c.redirect`. `c.json` returns `TypedResponse<JSONParsed<T>, ...>`, so the client type reflects what survives JSON serialization: dates become strings, functions are dropped, and so on.
- **`HandlerInterface`, `MiddlewareHandlerInterface`, `OnHandlerInterface`** are large overload sets (most of the ~2,800 lines of `types.ts`). Each typed handler and middleware arity has an overload. Every overload merges the handlers' `Input` and `Env` types, and adds a `ToSchema<Method, MergePath<BasePath, Path>, Input, Response>` entry to `S`.
- **`ToSchema`** maps the method to a `$`-prefixed lowercase key (`$get`). It adds path parameters to `input.param` via `AddParam`/`ParamKeys`. It extracts output, format and status from the handler's return type. Handlers that return `Promise<void>` (pure middleware) add nothing.
- **`MergePath` / `MergeSchemaPath`** are the type-level version of runtime `mergePath`. `app.route('/api', sub)` and `basePath()` use them to re-key a sub-app's schema under the prefix, and they add any `:params` in the prefix to each endpoint's `input.param`.
- **`ExtractSchema<typeof app>`** pulls the schema out of an app type.

Because the schema lives in the generic `S`, it survives only through **chained** calls (`const app = new Hono().get(...).post(...)`). Separate `app.get(...)` statements register routes at runtime but discard the returned type.

## The `hc` client (`src/client/client.ts`)

```ts
const client = hc<typeof app>('http://localhost:8787', { headers, fetch, init, buildSearchParams, webSocket })
const res = await client.api.posts[':id'].$get({ param: { id: '1' }, query: { q: 'x' } })
```

### Runtime mechanism

`hc` returns a recursive `Proxy` over a no-op function. Every property access appends a path segment. The `'then'` key and symbol keys return `undefined`, so the proxy is not mistaken for a thenable. Calling the proxy runs `proxyCallback` with the accumulated segments and the call arguments.

1. The calls `toString()`/`valueOf()`, and `.name.toString()`, are intercepted so the proxy can be printed.
2. If the last segment starts with `$`, it is removed and becomes the method name.
3. The remaining segments are joined with `/` and merged onto `baseUrl`.
4. Special methods:
   - `$url(args?)` returns a `URL` with params and query applied.
   - `$path(args?)` returns the path string relative to `baseUrl`.
   - `$ws(args?)` rewrites the protocol to `ws`/`wss` and opens a `WebSocket`, or calls `options.webSocket` if provided.
5. Any other method creates a `ClientRequestImpl` and calls its `fetch` with the arguments, after merging global and per-call options. Global and per-call headers are merged lazily; either may be a function or an async function.

`ClientRequestImpl.fetch(args, opt)` maps the validation targets onto the request:

| Arg | Effect |
| --- | --- |
| `query` | `buildSearchParams` (array values become repeated keys) and is appended as `?...` |
| `param` | `replaceUrlParam` substitutes `:name` segments (including `:name{regex}`) |
| `json` | Body is `JSON.stringify` output, and `Content-Type: application/json` is set |
| `form` | Builds a `FormData`. Arrays are appended per item, and `undefined` values are skipped |
| `header` | Merged into the request headers, then overridden by options headers |
| `cookie` | Each entry is serialized with `path=/`, and the entries are joined into the `Cookie` header |

The body is dropped for `GET` and `HEAD`. A trailing `/index` segment is removed (`removeIndexString`), because the type mapping turns a root path into the property `index`. The request is sent with `options.fetch`, or the global `fetch`, passing a URL string.

### Type mapping (`src/client/types.ts`)

`Client<T, Prefix>` infers `S` from `HonoBase<any, S, any>`. For each path key, `PathToChain` builds a nested object per segment, and the leaf (or `index` for `/`) is a `ClientRequest`. `ClientRequest` exposes `$get`, `$post` and so on (an `$all` route is expanded to every standard method), plus `$url`, `$path`, and `$ws` where applicable. Each method returns `Promise<ClientResponse<Output, Status, Format>>`. `ClientResponse.ok` is narrowed to `true` or `false` by status class. `json()` and `text()` are typed by format, so callers can discriminate on `res.ok` or `res.status`.

Exported helpers:

- `InferRequestType<typeof client.x.$post>`
- `InferResponseType<..., Status?>`
- `PickResponseByStatusCode`
- `ApplyGlobalResponse` (adds shared error response types to every endpoint)

### `parseResponse`

`parseResponse(client.x.$get())` (`src/client/utils.ts`, built on `fetch-result-please.ts`):

- It awaits the response and detects the body type from the content type. Bodies are not read for status codes 101, 204, 205 and 304.
- It throws `DetailedError` (carrying `statusCode` and `detail.data`) for responses that are not `ok`.
- It returns the parsed data, typed from the success-status responses only.

## Testing

- `src/types.test.ts` and `src/client/types.test.ts` are type-level tests using `expectTypeOf`. `tsc -p tsconfig.spec.json` runs as part of `bun run test`.
- `src/client/client.test.ts` exercises the runtime proxy against an MSW server.
- `perf-measures/type-check` measures how long the compiler takes on large generated route sets. This guards the cost of the overload-heavy types.

See [Testing strategy](../testing/test-strategy.md).
