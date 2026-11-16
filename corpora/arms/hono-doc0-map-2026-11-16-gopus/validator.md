---
title: "Validator"
---
## Overview

`validator(target, validationFunc)` from `hono/validator` is a middleware that reads one part of the request, passes it to your function, and stores what the function returns so the handler can read it with `c.req.valid(target)`. Hono ships no schema library: the function can check values by hand or call any library, and packages such as `@hono/zod-validator` are built on this middleware, as the example in `InferInput`'s comment shows.

Sources: [src/validator/validator.ts:86-172](repo://src/validator/validator.ts#L86-L172), [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8), [src/validator/utils.ts:47-69](repo://src/validator/utils.ts#L47-L69)

The middleware also carries types: the input type it declares becomes part of the route's schema, which is how the [[RPC Client]] knows what a route accepts. That type flow is summarised at the end of this page and explained on [[Route Types and Schema]].

Sources: [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88)

## Usage

```ts
import { validator } from 'hono/validator'

app.post(
  '/posts',
  validator('json', (value, c) => {
    const title = value['title']
    if (!title || typeof title !== 'string') {
      return c.text('Invalid!', 400)
    }
    return { title }
  }),
  (c) => {
    const { title } = c.req.valid('json')
    return c.json({ title }, 201)
  }
)
```

Sources: [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

The function receives the value and the Context. Returning a `Response` stops the chain with that response; returning anything else stores it as the validated data and calls `next()`. The function may be async.

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

## Targets

The middleware builds the value from the target before calling the function:

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

| Target | Value passed to the function |
| --- | --- |
| `json` | `await c.req.json()`, only when `Content-Type` is JSON (`application/json` or `application/*+json`) |
| `form` | The form fields, only when `Content-Type` is `multipart/form-data` or `application/x-www-form-urlencoded` |
| `query` | `c.req.queries()`, with single-value arrays unwrapped to strings |
| `param` | `c.req.param()` |
| `header` | `c.req.header()`, with lower-case names |
| `cookie` | `getCookie(c)` |

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

For `json` and `form`, a request whose content type does not match is not rejected: the function receives `{}` and decides. A `json` body that fails to parse throws `HTTPException(400, { message: 'Malformed JSON in request body' })`. A form body that fails to parse throws a 400 whose message starts with `Malformed FormData request.` and adds the parser's error.

Sources: [src/validator/validator.ts:90-127](repo://src/validator/validator.ts#L90-L127)

Form fields are collected into an object created with `Object.create(null)`. A key ending in `[]` is always an array, and a key that appears more than once becomes an array of its values. The parsed `FormData` is cached in `c.req.bodyCache.formData`, and an already cached one is reused, so `c.req.formData()` and `parseBody()` still work afterwards ([[HonoRequest]]).

Sources: [src/validator/validator.ts:105-142](repo://src/validator/validator.ts#L105-L142)

The type of `target` depends on the route's method: for `get` and `head`, a comment notes that the request must not have a body, and `json` and `form` are excluded from the allowed targets.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)

The default value types for each target are declared in `ValidationTargets`:

Sources: [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

```ts
export type ValidationTargets<T extends FormValue = ParsedFormValue, P extends string = string> = {
  json: any
  form: Record<string, T | T[]>
  query: Record<string, string | string[]>
  param: Record<P, P extends `${infer _}?` ? string | undefined : string>
  header: Record<RequestHeader | CustomHeader, string>
  cookie: Record<string, string>
}
```

Sources: [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

## Reading the validated data

`c.req.addValidatedData(target, data)` stores the function's result per target, and `c.req.valid(target)` returns it. Several validators can run on one route, one per target, and each target's data is kept separately. Calling `valid` for a target that no validator filled returns `undefined`.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354), [src/validator/validator.ts:168-168](repo://src/validator/validator.ts#L168-L168)

The middleware returns the result of `next()` after storing the data. It runs inside the normal chain, so a validator registered with `app.use` before the route also feeds the handler ([[Request Dispatch and Middleware]]).

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

## Types: in and out

`validator` returns a `MiddlewareHandler<E, P, V, …>` whose input type `V` has two halves:

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185)

- `out` maps the target to `ExtractValidatorOutput<VF>`, the function's return type with any `Response` or `TypedResponse` removed. This is what `c.req.valid(target)` returns in the handler.
- `in` is what a client must send. For `json` it is the output type, unless the caller gave an explicit `InputType`. For the other targets it is `InferInput<Output, Target>`.

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185)

`InferInput` turns each output field into what arrives over the wire: `string | string[]` for a query, `string` for params, headers and cookies, and the form value type, or an array of it, for a form. It keeps a field's type when it is a union of string literals, such as `'asc' | 'desc'`, or when it is optional.

Sources: [src/validator/utils.ts:1-69](repo://src/validator/utils.ts#L1-L69)

When the validation function can return a typed response, such as `c.json({ error }, 400)`, `ExtractValidationResponse<VF>` keeps that type as the middleware's response type. The route's schema therefore lists the 400 response next to the handler's own, and the RPC client sees both.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44), [src/validator/validator.ts:88-88](repo://src/validator/validator.ts#L88-L88)
