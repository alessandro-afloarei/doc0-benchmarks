---
title: "Validator and Typed Routes"
---
## Overview

`validator(target, fn)` from `hono/validator` is a middleware factory. It pulls one part of the request (the body as JSON, a form, the query string, path parameters, headers or cookies), passes it to your function, and stores the function's return value so the handler can read it with `c.req.valid(target)`. The same call also changes the route's TypeScript type, which is how the handler gets typed input and how the RPC client later learns what a route accepts ([[RPC Client (hc)]]). Schema libraries such as Zod are not part of this repository: you call them inside `fn`.

Sources: [src/validator/validator.ts:46-89](repo://src/validator/validator.ts#L46-L89), [src/validator/index.ts:6-8](repo://src/validator/index.ts#L6-L8)

## Targets and what each one reads

The `target` is one of `json`, `form`, `query`, `param`, `header` or `cookie`, the keys of `ValidationTargets`. The middleware builds the value to validate by target:

Sources: [src/validator/validator.ts:46-66](repo://src/validator/validator.ts#L46-L66), [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690)

| Target | Value passed to your function |
| --- | --- |
| `json` | `await c.req.json()`, only when `Content-Type` matches the JSON regex; otherwise `{}` |
| `form` | Object built from `FormData`, only for `multipart/form-data` or `application/x-www-form-urlencoded`; otherwise `{}` |
| `query` | `c.req.queries()` with one-element arrays unwrapped to a string |
| `param` | `c.req.param()` |
| `header` | `c.req.header()` (header names are lower-cased by the platform) |
| `cookie` | `getCookie(c)` |

Sources: [src/validator/validator.ts:9-26](repo://src/validator/validator.ts#L9-L26), [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160), [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690)

The type `ValidationTargetByMethod<M>` rules out `json` and `form` for `get` and `head`, since those requests carry no body; the check is at compile time only.

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12)

## Parsing and failure

For `json`, a body that does not parse raises `HTTPException(400, { message: 'Malformed JSON in request body' })`. For `form`, the middleware reuses `c.req.bodyCache.formData` if an earlier step cached it, and otherwise reads the body as an `ArrayBuffer`, converts it with `bufferToFormData` and caches it; a failure raises `HTTPException(400)` with `Malformed FormData request.` plus the underlying message. These exceptions are handled like any other ([[Middleware Composition and Error Handling]]).

Sources: [src/validator/validator.ts:93-143](repo://src/validator/validator.ts#L93-L143), [src/http-exception.ts:46-77](repo://src/http-exception.ts#L46-L77)

Form values are folded into one object. A key ending in `[]` always becomes an array; a repeated key turns its value into an array; a single plain key keeps one value. This is slightly different from `c.req.parseBody()`, which only builds arrays with the `all` option ([[HonoRequest and Body Parsing]]).

Sources: [src/validator/validator.ts:129-141](repo://src/validator/validator.ts#L129-L141), [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206)

```ts
formData.forEach((value, key) => {
  if (key.endsWith('[]')) {
    ;((form[key] ??= []) as unknown[]).push(value)
  } else if (Array.isArray(form[key])) {
    ;(form[key] as unknown[]).push(value)
  } else if (Object.hasOwn(form, key)) {
    form[key] = [form[key] as string | File, value]
  } else {
    form[key] = value
  }
})
```

Sources: [src/validator/validator.ts:129-141](repo://src/validator/validator.ts#L129-L141)

## The validation function and its result

After assembling the value, the middleware awaits `validationFunc(value, c)`. There are two outcomes:

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

- If the function returns a `Response`, the middleware returns it immediately and the chain stops. This is how a validator rejects a request, for example `return c.json({ error }, 400)`.
- Anything else is stored with `c.req.addValidatedData(target, res)` and the middleware continues with `await next()`.

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

`addValidatedData` writes to a per-target slot on the `HonoRequest`, and `valid(target)` reads it back; the handler calls `c.req.valid('json')` and gets the stored value.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## How the types flow

`validator` is generic over the function's type, `VF`. Two helper types extract information from it: `ExtractValidatorOutput<VF>` is the return type unless it is a `Response`/`TypedResponse` (then `never`), and `ExtractValidationResponse<VF>` is the `TypedResponse` the function may return, so error responses join the route's response union. These feed the middleware's declared type `MiddlewareHandler<E, P, V, ExtractValidationResponse<VF>>`, where `V` has an `in` and an `out` side keyed by target: `out` is the validated output, and `in` is what a caller must send (for `form`, `query`, `param`, `header`, `cookie` it passes through `InferInput`, which keeps literal unions and otherwise widens values to the wire type such as `string | string[]` for query).

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44), [src/validator/validator.ts:46-89](repo://src/validator/validator.ts#L46-L89), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185), [src/validator/utils.ts:25-45](repo://src/validator/utils.ts#L25-L45)

When such a middleware is passed to `app.get(path, validator(...), handler)`, the overloads of `HandlerInterface` merge the validator's `V` into the handler's input type `I` and register the route with the schema type `ToSchema<M, P, I, MergeTypedResponse<R>>`. `ToSchema` produces `{ [path]: { $method: { input, output, outputFormat, status } } }`, where `input` is the validated input plus path parameters (`AddParam`) and the rest comes from the response's `TypedResponse` ([[Context and Responses]] explains where `c.json` records it). The app's schema type `S` accumulates this, one `S & ToSchema<…>` per route.

Sources: [src/types.ts:130-170](repo://src/types.ts#L130-L170), [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529), [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

`HonoRequest.valid` is typed through `InputToDataByTarget<I, T>`, which reads the `T` key out of the handler's input type; a target you did not validate cannot be passed to `valid`. Path-parameter names are parsed from the route string by `ParamKeys` and `ParamKeyToRecord`, which turn `:id`, `:id{[0-9]+}` and `:id?` into typed keys with optional ones as `string | undefined`.

Sources: [src/types.ts:2698-2729](repo://src/types.ts#L2698-L2729), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

`route()` and `basePath()` keep the types aligned: `route('/api', sub)` returns an app whose schema is `S` merged with `MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>>`, which prefixes every path in the sub-app's schema and merges path parameters found in the prefix into `param` input types.

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217), [src/types.ts:2563-2600](repo://src/types.ts#L2563-L2600)
