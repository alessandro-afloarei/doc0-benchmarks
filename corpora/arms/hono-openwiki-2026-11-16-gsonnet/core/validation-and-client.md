---
type: component
title: Validator and Typed RPC Client
description: How the validator() middleware extracts and validates request data per target and stores it for c.req.valid(), and how route types (Schema, Input, TypedResponse) accumulate on the app type and are consumed by the Proxy-based hc() RPC client.
tags: [validator, client, hc, rpc, types]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
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
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Validator and Typed RPC Client

These two modules are connected by *types*, not runtime code: `validator()` contributes an input type to each route, route handlers contribute response types, `HandlerInterface` merges them into the app's `Schema`, and `hc<typeof app>()` (`src/client`) maps that schema to a callable proxy.

## `validator(target, fn)` (`src/validator/validator.ts`, public path `hono/validator`)

Returns a `MiddlewareHandler`. `target` is one of `ValidationTargets` (`json`, `form`, `query`, `param`, `header`, `cookie`). The type `ValidationTargetByMethod` forbids `json`/`form` for `get` and `head` routes. At request time it builds a raw `value` for the target:

| target | how `value` is produced |
| --- | --- |
| `json` | only if `Content-Type` matches the JSON regex (`application/json`, `application/*+json`, optional parameters); body is read via `c.req.json()`; a parse failure throws `HTTPException(400, 'Malformed JSON in request body')`. If the content type does not match, `value` stays `{}` |
| `form` | only for `multipart/form-data` or `application/x-www-form-urlencoded`; reuses `bodyCache.formData` or builds `FormData` via `bufferToFormData` (failure → `HTTPException(400, 'Malformed FormData request. …')`); repeated keys and keys ending in `[]` become arrays; the result object has a null prototype |
| `query` | `c.req.queries()` with single-element arrays unwrapped |
| `param` | `c.req.param()` |
| `header` | `c.req.header()` (lower-cased keys) |
| `cookie` | `getCookie(c)` |

It then awaits `validationFunc(value, c)`:
- if the result is a `Response`, it is returned immediately and `next` is **not** called (this is how schema validators such as `zod-validator` short-circuit with a 400);
- otherwise the result is stored with `c.req.addValidatedData(target, res)` and the chain continues. Downstream handlers read it with `c.req.valid(target)`. See [Context and HonoRequest](context-and-request.md).

The function is a generic-heavy factory: `ExtractValidatorOutput<VF>` strips Response types from the validation function's return to get the validated data type, and `ExtractValidationResponse<VF>` extracts typed responses (so a validator's error response appears in the client's inferred response union). The resulting `{ in, out }` pair is what ends up as the handler's `Input`. `src/validator/utils.ts` provides helper types (`InferInput`, form/JSON input mapping) used for the `in` side.

Because the validator reads the body through `HonoRequest` caches, the raw body can be safely re-read by later handlers, and `cloneRawRequest` can still rebuild the request.

## How types flow to the client

1. `HandlerInterface` overloads in `src/types.ts` (for `app.get/post/...`) infer each handler's response `R` (from `TypedResponse` returned by `c.json()` etc.) and input `I` (from validator middleware), and intersect the app's schema with `ToSchema<Method, Path, Input, Response>`. `ToSchema` produces `{ [path]: { $get: { input, output, outputFormat, status } } }` (methods are prefixed with `$`), falling back to loose `{}` output when the response type is `any`, and to nothing when it's `never`/`Promise<void>`.
2. `app.route()` and `basePath()` merge sub-app schemas with `MergeSchemaPath`, so nested routes appear under their prefixes.
3. `hc<typeof app>(baseUrl, options)` returns `UnionToIntersection<Client<T, Prefix>>` (`src/client/types.ts`), which maps schema keys to nested property access (`client.api.posts[':id'].$get(...)`). `InferRequestType` / `InferResponseType` (exported from `hono`) extract argument and response types of an endpoint.

## The runtime proxy (`src/client/client.ts`)

`hc` creates a `Proxy` around a no-op function (`createProxy(callback, path)`):
- property access appends a segment (`then` and non-string keys return `undefined` so proxies aren't treated as thenables);
- calling the proxy invokes `proxyCallback({ path, args })`.

`proxyCallback` interprets the last path segment:
- ends with `$<method>` (e.g. `$get`, `$post`): builds a `ClientRequestImpl` and calls `fetch(args[0], mergedOptions)`;
- `$url` / `$path`: return a `URL` / a path string with `param` and `query` applied (`replaceUrlParam`, `buildSearchParams`);
- `$ws`: builds a `ws://`/`wss://` URL (`replaceUrlProtocol`), appends query params and returns `new WebSocket(url)` (or `options.webSocket(...)` when supplied);
- `toString`/`valueOf` on `name` return the segment name, to keep the proxy debuggable.

`ClientRequestImpl.fetch(args, opt)` assembles the request:
- `query` → `buildSearchParams` (customisable via `options.buildSearchParams`; arrays are appended, `undefined` values skipped);
- `form` → `FormData` (arrays appended per item); `json` → `JSON.stringify` plus `Content-Type: application/json`;
- `param` → `replaceUrlParam` substitutes `/:name`, `/:name{regex}` and optional `?` segments (removing optional segments when the value is empty), and `removeIndexString` strips a trailing `/index`;
- `header` and `options.headers` (object or async function) are merged; `cookie` entries are serialized into a `Cookie` header;
- body is only set for non-GET/HEAD methods; the call goes to `opt.fetch ?? fetch` with the URL as a string (so MSW/node-fetch work) and `opt.init` spread last.
Global options and per-call options are combined with `deepMerge`; header functions are composed so both are awaited.

## `parseResponse` and `DetailedError`

`parseResponse(promiseOfResponse)` (`src/client/utils.ts`, backed by `fetch-result-please.ts`) reads the body by detected content type (skipping null-body statuses 101/204/205/304) and throws `DetailedError` with `statusCode` and `detail.data/statusText` for non-OK responses; its return type is narrowed to the success-status response variants.

## Extension seams
- Custom `fetch` (`options.fetch`), `init`, `headers`, `buildSearchParams`, `webSocket`.
- Any validator library works as long as the callback returns the validated data or a Response.
- Because the client is type-driven, anything that changes response types (custom `c.json` wrappers, middleware returning typed responses) alters the client types without runtime changes.
