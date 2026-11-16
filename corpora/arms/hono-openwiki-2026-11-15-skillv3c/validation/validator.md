---
type: concept
title: Validator
description: How hono/validator's validator(target, fn) middleware extracts json/form/query/param/header/cookie data, enforces content types, handles malformed bodies, lets the validation function return a Response, stores the result for c.req.valid(), and propagates input/output types into the route schema for RPC.
tags: [validator, validation, middleware, rpc, types]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-cec74aacec3de5c27173baa1
    resource: repo://src/validator/utils.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Validator

`validator(target, validationFunc)` (`src/validator/validator.ts`, exported from `hono/validator`) is a middleware that extracts one part of the request, hands it to a user function, and stores the function's return value as validated data. It is library-agnostic: schema libraries (Zod, Valibot, ArkType, Standard Schema, …) are integrated by thin third-party wrappers in the `honojs/middleware` repository that call `validator()` and use the `InferInput` type helper.

```ts
app.post('/posts',
  validator('json', (value, c) => {
    if (typeof value.title !== 'string') return c.text('Invalid!', 400)
    return { title: value.title as string }
  }),
  (c) => c.json(c.req.valid('json'), 201)
)
```

## Runtime flow

1. **Extract `value` by target** (default `{}`):

| Target | Source | Notes |
| --- | --- | --- |
| `json` | `c.req.json()` | Only if `Content-Type` matches `application/json` or `application/*+json` (with optional parameters). Otherwise the value stays `{}` — the validator does **not** reject a wrong content type by itself. Invalid JSON throws `HTTPException(400, 'Malformed JSON in request body')`. |
| `form` | `multipart/form-data` or `application/x-www-form-urlencoded` body | Reuses `c.req.bodyCache.formData` if `parseBody`/another validator already parsed it; otherwise reads `c.req.arrayBuffer()` and converts with `bufferToFormData`, caching the result. Repeated keys and keys ending in `[]` become arrays. Parse failures throw `HTTPException(400, 'Malformed FormData request. …')`. |
| `query` | `c.req.queries()` | Single values unwrapped to strings, repeated keys kept as arrays. |
| `param` | `c.req.param()` | Params of the current route. |
| `header` | `c.req.header()` | All headers, lower-cased keys. |
| `cookie` | `getCookie(c)` | All cookies. |

2. **Call `validationFunc(value, c)`** (may be async).
3. If it returns a **`Response`**, that response is returned immediately and the handler is skipped — this is how validation errors are reported.
4. Otherwise the return value is stored with `c.req.addValidatedData(target, result)` and `next()` runs. Handlers read it with `c.req.valid(target)` (see [HonoRequest](../core/request.md#validated-data)).

Because the body is read through `HonoRequest`'s cached readers, several validators (e.g. `json` and `header`) and the handler can coexist on one route without "body already used" errors.

## Types

The validator's type parameters connect the validation function to the route schema (see [Type System and Route Schema](../typing/type-system.md)):

- `ValidationFunction<In, Out>` — `(value, c) => Out | TypedResponse | Promise<...>`.
- The middleware is typed as `MiddlewareHandler<E, P, { in: { [target]: In }, out: { [target]: Out } }, Response>`.
  - **`out`** is the function's return type excluding `Response`/`TypedResponse` (`ExtractValidatorOutput`), which types `c.req.valid(target)`.
  - **`in`** is what the RPC client must send. For `json` it is an explicit input type parameter if given, else the output type. For other targets `InferInput<Output, Target>` (`src/validator/utils.ts`) maps output fields to wire types (e.g. query/form values become `string | string[]`, form values may be `File`) while preserving string-literal unions like `'asc' | 'desc'`.
- If the validation function can return a typed response (e.g. `c.json({ error }, 400)`), it is added to the route's output union (`ExtractValidationResponse`), so the [RPC client](../typing/rpc-client.md) sees the error shape.
- `ValidationTargetByMethod` restricts `json`/`form` targets at the type level for `GET`/`HEAD` routes, which must not have bodies.

## Interaction with other features

- Failures thrown as `HTTPException` are converted by the app's error handler ([Error Handling](../core/error-handling.md)).
- `bodyLimit` should run **before** the validator so oversized bodies are rejected before parsing ([Request/Response Middleware](../middleware/request-response-middleware.md)).
- `form` validation uses the same `FormData` cache as `c.req.parseBody()`, but its array rules differ slightly: the validator always collects repeated keys, while `parseBody` only does with `all: true` (or `[]` keys).

## Tests

`src/validator/validator.test.ts` covers each target, content-type edge cases (charset parameters, `+json` types), malformed JSON/form errors, validator chaining, returning responses, and extensive type assertions for `in`/`out` and RPC inference. `src/validator/utils.test.ts` tests `InferInput`.
