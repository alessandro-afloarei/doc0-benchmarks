---
type: concept
title: Validation
description: How hono/validator extracts json, form, query, param, header and cookie input, enforces content types, calls a user validation function, stores the result for c.req.valid(), and feeds input/output types into the route schema.
tags: [validation, validator, middleware, types, rpc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Validation

`validator(target, fn)` (`src/validator/validator.ts`, exported as `hono/validator`) is a middleware factory. It reads one part of the request, gives it to your function, and stores what the function returns, so later handlers can read it with `c.req.valid(target)`. The library does not ship a schema language. Third-party packages (`@hono/zod-validator` and others) wrap this primitive. The repository only uses `zod` as a dev dependency for tests.

## Targets and extraction

`ValidationTargets` (`src/types.ts`) defines six targets:

| Target | Source | Notes |
| --- | --- | --- |
| `json` | `c.req.json()` | Only read if `Content-Type` matches `application/json` or `application/*+json`. Otherwise the value is `{}`. Malformed JSON throws `HTTPException(400, 'Malformed JSON in request body')` |
| `form` | `multipart/form-data` or `application/x-www-form-urlencoded` body | Reuses `c.req.bodyCache.formData` if it exists, otherwise parses the `arrayBuffer` with `bufferToFormData` and caches the result. A parse failure throws `HTTPException(400, 'Malformed FormData request. …')`. Keys ending in `[]`, and repeated keys, become arrays |
| `query` | `c.req.queries()` | Single values are unwrapped, repeated keys stay arrays |
| `param` | `c.req.param()` | Decoded path params of the current route |
| `header` | `c.req.header()` | All headers. Keys are lower-cased by `Headers` |
| `cookie` | `getCookie(c)` | Parsed `Cookie` header |

The content-type check is deliberate. A body-target validator that gets the wrong content type does **not** fail by itself. It calls your function with `{}`, and your schema decides whether that is an error. At the type level, `ValidationTargetByMethod` removes `json` and `form` for `get`/`head` routes, because those requests must not have a body.

Because extraction goes through `HonoRequest`'s body cache (see [Context and HonoRequest](../architecture/context-and-request.md)), handlers can still call `c.req.json()` or `c.req.formData()` after validation, and `cloneRawRequest` can forward the request.

## The validation function

`fn(value, c)` may:

- return the validated or transformed value, which is then stored with `c.req.addValidatedData(target, result)`, after which `next()` is called;
- return a `Response` (for example `c.json({ error }, 400)`), which short-circuits the chain and is returned as is. Its `TypedResponse` type is added to the route's possible outputs (`ExtractValidationResponse`), so RPC clients see the error shape;
- throw, which goes through normal error handling. Throwing `HTTPException` gives a status-coded response.

The function may be async. Several validators can be chained on one route, one per target, and their `Input` types are intersected.

## Type flow

The generic signature builds an `Input` of the form `{ in: { [target]: … }, out: { [target]: ReturnType<fn> } }`:

- **`out`** is what `c.req.valid(target)` returns, typed through `InputToDataByTarget`.
- **`in`** is what the RPC client must send. For `json` it is the explicit `InputType` generic if given, or else the output type. For the other targets, `InferInput` (`src/validator/utils.ts`) widens fields to what arrives on the wire: `string` (or `File`/`string[]` for `form`), unless the field is a string-literal union or optional. This is how a validator that coerces `?page=1` to a number still asks the client for a string.

See [Type System and RPC Client](./types-and-rpc-client.md) for how `Input` becomes part of the route `Schema`.

## Tests

- `src/validator/validator.test.ts` covers content-type matching, malformed bodies, array handling for form and query values, response short-circuiting, and type expectations (including `zod`-based schemas).
- `src/validator/utils.test.ts` covers the `InferInput` type transformations.
