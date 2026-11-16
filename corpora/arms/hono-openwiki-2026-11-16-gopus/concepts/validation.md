---
type: concept
title: Validation
description: How the validator() middleware in hono/validator extracts json, form, query, param, header and cookie targets, invokes a user validation function, rejects malformed bodies with HTTP 400, stores results for c.req.valid(), and feeds input types into the route Schema for the RPC client.
tags: [validation, validator, middleware, types, rpc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-df3100f35990271621d0b7be
    resource: repo://src/utils/buffer.ts
  - id: openwiki-source-cec74aacec3de5c27173baa1
    resource: repo://src/validator/utils.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Validation

`hono/validator` (`src/validator/validator.ts`) provides a generic `validator(target, fn)` middleware. It ships with no schema library. Third-party packages such as Zod or Valibot validators wrap it, and the repository's tests use `zod` as a dev dependency. The validator does two things: it parses and checks one request target at runtime, and it contributes `Input` types that flow into `c.req.valid()` and into the [RPC client](types-and-rpc-client.md).

## Runtime flow

```ts
app.post('/posts',
  validator('json', (value, c) => {
    if (!isValid(value)) return c.text('Invalid', 400)   // short-circuit
    return value as Post                                  // becomes c.req.valid('json')
  }),
  (c) => c.json(c.req.valid('json'))
)
```

For each request, the middleware runs these steps:

1. **Extract the raw value** for the target (the default is `{}`):

   | Target | Source | Notes |
   | --- | --- | --- |
   | `json` | `c.req.json()` | Read only if `Content-Type` matches `application/(<x>+)?json[; params]`. Otherwise the value stays `{}`. A parse failure throws `HTTPException(400, 'Malformed JSON in request body')`. |
   | `form` | Cached `formData`, or else `arrayBuffer()` passed to `bufferToFormData` | Read only for `multipart/form-data` (optionally with a boundary) and `application/x-www-form-urlencoded`. The parsed `FormData` is cached on `c.req.bodyCache`. A parse failure throws `HTTPException(400, 'Malformed FormData request. …')`. Keys ending in `[]`, or repeated keys, become arrays. |
   | `query` | `c.req.queries()` | Single values are unwrapped. Repeated keys stay as arrays. |
   | `param` | `c.req.param()` | Path params of the current route. |
   | `header` | `c.req.header()` | Record with lower-cased keys. |
   | `cookie` | `getCookie(c)` | Every parsed cookie. |

2. **Call `validationFunc(value, c)`**, which may be async.
3. **If it returns a `Response`**, the middleware returns that response and never calls `next()`. This is the usual way to send a 400 for invalid input. The response type joins the route's possible outputs through `ExtractValidationResponse`.
4. **Otherwise**, the return value is stored with `c.req.addValidatedData(target, result)`, and the middleware calls `await next()`.

Validation errors are not handled for you. A validator either returns a response or throws. Thrown errors, including the 400 `HTTPException`s from malformed bodies, go through `compose()` to the app's `onError` handler (see [Request lifecycle](../architecture/request-lifecycle.md)).

A request whose content type does not match produces `{}`, not an error. If a JSON body arrives without a JSON `Content-Type`, the validation function receives `{}`. Rejecting it is the function's job.

Because body reads go through the `HonoRequest` body cache, later handlers can still call `c.req.json()` and similar methods (see [Context and HonoRequest](context-and-request.md)).

## Type-level contract

`validator` is generic over the target `U` and the validation function `VF`:

- `ValidationTargetByMethod<M>` excludes the `json` and `form` targets for `get` and `head` routes, because those requests carry no body.
- **`out`** is `ExtractValidatorOutput<VF>`: the function's (awaited) return type with any `Response` or `TypedResponse` branches removed. This is what `c.req.valid(target)` returns.
- **`in`** is what the client must send. For `json` it is the output type, or an explicit `InputType` generic. For the other targets, `InferInput` (`src/validator/utils.ts`) widens each field to its wire type: `string | string[]` for query, `string` for param, header and cookie, and `T | T[]` for form. Literal unions and optional fields are kept as they are.
- The middleware is typed `MiddlewareHandler<E, P, V, ExtractValidationResponse<VF>>`. The `HandlerInterface` overloads in `src/types.ts` merge `V` into the route's `Input`, so `ToSchema` records it as the endpoint's `input`.

The result: `hc<typeof app>().posts.$post({ json: ... })` is type-checked against the validator's `in` type, and the handler's `c.req.valid('json')` is typed with `out`.

## Tests

- `src/validator/validator.test.ts` covers each target, the content-type gating, malformed-body errors, short-circuit responses, and the type inference into the schema.
- `src/validator/utils.test.ts` covers the `InferInput` widening rules.

Related pages: [Built-in middleware](../middleware/built-in-middleware.md), [Type system and RPC client](types-and-rpc-client.md).
