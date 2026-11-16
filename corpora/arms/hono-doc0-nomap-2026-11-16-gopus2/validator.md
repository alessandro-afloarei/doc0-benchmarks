---
title: "Validator"
---
## Overview

The `validator` middleware from `hono/validator` connects request parsing, validation and types. At run time it reads one part of the request (the target), passes it to a function the app supplies, and stores what that function returns so the handler can read it with `c.req.valid(target)`. At the type level it declares the route's input: what a client must send (`in`) and what the handler receives (`out`). That declaration is how the [[RPC Client]] knows the shape of each request.

Sources: [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8), [src/validator/validator.ts:46-89](repo://src/validator/validator.ts#L46-L89)

Hono itself ships no schema library. The validation function can be hand-written or come from a wrapper around a library; the doc comment on `InferInput` names `@hono/zod-validator` as such a wrapper.

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22), [src/validator/utils.ts:47-69](repo://src/validator/utils.ts#L47-L69)

## Usage

`validator(target, validationFunc)` returns a middleware to place before the handler on the same route. The function receives the parsed target value and the context. It returns the validated value, or a `Response` to reject the request.

Sources: [src/validator/validator.ts:86-171](repo://src/validator/validator.ts#L86-L171)

```ts
import { validator } from 'hono/validator'

app.post(
  '/posts',
  validator('json', (value, c) => {
    if (typeof value.title !== 'string') {
      return c.text('Invalid!', 400)
    }
    return { title: value.title as string }
  }),
  (c) => {
    const { title } = c.req.valid('json')
    return c.json({ title }, 201)
  }
)
```

Sources: [src/validator/validator.ts:86-171](repo://src/validator/validator.ts#L86-L171)

## Targets

### Value per target

The middleware fills `value` according to the target, then calls the function:

Sources: [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

| Target | Value passed to the function | Read with |
| --- | --- | --- |
| `json` | Parsed JSON body, only when `Content-Type` is JSON | `c.req.json()` |
| `form` | Object of form fields, only for `multipart/form-data` or `application/x-www-form-urlencoded` | `c.req.arrayBuffer()` and `bufferToFormData` |
| `query` | Object of query keys; a key seen once is a string, a repeated key an array | `c.req.queries()` |
| `param` | Path parameters of the current route | `c.req.param()` |
| `header` | All headers, names lower-cased | `c.req.header()` |
| `cookie` | All cookies | `getCookie(c)` |

Sources: [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

### Body targets and content types

For `json`, the content type must match `application/json` or any `application/*+json`, with optional parameters. For `form`, it must be multipart form data with an optional boundary, or URL-encoded. When the content type does not match, the middleware does not read the body at all: `value` stays `{}` and the function decides what an empty object means.

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:93-111](repo://src/validator/validator.ts#L93-L111)

A body that cannot be parsed is refused before the function runs: malformed JSON throws `HTTPException(400)` with `Malformed JSON in request body`, and a form that fails to parse throws `HTTPException(400)` with `Malformed FormData request.` followed by the cause. The app's error handler turns these into responses, as [[Request Lifecycle and Middleware]] describes.

Sources: [src/validator/validator.ts:98-126](repo://src/validator/validator.ts#L98-L126)

### Form fields

The form target reuses a `FormData` already in `c.req.bodyCache`, and otherwise caches the one it parses, so `c.req.formData()` or `parseBody` in the handler does not read the body again. Fields are collected into an object: a key ending in `[]` is always an array, and a key that appears more than once becomes an array from its second value on.

Sources: [src/validator/validator.ts:113-142](repo://src/validator/validator.ts#L113-L142), [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`json` reads through `c.req.json()`, which caches the body text, so the handler can call `c.req.json()` again too. [[HonoRequest]] explains the body cache.

Sources: [src/validator/validator.ts:98-99](repo://src/validator/validator.ts#L98-L99), [src/request.ts:253-255](repo://src/request.ts#L253-L255)

## Result handling

After the function runs, a `Response` result is returned as the middleware's response, which ends the chain without calling the handler. Any other result is stored with `c.req.addValidatedData(target, result)` and the middleware calls `next()`.

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

```ts
const res = await validationFunc(value as never, c as never)

if (res instanceof Response) {
  return res as ExtractValidationResponse<VF>
}

c.req.addValidatedData(target, res as never)

return (await next()) as ExtractValidationResponse<VF>
```

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

Several validators can run on one route, one per target; each stores its own entry, and `c.req.valid` returns the entry for the target asked for.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Types

### Input and output

The middleware's type is `MiddlewareHandler<E, P, V, R>`. `V.out` maps the target to the validation function's return type with responses removed (`ExtractValidatorOutput`); that is what `c.req.valid(target)` returns in later handlers. `V.in` is the type a client sends. For `json` it is the output type itself, or the explicit `InputType` when one is given. For other targets it comes from `InferInput`, because query, params, headers and cookies arrive as strings whatever the function turns them into.

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185)

`InferInput` maps each output key to the raw type of its target: `string | string[]` for query, `string` for param, header and cookie, and a form value or array of them for form. It keeps a key's own type when it is a union of string literals, such as `'asc' | 'desc'`, or optional.

Sources: [src/validator/utils.ts:9-69](repo://src/validator/utils.ts#L9-L69), [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

### Method restrictions and response types

The allowed targets depend on the method the route is registered with: for `get` and `head`, `json` and `form` are excluded at the type level, because those requests carry no body.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)

When the function can return a typed response (`c.json(...)` or `c.text(...)` with a status), `ExtractValidationResponse` adds that response to the route's possible outputs, so a client sees the 400 shape alongside the handler's success shape. [[Route Types and Factory]] shows how these types join the app's schema.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44)
