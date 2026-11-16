---
type: api
title: Validator Middleware and Input Types
description: How the validator middleware in src/validator reads one input target (json, form, query, param, header, or cookie), parses the body when needed, calls a user validation function, stores the result on HonoRequest for c.req.valid(), and feeds the inferred input and output types into Context and the RPC client.
tags: [hono, validator, validation, middleware, json, form, typescript, inference]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-cfe41b47be940d4355103916
    resource: repo://src/validator/index.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Validator Middleware and Input Types

<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The validator middleware is Hono's built-in hook for checking request input. You pass it one input target and a validation function, and it runs that function on the parsed input before your handler. Any value it returns is stored on the request, and the handler reads it with `c.req.valid(target)`. The same middleware also carries type information: the target and the function's return type are encoded in the route's type, which is what lets [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md) know which arguments a call must provide. Implementation: `src/validator/validator.ts` (about 185 lines), with type helpers in `src/validator/utils.ts`.

## Using the middleware

```ts
app.post(
  '/posts',
  validator('json', (value, c) => {
    if (!value.title) return c.text('title is required', 400)
    return { title: String(value.title) }
  }),
  (c) => {
    const { title } = c.req.valid('json')
    return c.json({ title }, 201)
  }
)
```

`validator(target, validationFunc)` returns a `MiddlewareHandler`. The `index.ts` file exports `validator`, the `ValidationFunction` type, and the `InferInput` type. Validation libraries such as Zod or Valibot plug in by wrapping their schema in a function of the same shape; Hono does not depend on any of them.

## Input targets

The `target` argument is one of the keys of `ValidationTargets` (defined in `src/types.ts`): `json`, `form`, `query`, `param`, `header`, or `cookie`. The middleware builds the value to validate from the request in a `switch` on the target:

- **`json`** reads the body only when `Content-Type` matches the JSON pattern (`application/json` and `+json` subtypes). A body that cannot be parsed produces a `400` with `Malformed JSON in request body` by throwing `HTTPException`. If the content type does not match, the value is an empty object.
- **`form`** handles `multipart/form-data` and `application/x-www-form-urlencoded`. The body is read once with `arrayBuffer()` and converted with `bufferToFormData`; the resulting `FormData` is cached on `c.req.bodyCache.formData`, so a second `form` validator on the same request reuses it. Fields whose names end in `[]`, or that appear more than once, become arrays. A parse failure produces a `400` with `Malformed FormData request.`.
- **`query`** uses `c.req.queries()` and returns a single value for keys that appear once and an array for repeated keys.
<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`param`** returns `c.req.param()`, the decoded route parameters (see [Context and HonoRequest](/openwiki/architecture/context-and-request.md)).
- **`header`** returns all request headers as an object from `c.req.header()`.
- **`cookie`** returns `getCookie(c)`, all cookies parsed from the `Cookie` header.

Because `json` and `form` read the body, they interact with other body readers. The `bodyCache` on `HonoRequest` makes a second read possible for the body formats that the validator caches (see the body caching notes in the context page). Reading the body with `c.req.json()` in a handler after a `json` validator also works, because the cache returns the same text.

## Validation function and result

The validation function receives the value and the context: `(value, c) => result`. Its return value takes one of two paths:

- If it returns a `Response`, the middleware returns that response immediately and the handler does not run. This is the usual way to reject input with a custom status and body.
- Otherwise the value is stored with `c.req.addValidatedData(target, result)` and `next()` is called. The handler reads it with `c.req.valid(target)`.

Returning the input unchanged is valid, and so is returning a transformed object (for example, parsing a string into a number). The stored result is what handlers see, not the raw input.

<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Errors thrown by the validation function are not caught by the validator; they reach the app's error handler (see [Middleware Model and Composition](/openwiki/architecture/middleware-model.md)).

## Type flow

The types are carried by the generic parameters of `validator`:

- `U` is the target, and `P` the route path, used to type `param`.
- `VF` is the validation function type. `ExtractValidatorOutput<VF>` pulls its return type out, and `ExtractValidationResponse<VF>` extracts the `Response` types it may return.
- The returned middleware type is `MiddlewareHandler<E, P, V, ExtractValidationResponse<VF>>`, where `V` records the `in` and `out` shapes for the target.

When the input type is not given explicitly, the target's default type from `ValidationTargets` is used, and for `json` the function's parameter type is inferred. `InferInput<Schema, Target, FormValue>` in `src/validator/utils.ts` maps a schema's input type to the form-value shape the RPC client sends, so for example a `query` schema with a number field is typed as a string on the wire. `IsLiteralUnion` helps keep literal unions intact when a schema is inferred.

<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Through the route's `S` schema parameter, `c.req.valid(target)` is typed as the function's output, and the RPC client uses the input types to require the right arguments (see [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md)).

## Invariants and consequences

- Each validator call stores its result under one target, so a route can use several validators for different targets, for example `json` and `header`, and read both with `c.req.valid`.
- A second validator for the same target on the same route overwrites the stored value for that target.
- Validators run in registration order. A validator that returns a response stops the chain before later middleware or the handler runs.

## Representative tests

- `src/validator/validator.test.ts` covers the validator middleware.
- `src/validator/utils.test.ts` covers the input type helpers.

## Related pages

<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md)
<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Context and HonoRequest](/openwiki/architecture/context-and-request.md)
