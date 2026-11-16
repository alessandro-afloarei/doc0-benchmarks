---
title: "Validator"
---
## Overview

`validator(target, fn)` from `hono/validator` builds a middleware that reads one part of the request, passes it to a validation function, and either stops the request with the function's response or stores the result for the handler. It is library-agnostic: the function can be hand-written or come from an adapter such as `@hono/zod-validator`, which wraps this same middleware. What it stores is read back with `c.req.valid(target)` ([[HonoRequest: Params, Query, Headers and Body]]), and the types it declares become the route's input in the app's schema ([[Env, Handler and Schema Types]]).

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8)

```ts
import { validator } from 'hono/validator'

app.post(
  '/posts',
  validator('json', (value, c) => {
    const title = value['title']
    if (!title || typeof title !== 'string') {
      return c.json({ message: 'title is required' }, 400)
    }
    return { title }
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

The middleware starts with `value = {}` and fills it according to the target.

Sources: [src/validator/validator.ts:89-93](repo://src/validator/validator.ts#L89-L93)

| Target | Source | Notes |
| --- | --- | --- |
| `json` | `c.req.json()` | Only when `Content-Type` is `application/json` or `application/*+json`; invalid JSON throws `HTTPException(400, 'Malformed JSON in request body')` |
| `form` | the body as `FormData` | Only for `multipart/form-data` or `application/x-www-form-urlencoded`; parse failures throw `HTTPException(400, 'Malformed FormData request. ...')` |
| `query` | `c.req.queries()` | A key with one value becomes a string, several become an array |
| `param` | `c.req.param()` | Decoded path parameters of the current route |
| `header` | `c.req.header()` | Lower-case header names |
| `cookie` | `getCookie(c)` | Parsed `Cookie` header ([[Cookies]]) |

Sources: [src/validator/validator.ts:93-160](repo://src/validator/validator.ts#L93-L160)

For `json` and `form`, a request with a different or missing `Content-Type` is not rejected by the middleware: the validation function receives `{}`. A function that requires fields therefore fails on such a request, while one that accepts an empty object lets it through. The content-type expressions are anchored and allow parameters such as `charset`.

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:94-111](repo://src/validator/validator.ts#L94-L111)

### Form bodies

The form branch first reuses `c.req.bodyCache.formData` if an earlier reader parsed it. Otherwise it reads the body as an `ArrayBuffer`, converts it with `bufferToFormData`, and caches the result, so the handler can still call `c.req.formData()` or `c.req.parseBody()`. It then builds a null-prototype object: a key ending in `[]` is always an array, and a repeated key turns into an array on its second value.

Sources: [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143)

## Validation function and result

`validationFunc(value, c)` may be synchronous or async and returns either the validated value or a `Response`. A `Response` (typically `c.json(..., 400)` or `c.text(..., 400)`) is returned from the middleware immediately, so the handler never runs. Any other value is stored with `c.req.addValidatedData(target, result)` and the middleware awaits `next()`.

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

Several validators can run on one route, one per target. Each stores under its own target, and `c.req.valid('query')` and `c.req.valid('json')` return their respective results.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Types

### Input and output

The middleware's type is `MiddlewareHandler<E, P, V, ...>` where `V` is an `Input` with two parts.

Sources: [src/validator/validator.ts:85-88](repo://src/validator/validator.ts#L85-L88)

- `out[target]`: the function's return type, with `Response` and `TypedResponse` returns removed (`ExtractValidatorOutput`). This is what `c.req.valid(target)` returns.
- `in[target]`: what a client must send. For `json` it is the output type (or an explicit `InputType`). For other targets it is computed by `InferInput`, because query strings, params and headers arrive as strings even when the validator converts them to numbers.

Sources: [src/validator/validator.ts:64-82](repo://src/validator/validator.ts#L64-L82), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185)

`InferInput<Output, Target>` maps each output field to `string` (or `string | string[]` for queries, `File | string` or arrays of them for forms), keeping literal unions such as `'asc' | 'desc'` and optional fields as they are. Third-party validators export their input types through it so their typed client inputs match this middleware's.

Sources: [src/validator/utils.ts:1-69](repo://src/validator/utils.ts#L1-L69)

### Responses from the validator

When the validation function can return a typed response, `ExtractValidationResponse` adds that response to the route's possible outputs. A client calling the route then sees the `400` body as one branch of the response union alongside the handler's ([[RPC Client]]).

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44)

### Body targets on GET

`ValidationTargetByMethod` removes `json` and `form` from the allowed targets when the route's method is `get` or `head`, since those requests carry no body. `app.get('/', validator('json', ...))` is a type error.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)

## Errors

Malformed bodies raise `HTTPException(400)` rather than reaching the validation function, so they go through the app's `onError` handler, or the default handler which answers with the exception's message ([[Request Dispatch and Middleware Composition]]). An exception thrown by the validation function itself propagates the same way.

Sources: [src/validator/validator.ts:98-126](repo://src/validator/validator.ts#L98-L126), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)
