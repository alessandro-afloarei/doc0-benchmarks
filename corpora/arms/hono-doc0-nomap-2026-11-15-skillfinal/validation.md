---
title: "Validation"
---
## Overview

`validator(target, validationFunc)` from `hono/validator` is a middleware factory. The middleware it returns extracts one part of the request (the target), passes it to your function, and either stops the request with the `Response` your function returns or stores the function's result for the handler to read with `c.req.valid(target)`. The function may call any validation library; the `InferInput` doc comment names `@hono/zod-validator` as one package built on this middleware.

Sources: [src/validator/validator.ts:86-172](repo://src/validator/validator.ts#L86-L172), [src/validator/utils.ts:47-58](repo://src/validator/utils.ts#L47-L58)

The middleware matters as much for types as for run-time checks: its type parameters record the target's input type and the function's output type, which the route's schema picks up and the [[RPC Client]] later uses to type request arguments ([[Typed Routes and Schemas]]).

Sources: [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88)

## Targets

| Target | Value passed to the function | Extraction rule |
| --- | --- | --- |
| `json` | parsed JSON body | only when `Content-Type` matches `application/json` or `application/*+json`; otherwise `{}` |
| `form` | object built from `FormData` | only for `multipart/form-data` or `application/x-www-form-urlencoded`; otherwise `{}` |
| `query` | `c.req.queries()` with single values unwrapped | repeated keys stay arrays |
| `param` | `c.req.param()` | decoded path parameters of the current route |
| `header` | `c.req.header()` | every header, lower-case names |
| `cookie` | `getCookie(c)` | every cookie as a string record |

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

A missing or non-matching content type is not an error: the function receives `{}` and decides for itself whether that is valid. For `GET` and `HEAD` routes, the target type excludes `json` and `form`, so those targets do not type-check there.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12), [src/validator/validator.ts:94-111](repo://src/validator/validator.ts#L94-L111)

## Reading the body

### JSON

The `json` target reads `c.req.json()`, which goes through the [[HonoRequest]] body cache, so the handler can read the body again afterwards. A body that fails to parse throws `HTTPException(400)` with the message `Malformed JSON in request body`, which the default error handler turns into a 400 response.

Sources: [src/validator/validator.ts:94-104](repo://src/validator/validator.ts#L94-L104), [src/request.ts:253-255](repo://src/request.ts#L253-L255)

### Forms

The `form` target reuses a `FormData` already in `c.req.bodyCache`. Otherwise it reads the body as an `ArrayBuffer`, parses it with `bufferToFormData`, and stores the result in the cache. A parse failure throws `HTTPException(400)` with `Malformed FormData request.` followed by the underlying message.

Sources: [src/validator/validator.ts:105-127](repo://src/validator/validator.ts#L105-L127), [src/utils/buffer.ts:106-117](repo://src/utils/buffer.ts#L106-L117)

The entries become a plain object with a null prototype. Keys ending in `[]` always collect arrays, and a key that repeats turns into an array from its second occurrence, so `form` always keeps every value, unlike `c.req.parseBody()` without the `all` option.

Sources: [src/validator/validator.ts:129-142](repo://src/validator/validator.ts#L129-L142), [src/utils/body.ts:151-179](repo://src/utils/body.ts#L151-L179)

## The validation function

The function is called as `validationFunc(value, c)` and may be async. What it returns decides the outcome:

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22), [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

| Return value | Effect |
| --- | --- |
| a `Response` (for example `c.json(errors, 400)`) | returned as the response; the handler does not run |
| anything else | stored with `c.req.addValidatedData(target, result)`, then `next()` runs |
| a thrown error | goes to the app's error handler like any other error |

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

The handler reads the stored result with `c.req.valid(target)`. Each target has one slot, so a second validator for the same target replaces the first one's data. The data is the function's output, not the raw input, so a validator can coerce or transform values:

Sources: [src/request.ts:333-354](repo://src/request.ts#L333-L354)

```ts
app.post('/forward',
  validator('json', (data) => data),
  async (c) => {
    const validated = c.req.valid('json')
    // Body has been consumed, but cloneRawRequest still works
    const clonedReq = await cloneRawRequest(c.req)
    return fetch('http://backend-service.com', clonedReq)
  }
)
```

Sources: [src/request.ts:462-475](repo://src/request.ts#L462-L475)

## Types

### Input and output

The middleware's type is `MiddlewareHandler<E, P, V, ...>` where `V` is `{ in: { [target]: ... }, out: { [target]: ... } }`. The `out` type is the function's return type with `Response` and `TypedResponse` results removed (`ExtractValidatorOutput`), and it is what `c.req.valid(target)` returns in the handler.

Sources: [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185), [src/types.ts:2720-2729](repo://src/types.ts#L2720-L2729)

The `in` type describes what a client must send. For `json` it is the explicit `InputType` generic when given, else the output type. For the other targets it is `InferInput<output, target>`, which maps every field back to what the wire can carry (`string | string[]` for query, `string` for param, header and cookie, `string | File` or arrays of them for form) while keeping literal unions such as `'asc' | 'desc'` and optional fields as declared.

Sources: [src/validator/utils.ts:1-69](repo://src/validator/utils.ts#L1-L69), [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

### Responses from the validator

When the function can return a `TypedResponse` (for example `c.json({ error }, 400)`), `ExtractValidationResponse` adds that response to the middleware's type, and the route's schema then includes it as one of the route's possible outputs, so the client sees the 400 shape alongside the handler's own response.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44), [src/types.ts:2662-2672](repo://src/types.ts#L2662-L2672)
