---
type: concept
title: Typed RPC Client (hc)
description: How the hono/client module (hc) turns a server app's route types into a typed, proxy-based HTTP client - path building through a Proxy, request assembly from param, query, json, form, header and cookie inputs, URL and WebSocket helpers, response parsing with DetailedError, and the inference types that connect the client to the server app.
tags: [client, hc, rpc, typescript, proxy, fetch, type-inference]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Typed RPC Client (hc)

`hono/client` exports `hc`, a factory that returns a client object whose shape mirrors the routes declared on a Hono app. The client's type is derived from the app type rather than from a separate schema, so route paths, validated inputs, and typed responses flow from server to client through TypeScript generics. At runtime the client is a set of nested JavaScript `Proxy` objects that record the property path and turn the final call into an HTTP request. The sources are `src/client/client.ts`, `src/client/utils.ts`, `src/client/fetch-result-please.ts`, and `src/client/types.ts`.

## Building Paths With a Proxy

`hc(baseUrl, options?)` returns the result of `createProxy(proxyCallback, [])`. Each property access (`client.posts`, `.comments`) appends a segment to the path, and a call (`client.posts.$get(args)`) hands the accumulated path and arguments to `proxyCallback`. `createProxy` returns `undefined` for the `then` property, so an unawaited client object is not mistaken for a thenable.

Path handling inside `proxyCallback` works on the last few segments:

- A segment that starts with `$` names the HTTP method (`$get`, `$post`, and so on) and is removed from the path.
- `$url` and `$path` do not send a request. `$url` returns a `URL` object for the joined base URL and path, after `param` substitution and query serialization. `$path` returns only the path portion relative to the base URL.
- `$ws` opens a `WebSocket` connection. The protocol is changed from HTTP to WS, query parameters are appended, and the constructor can be replaced with `options.webSocket`.
- `toString` and `valueOf` return readable forms of the path so that the proxy can be logged or concatenated.
- Any other call creates a `ClientRequestImpl` for the joined URL and method and calls its `fetch`.

The base URL and the path are joined with `mergePath` (from `client/utils.ts`), so trailing slashes in the base do not duplicate separators. A trailing `/index` segment is removed from the URL by `removeIndexString`.

## Assembling a Request

`ClientRequestImpl.fetch(args?, opt?)` builds the request from the optional argument object:

- **`param`** values replace `:name` placeholders in the URL via `replaceUrlParam`.
- **`query`** is serialized by `buildSearchParams`, which emits repeated keys for array values. `options.buildSearchParams` can replace this serialization.
- **`json`** is `JSON.stringify`-ed and sets `Content-Type: application/json`.
- **`form`** is turned into `FormData`. Keys with `undefined` values are skipped, and arrays append one entry per element. The browser or runtime sets the multipart boundary.
- **`header`** and **`cookie`** are merged into the headers. Cookie values are serialized with `serialize` and joined into a single `Cookie` header.
- **`opt.headers`** may be an object or a function returning one, and `opt.init` is spread into the `fetch` init object last, so it can override the defaults. `opt.fetch` replaces the global `fetch`.

The method is upper-cased. Bodies are attached only for methods other than `GET` and `HEAD`, which means a `form` or `json` argument on a `GET` route is silently not sent. `hc`-level `options` are deep-merged with per-call options by `deepMerge`, and when both levels define headers, their header functions are combined into a single async function.

## Parsing Responses

The client returns the raw `Response` from `fetch`, and the helper `parseResponse` (exported from `hono/client`) converts it. `parseResponse` delegates to `fetchRP` in `fetch-result-please.ts`, a minimal adaptation of the `fetch-result-please` library:

- The body is read as JSON or text, chosen from the response's `content-type` header. Status codes `101`, `204`, `205`, and `304` are treated as having no body.
- The parsed value is stored and returned for successful responses.
- Non-`ok` responses throw a `DetailedError`, whose message is the status and status text and whose `statusCode` and `detail` (parsed body and status text) let callers branch on server errors.

The return type of `parseResponse` is computed from the client response type so that only successful, contentful status codes contribute to the resolved type; error statuses are filtered out.

## Type Inference

The client's type is `Client<T, Prefix>`, computed from the app's route table. Three utilities expose parts of that inference:

- **`InferRequestType<typeof client.posts.$post>`** yields the accepted input (`param`, `query`, `json`, and so on) for an endpoint, derived from the validator targets that the server declared.
- **`InferResponseType<typeof client.posts.$get>`** yields the union of typed responses, optionally narrowed by a status code argument.
- **`ClientRequestOptions`** types the second argument (headers, fetch override, init, and `webSocket` hook).

<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Route-level types depend on the server declaring its routes with the same `Hono` generics. For example, input schemas come from `validator` middleware (see [Validator and Typed Inputs](/openwiki/validation/validator.md)), and typed responses come from `c.json` and similar calls.

## Failure Behavior

- Network failures reject the promise from `fetch` and are not wrapped.
- HTTP error statuses reject with `DetailedError` only when the caller uses `parseResponse` or `fetchRP`. Calling `fetch` directly on a client method returns the raw response, and the caller must check `ok`.
- A WebSocket URL is constructed with `new URL` and throws if the base URL is not absolute.

## Extension Seams

- `hc` accepts `buildSearchParams`, `headers` (static or function), `fetch` (for custom transports or testing), and `webSocket` (for custom socket classes).
- Per-call `opt.init` lets callers pass `signal`, `credentials`, or other `RequestInit` options.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/client/client.test.ts` covers request assembly, path building, and URL helpers. `src/client/types.test.ts` checks the type inference utilities at compile time. The `test` script runs `tsc -p tsconfig.spec.json` over `src` before Vitest (see [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md)).
