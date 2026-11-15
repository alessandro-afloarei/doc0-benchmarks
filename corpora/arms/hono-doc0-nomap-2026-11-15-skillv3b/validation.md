---
title: "Validation"
---
## Overview

`validator(target, fn)` from `hono/validator` is a middleware that reads one part of the request, passes it to a validation function, and either stops the request with the function's `Response` or stores its return value for the handler to read with `c.req.valid(target)`. Hono ships no schema library: the function can check values by hand, or adapters such as `@hono/zod-validator` wrap a schema in it. Because the middleware's type records the input and output, the validated shape flows into the route's schema and from there into the [[RPC Client]].

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8)

```ts
import { validator } from 'hono/validator'

app.post(
  '/posts',
  validator('json', (value, c) => {
    if (typeof value.title !== 'string') {
      return c.text('Invalid title', 400)
    }
    return { title: value.title as string }
  }),
  (c) => {
    const { title } = c.req.valid('json')
    return c.json({ title }, 201)
  }
)
```

Sources: [src/validator/validator.ts:89-171](repo://src/validator/validator.ts#L89-L171)

## Reading each target

### Target sources

The middleware switches on `target` and builds `value` from the request. Every read goes through [[HonoRequest]], so its body cache applies and a later handler can still read the body.

Sources: [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

| Target | Source | Notes |
| --- | --- | --- |
| `json` | `c.req.json()` | Only when `Content-Type` is `application/json` or `application/*+json`; otherwise `value` stays `{}` |
| `form` | `c.req.arrayBuffer()`, then `bufferToFormData` | Only for `multipart/form-data` and `application/x-www-form-urlencoded`; otherwise `{}` |
| `query` | `c.req.queries()` | A key with one value becomes a string, several values an array |
| `param` | `c.req.param()` | Decoded path parameters of the current route |
| `header` | `c.req.header()` | All headers, keys lower-case |
| `cookie` | `getCookie(c)` | All cookies as a record |

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:93-160](repo://src/validator/validator.ts#L93-L160)

> [!WARNING]
> A `json` or `form` validator does not reject a request with the wrong `Content-Type`; it validates `{}`. The validation function must treat missing fields as invalid, which schema validators do by default.

Sources: [src/validator/validator.ts:94-111](repo://src/validator/validator.ts#L94-L111)

### Form bodies

For `form`, the middleware reuses `c.req.bodyCache.formData` when another reader already parsed the body. Otherwise it reads the raw bytes and builds `FormData` through a `Response` whose media type is lower-cased while the boundary is preserved, then caches it. Fields are collected into a plain object: a key ending in `[]` is always an array, and a key repeated without `[]` becomes an array on its second occurrence. That differs from `parseBody`, where the last value wins unless `all` is set.

Sources: [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143), [src/utils/buffer.ts:106-117](repo://src/utils/buffer.ts#L106-L117)

### Malformed bodies

A JSON body that fails to parse throws `HTTPException(400, { message: 'Malformed JSON in request body' })`. A form body that fails to parse throws `HTTPException(400)` with `Malformed FormData request.` and the parser's message. Both reach the app's error handler, which by default answers 400 with that message (see [[Request Lifecycle and Middleware Composition]]).

Sources: [src/validator/validator.ts:98-104](repo://src/validator/validator.ts#L98-L104), [src/validator/validator.ts:118-126](repo://src/validator/validator.ts#L118-L126)

## Running the validation function

`fn(value, c)` may be synchronous or asynchronous. If it returns a `Response` (for example `c.json(errors, 400)`), the middleware returns that response and the handler never runs. Any other value is stored with `c.req.addValidatedData(target, result)` and the middleware calls `next()`. The value stored is what the function returned, not the raw input, so a function can coerce or default values (`Number(value.page)`).

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

Several validators can run on one route, one per target. Each stores under its own key, and the handler reads each with `c.req.valid('json')`, `c.req.valid('query')` and so on.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Types

### Input and output

`validator` is generic over the target `U`, the validation function `VF` and an explicit `InputType`. The middleware it returns is typed `MiddlewareHandler<E, P, V, ...>`, where `V` has two halves:

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88)

| Half | Type | Used by |
| --- | --- | --- |
| `out[target]` | The validation function's return type, minus any `Response` branch (`ExtractValidatorOutput`) | `c.req.valid(target)` in the handler |
| `in[target]` | What a client must send: `InputType` when given, otherwise inferred from the output with `InferInput` | The route schema and the RPC client |

Sources: [src/validator/validator.ts:64-82](repo://src/validator/validator.ts#L64-L82), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185)

`InferInput` maps an output object to what the wire format can carry. For `query` every field is `string | string[]`, for `form` a `string | File` or an array of them, for `param`, `header` and `cookie` a `string`. Literal unions such as `'asc' | 'desc'` and optional fields are kept as they are, so a client still sees the allowed values. Schema adapters call it as `InferInput<z.input<Schema>, 'query'>`.

Sources: [src/validator/utils.ts:4-69](repo://src/validator/utils.ts#L4-L69)

The value passed to the function is typed by `ValidationTargets`: `json` is `any`, `form` a record of `string | File` values, `query` a record of strings or arrays, `param` a record keyed by the route's parameter names.

Sources: [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

### Responses from the validator

When the function can return a `Response`, `ExtractValidationResponse` adds that response type to the middleware's possible results. The route's schema then lists the error response alongside the handler's, so a client can narrow on the 400 status. [[Type System and Route Schemas]] explains how middleware responses are merged into a route's output.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44)

### Targets by method

`ValidationTargetByMethod<M>` excludes `json` and `form` for `get` and `head`, so a body validator on a GET route is a type error: those requests have no body.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)
