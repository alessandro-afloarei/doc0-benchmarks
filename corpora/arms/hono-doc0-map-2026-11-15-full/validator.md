---
title: "Validator"
---
## Overview

`validator()` is Hono's built-in validation middleware. It reads one part of the request (the JSON body, a form body, the query string, the path parameters, the headers or the cookies), hands that raw value to a function you write, and stores whatever the function returns so the handler can read it with `c.req.valid(target)`. It is deliberately schema-library agnostic: the function can be hand-written checks, a Zod `safeParse`, or anything else, and third-party packages such as `@hono/zod-validator` are thin wrappers around it.

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:89-172](repo://src/validator/validator.ts#L89-L172), [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8)

The middleware does two jobs. At runtime it extracts and caches the request data and either short-circuits with a `Response` or continues to `next()`. At the type level it builds an `Input` object (`in` for what a client must send, `out` for what the handler receives) that flows into the route's schema, which is what lets `c.req.valid()` return a precise type and lets the [[RPC Client (hc)]] know each endpoint's request shape. See [[Type System]] for how that schema is accumulated across routes, and [[HonoRequest]] for the other body readers.

Sources: [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/types.ts:37-46](repo://src/types.ts#L37-L46), [src/types.ts:2500-2530](repo://src/types.ts#L2500-L2530)

## Public interface

`validator` takes a target name and a validation function and returns a `MiddlewareHandler`. The module also exports the `ValidationFunction` type and the `InferInput` helper type for library authors.

Sources: [src/validator/index.ts:6-8](repo://src/validator/index.ts#L6-L8), [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22)

```ts
export type ValidationFunction<
  InputType,
  OutputType,
  E extends Env = {},
  P extends string = string,
> = (
  value: InputType,
  c: Context<E, P>
) => OutputType | TypedResponse | Promise<OutputType> | Promise<TypedResponse>
```

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22)

| Parameter | Type | Description |
| --- | --- | --- |
| `target` | `'json' \| 'form' \| 'query' \| 'param' \| 'header' \| 'cookie'` | Which part of the request to read. For `get` and `head` routes the type excludes `json` and `form`, since those requests carry no body. |
| `validationFunc` | `(value, c) => Output \| Response \| Promise<...>` | Receives the extracted value and the `Context`. Its return value becomes the validated data; returning a `Response` stops the chain and sends that response instead. |

Sources: [src/validator/validator.ts:9-12](repo://src/validator/validator.ts#L9-L12), [src/validator/validator.ts:85-88](repo://src/validator/validator.ts#L85-L88), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

A typical use validates the body, returns an error response on failure, and reads the typed result in the handler:

Sources: [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

```ts
import { Hono } from 'hono'
import { validator } from 'hono/validator'

const app = new Hono()

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
    const { title } = c.req.valid('json') // { title: string }
    return c.json({ message: `Created ${title}` }, 201)
  }
)
```

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:89-172](repo://src/validator/validator.ts#L89-L172), [src/request.ts:351-354](repo://src/request.ts#L351-L354)

## Targets and data extraction

### What each target reads

The middleware starts with `value = {}` and fills it according to `target`. The raw shapes the validation function can expect are described by `ValidationTargets`:

Sources: [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160), [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

| Target | Source | Raw value type | Notes |
| --- | --- | --- | --- |
| `json` | `c.req.json()` | `any` | Only parsed when `Content-Type` is JSON; otherwise the function receives `{}`. |
| `form` | `c.req.arrayBuffer()` then `bufferToFormData` | `Record<string, string \| File \| (string \| File)[]>` | Accepts `multipart/form-data` and `application/x-www-form-urlencoded`. |
| `query` | `c.req.queries()` | `Record<string, string \| string[]>` | A key seen once becomes a string, a repeated key stays an array. |
| `param` | `c.req.param()` | `Record<P, string>` | Optional params (`:id?`) are typed `string \| undefined`. |
| `header` | `c.req.header()` | `Record<string, string>` | Keys are as `Headers.forEach` yields them, i.e. lower-case. |
| `cookie` | `getCookie(c)` | `Record<string, string>` | Parses the `Cookie` header; `{}` when it is absent. |

Sources: [src/validator/validator.ts:93-160](repo://src/validator/validator.ts#L93-L160), [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690), [src/request.ts:185-198](repo://src/request.ts#L185-L198), [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48)

### Content-type checks

The body targets only touch the body when the request's `Content-Type` matches. Three regular expressions do the matching: JSON accepts `application/json` and any `application/<something>+json` vendor type with parameters; multipart requires `multipart/form-data` with an optional boundary; URL-encoded accepts `application/x-www-form-urlencoded` with parameters. All are case-insensitive.

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26)

```ts
const jsonRegex = /^application\/([a-z-\.]+\+)?json(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/i
const multipartRegex = /^multipart\/form-data(;\s?boundary=[a-zA-Z0-9'"()+_,\-./:=?]+)?$/i
const urlencodedRegex = /^application\/x-www-form-urlencoded(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/i
```

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26)

> [!WARNING]
> A missing or non-matching `Content-Type` is not an error: the `switch` simply `break`s and the validation function receives an empty object `{}`. Your function must reject `{}` (or a schema must require fields) if a body is mandatory; otherwise a client that forgets the header passes validation with no data.

Sources: [src/validator/validator.ts:94-97](repo://src/validator/validator.ts#L94-L97), [src/validator/validator.ts:105-111](repo://src/validator/validator.ts#L105-L111)

### JSON parsing

For `json`, the body is read with `c.req.json()`, which goes through HonoRequest's body cache so a later `c.req.json()` or `c.req.text()` in the handler still works. If `JSON.parse` throws, the middleware throws `HTTPException(400)` with the message `Malformed JSON in request body`, which the app's error handler turns into a 400 response (see [[Error Handling and HTTPException]]).

Sources: [src/validator/validator.ts:98-103](repo://src/validator/validator.ts#L98-L103), [src/request.ts:220-255](repo://src/request.ts#L220-L255)

### Form parsing and array fields

For `form`, the middleware first reuses `c.req.bodyCache.formData` if an earlier step already parsed it. Otherwise it reads the raw `arrayBuffer()` and converts it with `bufferToFormData`, which wraps the bytes in a `Response` whose `Content-Type` has its media type lower-cased (keeping the boundary) and calls `formData()`. The parsed `FormData` is stored back into `bodyCache.formData`. Any failure becomes `HTTPException(400)` with `Malformed FormData request.` followed by the underlying error message.

Sources: [src/validator/validator.ts:113-127](repo://src/validator/validator.ts#L113-L127), [src/utils/buffer.ts:106-117](repo://src/utils/buffer.ts#L106-L117)

The `FormData` entries are then folded into a prototype-less object. A key ending in `[]` always produces an array; any other key becomes an array only once it appears a second time:

Sources: [src/validator/validator.ts:129-141](repo://src/validator/validator.ts#L129-L141)

```ts
const form: BodyData<{ all: true }> = Object.create(null)
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

Sources: [src/validator/validator.ts:129-140](repo://src/validator/validator.ts#L129-L140)

> [!NOTE]
> The `[]` suffix is kept in the key: a field sent as `tags[]` is read as `value['tags[]']`, not `value.tags`. Using `Object.create(null)` means a field named `__proto__` or `constructor` cannot reach `Object.prototype`.

Sources: [src/validator/validator.ts:129-136](repo://src/validator/validator.ts#L129-L136)

## Validation flow

After extraction the middleware awaits the validation function. A `Response` result (including a `TypedResponse` from `c.json()` / `c.text()`) is returned immediately and `next()` never runs. Any other result is stored with `c.req.addValidatedData(target, res)` and the chain continues.

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

```mermaid
flowchart TD
  start["validator(target, fn) middleware"] --> ct["Read Content-Type header"]
  ct --> sw{"target"}
  sw -->|"json"| jsonCheck{"jsonRegex matches?"}
  jsonCheck -->|"no"| empty["value = {}"]
  jsonCheck -->|"yes"| parseJson["c.req.json()"]
  parseJson -->|"throws"| err400["HTTPException 400"]
  sw -->|"form"| formCheck{"multipart or urlencoded?"}
  formCheck -->|"no"| empty
  formCheck -->|"yes"| parseForm["bodyCache.formData or bufferToFormData"]
  parseForm -->|"throws"| err400
  sw -->|"query / param / header / cookie"| other["queries(), param(), header(), getCookie()"]
  parseJson --> call["await validationFunc(value, c)"]
  parseForm --> call
  other --> call
  empty --> call
  call --> isRes{"result instanceof Response?"}
  isRes -->|"yes"| ret["return the Response"]
  isRes -->|"no"| store["c.req.addValidatedData(target, res)"]
  store --> nxt["await next()"]
```

Sources: [src/validator/validator.ts:89-171](repo://src/validator/validator.ts#L89-L171)

Validated data lives in a private `#validatedData` map on the `HonoRequest`, reset per request in the constructor. `c.req.valid(target)` simply returns the entry for that target, so stacking several validators with different targets on one route gives the handler all of them, while two validators on the same target leave the last one's result.

Sources: [src/request.ts:53-53](repo://src/request.ts#L53-L53), [src/request.ts:70-80](repo://src/request.ts#L70-L80), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

```ts
app.get(
  '/search/:id',
  validator('param', (value) => ({ id: Number(value.id) })),
  validator('query', (value) => ({ q: String(value.q ?? '') })),
  (c) => {
    const { id } = c.req.valid('param')
    const { q } = c.req.valid('query')
    return c.json({ id, q })
  }
)
```

Sources: [src/validator/validator.ts:144-153](repo://src/validator/validator.ts#L144-L153), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Type inference

### Output and response extraction

The generic `VF` captures the exact type of the validation function so two helper types can split its return type. `ExtractValidatorOutput<VF>` unwraps a `Promise` and drops anything that is a `Response` or `TypedResponse`, leaving the data type the handler sees. `ExtractValidationResponse<VF>` does the opposite: it keeps only the `TypedResponse` branch, and the middleware is typed `MiddlewareHandler<E, P, V, ExtractValidationResponse<VF>>`, so an error response like `c.json({ error }, 400)` becomes part of the route's possible responses and shows up in the RPC client's response union.

Sources: [src/validator/validator.ts:28-44](repo://src/validator/validator.ts#L28-L44), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185), [src/validator/validator.ts:85-88](repo://src/validator/validator.ts#L85-L88)

### The Input object

The fifth generic `V` is the `Input` contributed to the route. `out` maps the target to the validator's output. `in` describes what the client sends: for `json` it is the output type (or an explicit `InputType` generic if one was given); for every other target it is `InferInput<Output, K, FormValue>`, because query, params, headers, cookies and forms are always strings or files on the wire, whatever the validator converts them into.

Sources: [src/validator/validator.ts:64-82](repo://src/validator/validator.ts#L64-L82), [src/types.ts:42-46](repo://src/types.ts#L42-L46)

```ts
V extends {
  in: {
    [K in U]: K extends 'json'
      ? unknown extends InputType
        ? ExtractValidatorOutput<VF>
        : InputType
      : InferInput<ExtractValidatorOutput<VF>, K, FormValue>
  }
  out: { [K in U]: ExtractValidatorOutput<VF> }
}
```

Sources: [src/validator/validator.ts:64-72](repo://src/validator/validator.ts#L64-L72)

`ToSchema` places `ExtractInput<I>` (the `in` part) as the endpoint's `input`, which is exactly what `hc` and `InferRequestType` expose. `c.req.valid(target)` is typed through `InputToDataByTarget<I, T>`, which picks the `out` entry for that target.

Sources: [src/types.ts:37-41](repo://src/types.ts#L37-L41), [src/types.ts:2500-2530](repo://src/types.ts#L2500-L2530), [src/types.ts:2720-2727](repo://src/types.ts#L2720-L2727), [src/request.ts:351-351](repo://src/request.ts#L351-L351)

### InferInput rules

`InferInput<Output, Target, T>` rewrites each property of the validator's output into its wire type. It keeps a property as-is when it is a union of string literals (so `'asc' | 'desc'` survives) or an optional union with `undefined`; otherwise it maps by target. If `Output` is `never` or not an object the result is `{}`, and an output that may be `undefined` yields a union with `undefined`.

Sources: [src/validator/utils.ts:9-69](repo://src/validator/utils.ts#L9-L69)

| Target | Property type in `in` |
| --- | --- |
| `form` | `T \| T[]` where `T` is `FormValue` (`string \| Blob`) |
| `query` | `string \| string[]` |
| `param` | `string` |
| `header` | `string` |
| `cookie` | `string` |
| anything else | `unknown` |

Sources: [src/validator/utils.ts:25-45](repo://src/validator/utils.ts#L25-L45), [src/types.ts:2680-2681](repo://src/types.ts#L2680-L2681)

```ts
// In @hono/zod-validator or similar:
type Input = InferInput<z.input<Schema>, 'query'>
// { orderBy: 'asc' | 'desc', page: string | string[] }
```

Sources: [src/validator/utils.ts:47-58](repo://src/validator/utils.ts#L47-L58)

> [!TIP]
> Validator libraries should pass their schema's input type through `InferInput` for non-JSON targets, so a `z.coerce.number()` query field shows up as `string | string[]` in the RPC client rather than `number`.

Sources: [src/validator/utils.ts:47-69](repo://src/validator/utils.ts#L47-L69)
