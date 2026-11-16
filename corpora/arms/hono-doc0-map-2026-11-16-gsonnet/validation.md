---
title: "Validation"
---
## Overview

`validator(target, fn)` in `src/validator/validator.ts` is a middleware factory. It pulls one slice of the request (the target), hands it to your function, and stores what the function returns so the handler can read it with `c.req.valid(target)`. The same call carries the types, so the handler and the [[Typed RPC Client]] know the validated shape.

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88)

## Extraction by target

### Targets and values

The middleware reads the `Content-Type` header, then switches on the target:

Sources: [src/validator/validator.ts:89-93](repo://src/validator/validator.ts#L89-L93)

| Target | Value passed to your function |
| --- | --- |
| `json` | `await c.req.json()`, only when the content type matches `application/json` or a `+json` variant; otherwise `{}` |
| `form` | A plain object built from `multipart/form-data` or `application/x-www-form-urlencoded` data; otherwise `{}` |
| `query` | `c.req.queries()` with single-value entries unwrapped to a string and repeated ones left as arrays |
| `param` | `c.req.param()` |
| `header` | `c.req.header()` |
| `cookie` | `getCookie(c)` |

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

The target type is restricted by method: `ValidationTargetByMethod` removes `form` and `json` for `get` and `head`, since those requests must not carry a body.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)

### Body targets

For `json`, a malformed body throws `HTTPException(400, { message: 'Malformed JSON in request body' })`. A missing or non-matching content type does not fail: the function simply receives `{}`.

Sources: [src/validator/validator.ts:94-104](repo://src/validator/validator.ts#L94-L104)

For `form`, the code reuses `c.req.bodyCache.formData` when `parseBody` or an earlier validator already built it (see [[Request and Body Parsing]]); otherwise it reads the `arrayBuffer`, builds `FormData` with `bufferToFormData`, and caches it. Failure throws a 400 `HTTPException` with `Malformed FormData request.` plus the underlying message. Keys ending in `[]` always collect into arrays, and a repeated key turns the value into an array.

Sources: [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143)

## Storing the result

After extraction the middleware awaits `validationFunc(value, c)`.

Sources: [src/validator/validator.ts:162-163](repo://src/validator/validator.ts#L162-L163)

- If the function returns a `Response`, the middleware returns it immediately and `next()` is never called. This is how a validator rejects a request.
- Otherwise the return value is saved with `c.req.addValidatedData(target, res)` and the chain continues with `await next()`.

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

A handler reads the data later with `c.req.valid(target)`, which returns what was stored for that target.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## How the types flow

The middleware's type is `MiddlewareHandler<E, P, V, ExtractValidationResponse<VF>>`, where `V` has an `in` and an `out` side. `out` is `{ [target]: ExtractValidatorOutput<VF> }`, the function's return type with any `Response` or `TypedResponse` removed. `in` is the declared input for the client: for `json`, the explicit input type if given, otherwise the output type; for other targets, `InferInput` of the output.

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185)

`ExtractValidationResponse` does the reverse for responses: if the function can return a `TypedResponse` or `Response`, that type is added to the handler's possible responses; `undefined` and anything else become `never`.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44)

`InferInput` in `src/validator/utils.ts` turns the output shape into the input shape a client may send. Fields whose type is a literal union such as `'asc' | 'desc'` or an optional union keep their type; other fields become `string | string[]` for `query`, `string` for `param`, `header` and `cookie`, the form value type or array of it for `form`, and `unknown` otherwise.

Sources: [src/validator/utils.ts:9-69](repo://src/validator/utils.ts#L9-L69)

## Using it with a handler

Place `validator` before the handler in the same registration; the middleware chain from [[Application and Request Dispatch]] runs it first. The code's own doc comment on `cloneRawRequest` shows the shape:

Sources: [src/request.ts:462-474](repo://src/request.ts#L462-L474)

```ts
app.post('/forward',
  validator('json', (data) => data),
  async (c) => {
    const validated = c.req.valid('json')
    ...
  }
)
```

Sources: [src/request.ts:462-474](repo://src/request.ts#L462-L474)
