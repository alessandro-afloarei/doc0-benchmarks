---
title: "Validator"
---
## Overview

`validator(target, fn)` from `hono/validator` is a middleware that reads one part of the request, hands it to a function that checks it, and stores the function's result so the handler can read it with `c.req.valid(target)`. It does not validate anything itself: the function decides, which is how schema libraries plug in. Its other job is in the types: the middleware's `Input` type tells the route what the request must contain and what the handler receives, and that information reaches the route's schema and the [[RPC Client]] (see [[Typed Routes and Schemas]]).

Sources: [src/validator/validator.ts:86-172](repo://src/validator/validator.ts#L86-L172), [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8)

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

Sources: [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

## Reading the target

The middleware starts from `value = {}` and fills it according to the target:

Sources: [src/validator/validator.ts:89-93](repo://src/validator/validator.ts#L89-L93)

| Target | Value passed to the function | Condition |
| --- | --- | --- |
| `json` | `await c.req.json()` | `Content-Type` matches `application/json` or `application/*+json` |
| `form` | An object of form fields | `Content-Type` is `multipart/form-data` or `application/x-www-form-urlencoded` |
| `query` | `c.req.queries()`, with single values unwrapped from their arrays | always |
| `param` | `c.req.param()` | always |
| `header` | `c.req.header()`, keys in lower case | always |
| `cookie` | `getCookie(c)` | always |

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:93-160](repo://src/validator/validator.ts#L93-L160)

> [!WARNING]
> When the `Content-Type` does not match a `json` or `form` target, the body is not read and the function receives `{}`. A schema that requires fields will then reject the request, but a permissive function will pass an empty object through.

Sources: [src/validator/validator.ts:94-111](repo://src/validator/validator.ts#L94-L111)

For `form`, the middleware reuses `c.req.bodyCache.formData` if `parseBody` or an earlier validator already parsed the body; otherwise it reads the body as an `ArrayBuffer` through [[HonoRequest]]'s cache, converts it with `bufferToFormData`, and caches the result. Fields are collected like `parseBody` with `all: true`: keys ending in `[]` are always arrays, a repeated key becomes an array, and other keys keep a single value.

Sources: [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143)

## Running the function

The function is called as `validationFunc(value, c)` and may be async. Its result decides what happens next:

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

1. A `Response` (usually from `c.json(..., 400)` or `c.text(..., 400)`) is returned at once and the chain stops, so the handler never runs.
2. Any other value is stored with `c.req.addValidatedData(target, result)`, replacing what an earlier validator for the same target stored, and the middleware calls `next()`.
3. A thrown error propagates like any middleware error, through the app's error handler as described in [[Request Lifecycle and Middleware Composition]].

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

Parsing failures are not left to the function. Invalid JSON throws `HTTPException(400, 'Malformed JSON in request body')`, and an unparseable form throws `HTTPException(400)` with `Malformed FormData request.` followed by the cause. The default error handler turns both into 400 responses.

Sources: [src/validator/validator.ts:98-126](repo://src/validator/validator.ts#L98-L126), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

## Types

### Input and output

The middleware is typed `MiddlewareHandler<E, P, V, ExtractValidationResponse<VF>>`, where `V` is `{ in, out }` for the chosen target:

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88)

- `out[target]` is `ExtractValidatorOutput<VF>`: the function's return type with any `Response` or `TypedResponse` removed. This is what `c.req.valid(target)` returns in later handlers.
- `in[target]` is what a client must send. For `json` it is the explicit `InputType` generic if one was given, otherwise the output type. For the other targets it is `InferInput<Output, target>`, which widens each field to what the transport can carry: `string | string[]` for query, `string` for params, headers and cookies, `File | string` or arrays of them for forms. Literal unions such as `'asc' | 'desc'` and optional fields are kept as they are.

Sources: [src/validator/validator.ts:64-82](repo://src/validator/validator.ts#L64-L82), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185), [src/validator/utils.ts:9-69](repo://src/validator/utils.ts#L9-L69)

`ExtractValidationResponse<VF>` keeps the typed error responses the function can return, so a route's schema lists both the handler's success response and the validator's 400 response, each with its own status.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44), [src/types.ts:2662-2672](repo://src/types.ts#L2662-L2672)

### Targets by method

`ValidationTargetByMethod<M>` removes `json` and `form` from the allowed targets when the route's method is `get` or `head`, because those requests carry no body. Using `validator('json', ...)` on `app.get` is therefore a type error rather than a silent `{}`.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)

## Building on the validator

Schema-library adapters (Zod, Valibot, TypeBox and the Standard Schema validator live in separate `@hono/*` packages) wrap `validator()`: they call the library's parser inside the function, return a 400 response or a hook's response on failure, and return the parsed data on success. `InferInput` is exported for them, so an adapter can compute the request-side type from the library's input type with `InferInput<z.input<Schema>, 'query'>`.

Sources: [src/validator/utils.ts:47-69](repo://src/validator/utils.ts#L47-L69), [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8)

Several validators can be stacked on one route, one per target or more; their `Input` types are intersected by the route overloads, so a handler sees `c.req.valid('json')` and `c.req.valid('query')` together.

Sources: [src/types.ts:184-210](repo://src/types.ts#L184-L210)
