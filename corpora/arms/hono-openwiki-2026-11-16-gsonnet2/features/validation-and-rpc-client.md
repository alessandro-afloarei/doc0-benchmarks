---
type: feature
title: "Validator, Typed Routes and the hc RPC Client"
description: How validator() parses and validates request targets and feeds typed input to handlers, how Env/Input/Schema generics make routes type-inferable, and how the hc Proxy client and testClient turn the app type into typed fetch calls.
tags: [validator, rpc, hc, client, types, typed-routes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Validator, Typed Routes and the `hc` RPC Client

Hono's "RPC" story is entirely type-level plus a small runtime proxy: handlers and validators contribute `Input`/`Schema` types to the app type, and `hc<typeof app>(baseUrl)` converts that type into a callable object that issues real `fetch` requests. No code generation or shared schema file is involved.

## `validator(target, fn)` (`src/validator/validator.ts`)

`validator` returns a `MiddlewareHandler`. For each request it extracts a raw value for the chosen **target**, calls the user's function, and either short-circuits or stores the result:

| Target | Raw value |
| --- | --- |
| `json` | `await c.req.json()` only if `Content-Type` matches a JSON regexp (`application/json`, `application/*+json`); otherwise `{}`. Parse failure throws `HTTPException(400, 'Malformed JSON in request body')` |
| `form` | parsed only for `multipart/form-data` or `application/x-www-form-urlencoded`; goes through `c.req.arrayBuffer()` and `bufferToFormData`, caches the `FormData` in `c.req.bodyCache.formData`, and throws 400 `Malformed FormData request.` on failure. Repeated keys and `key[]` names become arrays |
| `query` | `c.req.queries()` with single-element arrays unwrapped to strings |
| `param` | `c.req.param()` (decoded) |
| `header` | `c.req.header()` (lower-cased keys) |
| `cookie` | `getCookie(c)` |

If the validation function returns a `Response` (e.g. `c.json({error}, 400)`), it is returned immediately and `next()` is not called. Otherwise the value is saved with `c.req.addValidatedData(target, result)` and the chain continues; handlers read it with `c.req.valid(target)` ([Context and HonoRequest](../architecture/context-and-request.md)). Validator libraries (zod, valibot, etc.) integrate by wrapping this middleware; the function can be any sync/async transformer.

**Constraints encoded in types:** `GET`/`HEAD` routes cannot validate `json` or `form` (`ValidationTargetByMethod`), because those methods carry no body. Content-type mismatches don't fail validation by themselves: the validator sees `{}` and the user function decides.

## Type plumbing (`src/types.ts`, `src/validator/utils.ts`)

- `Env` (`Bindings`, `Variables`), `Input` (`in`, `out`, `outputFormat`) and `Schema` are the generic parameters threaded through `Hono<E, S, BasePath>` and `H`/`MiddlewareHandler`/`HandlerInterface`. The overloaded `HandlerInterface` (many arities, accumulating `I`, `I2`, ...) lets each chained validator extend the handler's `Input`, so `c.req.valid('json')` is typed.
- Each registered route adds an entry to `S` keyed by path and `$method`, containing `input` (from validators) and `output`/`outputFormat`/`status` (from the handler's `TypedResponse`, produced by `c.json()` etc.). `route()` merges sub-app schemas with `MergeSchemaPath`, which prefixes paths ([App Core](../architecture/app-core.md)).
- `InferInput` (validator/utils) derives the *client-side* input type from the validator *output* type, widening e.g. form values to `string | File | (string|File)[]` and query values to `string | string[]`, unless a literal union or optional type is detected.
- `ExtractValidationResponse` makes a validator that returns a `TypedResponse` contribute that response (e.g. a 400 error body) to the route's possible outputs.

## The `hc` client (`src/client/client.ts`)

`hc<AppType>(baseUrl, options?)` builds nested `Proxy` objects (`createProxy`). Property access appends path segments (the `then` key returns `undefined` so the proxy isn't treated as a thenable); calling the proxy invokes one central callback with `{path, args}`:

1. Path segments are joined; a final `$`-prefixed segment names the method (`$get`, `$post`, ...), special names `$url`, `$path` and `$ws`, and `toString`/`valueOf` shortcuts exist so the proxy can be stringified.
2. `$url()` / `$path()` return the resolved `URL` / path (substituting `param`, appending `query` via the configurable `buildSearchParams`; a trailing `index` segment is removed).
3. `$ws()` swaps `http`→`ws`, applies params and query, and constructs a `WebSocket` (customisable through `options.webSocket`). This is the consumer side of the server's `upgradeWebSocket` ([Helpers](helpers.md)).
4. HTTP methods create a `ClientRequestImpl` and call `fetch(args, options)`. It builds: query string, `FormData` for `form` (arrays appended repeatedly, `undefined` skipped), a JSON string plus `Content-Type: application/json` for `json`, path params via `replaceUrlParam` (handling optional `:id?` and regex constraints), headers, and a serialised `Cookie` header. Bodies are omitted for `GET`/`HEAD`. The final call is `(options.fetch || fetch)(url, { body, method, headers, ...options.init })`, passing a URL *string* for compatibility with test mocks.

**Option merging.** Per-call options (second argument) are deep-merged over the client-wide options; when both define `headers`, they are combined (functions are awaited, per-call keys win), which supports async token providers. `options.fetch` swaps the transport, which is how `testClient` works.

**Response helpers.** The response is a plain `Response` typed by `ClientResponse`. `parseResponse` (with `fetchRP`, adapted from `fetch-result-please`) returns the parsed JSON/text/blob by detected content type and throws `DetailedError` carrying status and body for non-OK responses. `InferRequestType` / `InferResponseType<T, Status?>` extract types from endpoints.

## `testClient`

`testClient(app, env?, executionCtx?, options?)` in `src/helper/testing` is `hc('http://localhost', { fetch: (input, init) => app.request(input, init, env, executionCtx) })`, so tests get end-to-end typing with no network ([Testing](../operations/testing.md)).

## Gotchas

- The RPC types only see routes in the app *type*: build the app via method chaining (or `route()` return values) and export `typeof app`; registering routes in separate statements loses them.
- Validation is only as strict as the user function; `c.req.valid()` is a type assertion over what the validator stored.
