---
title: "Validation"
---
## Overview

`validator(target, fn)` from `hono/validator` builds a middleware that reads one part of the request, passes it to a function the app supplies, and either answers the request with that function's `Response` or stores its result for the handler. The handler reads the result with `c.req.valid(target)`, typed from what the function returned. Hono ships no schema library: the function is where an app calls one, and third-party validators wrap `validator` the same way. The types the middleware adds to the route are what the [[RPC Client]] uses for request arguments.

Sources: [src/validator/validator.ts:85-172](repo://src/validator/validator.ts#L85-L172), [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8)

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

Sources: [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Targets

| Target | Value passed to the function | Read from |
| --- | --- | --- |
| `json` | The parsed body | `c.req.json()`, only for a JSON content type |
| `form` | An object of fields; repeated fields and `name[]` fields become arrays | the body as form data, only for a form content type |
| `query` | Each parameter as a string, or an array when it appears more than once | `c.req.queries()` |
| `param` | The route parameters | `c.req.param()` |
| `header` | All headers, keyed by lower-case name | `c.req.header()` |
| `cookie` | All cookies | `getCookie(c)` |

Sources: [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160), [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690)

The value for a target starts as `{}`. A body target whose content type does not match leaves it so: the function then receives `{}` rather than the request being refused, and it is up to the function to reject what it does not accept.

Sources: [src/validator/validator.ts:89-111](repo://src/validator/validator.ts#L89-L111)

## Content-type checks

`json` accepts `application/json` and any `application/*+json` type, with parameters such as `charset`. `form` accepts `multipart/form-data` with an optional boundary, and `application/x-www-form-urlencoded`. The checks are regular expressions on the `Content-Type` header, case-insensitive.

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26)

At the type level, a validator on a `get` or `head` route cannot use `json` or `form`: `ValidationTargetByMethod` removes them, with the comment that GET and HEAD requests must not have a body.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)

## Reading the body

For `json`, the middleware calls `c.req.json()`, which caches the text, so the handler can still read the body. A body that fails to parse throws `HTTPException(400)` with the message `Malformed JSON in request body`.

Sources: [src/validator/validator.ts:94-104](repo://src/validator/validator.ts#L94-L104), [src/request.ts:220-255](repo://src/request.ts#L220-L255)

For `form`, the middleware reuses `c.req.bodyCache.formData` when an earlier reader stored it. Otherwise it reads the cached `arrayBuffer`, converts it with `bufferToFormData` and stores the result in the cache. A conversion error throws `HTTPException(400)` with `Malformed FormData request.` followed by the error's message. Fields are then collected the way `parseBody({ all: true })` does on [[HonoRequest]]: a key ending in `[]` is always an array, and a key seen twice becomes one.

Sources: [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143)

Both exceptions go to the app's error handler, whose default answers with the exception's response, as [[Request Lifecycle and Error Handling]] describes.

Sources: [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

## The validation function

The function receives the value and the Context, and may be async. What it returns decides the outcome:

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22), [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

1. A `Response`, typically `c.json(..., 400)` or `c.text(..., 400)`, is returned by the middleware at once, and the handler never runs.
2. Anything else is stored with `c.req.addValidatedData(target, result)` and the middleware continues with `await next()`.

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22), [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

Each target has one slot, so a second validator for the same target overwrites the first one's result. Validators for different targets can be stacked on one route.

Sources: [src/request.ts:339-341](repo://src/request.ts#L339-L341)

## Types it adds to the route

`validator` returns `MiddlewareHandler<E, P, V, R>`. `V` has two halves:

Sources: [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185), [src/validator/utils.ts:25-69](repo://src/validator/utils.ts#L25-L69)

- `out[target]` is `ExtractValidatorOutput<VF>`: the function's return type, with promises unwrapped and `Response` results removed. This is what `c.req.valid(target)` returns.
- `in[target]` is what a client must send. For `json` it is the output type, or the explicit `InputType` type argument when one is given. For the other targets it is `InferInput<Output, target>`, which keeps literal unions and optional keys from the output and widens every other key to what the target can carry: `string | string[]` for `query`, `string` for `param`, `header` and `cookie`, and `File | string` values or arrays for `form`.

Sources: [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185), [src/validator/utils.ts:25-69](repo://src/validator/utils.ts#L25-L69)

`R` is `ExtractValidationResponse<VF>`: the typed responses the function can return, such as the 400 above. They join the route's possible responses, so a client sees the validation error as one of the outcomes.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44)

`c.req.valid(target)` is typed with `InputToDataByTarget`, which picks the `out` entry for the target from the route's accumulated input. [[Typed Routes and Schemas]] explains how a handler chain's inputs are merged and written into the app's schema.

Sources: [src/request.ts:351-354](repo://src/request.ts#L351-L354), [src/types.ts:2715-2727](repo://src/types.ts#L2715-L2727)

`InferInput` is exported for libraries that wrap `validator` with a schema library. Its documentation shows the intended use, `InferInput<z.input<Schema>, 'query'>`, which gives `{ orderBy: 'asc' | 'desc', page: string | string[] }` for a schema whose `orderBy` is a literal union.

Sources: [src/validator/utils.ts:47-69](repo://src/validator/utils.ts#L47-L69)
