---
type: concept
title: Validator
description: How the hono/validator middleware extracts json, form, query, param, header and cookie data, enforces content types, reports malformed bodies, stores results for c.req.valid(), and feeds typed inputs to the schema and RPC client; plus how third-party validators build on it.
tags: [validator, validation, middleware, types, request-body]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-cec74aacec3de5c27173baa1
    resource: repo://src/validator/utils.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Validator

`validator(target, validationFunc)` (`src/validator/validator.ts`, exported as `hono/validator`) is a middleware factory that pulls one part of the request, passes it to a user function, and stores the result so the handler can read it with `c.req.valid(target)`. It is deliberately library-agnostic: Zod/Valibot/Standard Schema integrations (e.g. `@hono/zod-validator`, maintained outside this repo) wrap it.

```ts
app.post(
  '/posts',
  validator('json', (value, c) => {
    if (typeof value.title !== 'string') return c.text('Invalid', 400)
    return { title: value.title as string }
  }),
  (c) => c.json(c.req.valid('json'))
)
```

## Extraction per target

| Target | Source | Condition |
| --- | --- | --- |
| `json` | `c.req.json()` | Only if `Content-Type` matches `application/json` or `application/*+json` (with optional parameters). A parse failure throws `HTTPException(400, 'Malformed JSON in request body')`. |
| `form` | Raw body → `FormData` via `bufferToFormData` | Only for `multipart/form-data` or `application/x-www-form-urlencoded`. Parse failure throws `HTTPException(400, 'Malformed FormData request. ...')`. |
| `query` | `c.req.queries()` | Keys with a single value become strings, repeated keys stay arrays. |
| `param` | `c.req.param()` | Decoded path params for the current route. |
| `header` | `c.req.header()` | All headers with **lower-cased** names. |
| `cookie` | `getCookie(c)` | Parsed `Cookie` header. |

If the content type does not match for `json`/`form`, the value passed to the validation function is `{}` – the request is not rejected by the middleware itself. The validation function is responsible for rejecting missing data.

### Form value shaping

Form entries are collected into a null-prototype object (protecting against `__proto__` keys – see the "prototype pollution prevention" tests):

- Keys ending in `[]` always produce arrays.
- A key seen more than once becomes an array of all values.
- Otherwise the single value (`string` or `File`) is stored.

### Body reuse

The `json` path goes through `HonoRequest`'s body cache, and the `form` path reuses `c.req.bodyCache.formData` if present or stores the parsed `FormData` there. Multiple validators, `c.req.json()`/`parseBody()` in the handler, and `cloneRawRequest()` therefore all work after validation (see [Context and HonoRequest](../architecture/context-and-request.md#body-parsing-and-caching)).

## Validation function contract

`validationFunc(value, c)` may be sync or async and may return:

- **A `Response`** (e.g. `c.json(errors, 400)`): the middleware returns it immediately and the handler is not called. Its typed form is propagated into the route schema via `ExtractValidationResponse`, so the RPC client sees the error response type too.
- **Any other value**: stored with `c.req.addValidatedData(target, value)`; then `next()` runs. The returned value can be a transformed/coerced version of the input.

Throwing (e.g. an `HTTPException`) goes through normal [error handling](../architecture/request-lifecycle.md#error-and-not-found-handling).

## Types

- The target type parameter is restricted by HTTP method: on `get`/`head` routes, `json` and `form` targets are excluded at the type level because those requests must not have bodies.
- The middleware's `Input` generic is `{ in: { [target]: ... }, out: { [target]: Output } }`. `out` types `c.req.valid()`. `in` is what the [RPC client](../integrations/rpc-client.md) requires callers to send.
- For non-JSON targets, `InferInput` (`src/validator/utils.ts`, exported for third-party validators) widens output types back to wire types: `form` → `string | File` (or arrays), `query` → `string | string[]`, `param`/`header`/`cookie` → `string`. Literal unions (`'asc' | 'desc'`) and optional fields are preserved.

See [Type System](type-system.md) for how inputs flow into the app schema.

## Tests

`src/validator/validator.test.ts` covers content-type gating, malformed JSON/form errors, body caching across multiple validators, Zod-based validation for every target, async validators, transforms, request cloning after validation, and form prototype-pollution prevention. `src/validator/utils.test.ts` covers `InferInput`.
