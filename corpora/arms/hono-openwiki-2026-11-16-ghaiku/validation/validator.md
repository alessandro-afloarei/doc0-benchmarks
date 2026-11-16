---
type: concept
title: Validator and Typed Inputs
description: How the validator() middleware reads one request target (json, form, query, param, header, or cookie), converts it into a plain value, runs a caller-supplied validation function, and either stores the result for c.req.valid() or short-circuits with the function's Response - together with the malformed-input errors, the content-type gating for body targets, and the type-level plumbing in types.ts that carries validated inputs and typed responses through to the RPC client.
tags: [validator, validation, input, typed-responses, schema, request, types, json, form]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Validator and Typed Inputs

<!-- openwiki: broken internal link [/openwiki/core/context-and-request.md] link "/openwiki/core/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono does not bundle a schema library. Instead, `validator(target, validationFunc)` is a middleware that gives any validation function a uniform place in the request pipeline: it reads one part of the request, passes it to the function, stores the result for handlers, and lets the function short-circuit with a `Response`. The types in `src/types.ts` then carry the input and output shapes into the handler and the RPC client. The validator lives in `src/validator/validator.ts`. Its output is read through the `valid` method of `HonoRequest` described in [Context and HonoRequest](/openwiki/core/context-and-request.md).

## Targets

`validator` takes a target name from the `ValidationTargets` type: `json`, `form`, `query`, `param`, `header`, or `cookie`. The type declares what each target produces:

- `json` is typed as `any`.
- `form` is a record whose values are the form value type (`ParsedFormValue` by default) or arrays of it.
- `query` is `Record<string, string | string[]>`.
- `param` is a record over the path's parameter names, and a parameter whose name ends in `?` is typed as optional.
- `header` is a record over known request header names plus custom names, all strings.
- `cookie` is `Record<string, string>`.

At runtime the middleware reads each target as follows:

- **`json`** runs only when the `Content-Type` matches a JSON media type (`application/json` and `application/*+json`, with optional parameters). The body is parsed with `c.req.json()`. A body that fails to parse yields `400` with the message `Malformed JSON in request body`. For any other content type, the value is an empty object, and the validation function still runs.
- **`form`** runs only for `multipart/form-data` and `application/x-www-form-urlencoded`. The body is buffered once and stored in the body cache, so a handler that reads the body later reuses it. Each key ending in `[]` becomes an array. A key that appears more than once becomes an array of all its values. A body that cannot be parsed yields `400` with `Malformed FormData request.` followed by the parser's message.
- **`query`** reads `c.req.queries()` and unwraps single values, so a key that appears once is a string and a repeated key is an array.
- **`param`** returns `c.req.param()`, with decoded values.
- **`header`** returns all request headers through `c.req.header()`.
- **`cookie`** returns the parsed cookies through `getCookie(c)`.

The body targets are gated by content type, not by method. A `GET` route can declare a `form` or `json` validator, but the body is then empty and the value is `{}`. The `ValidationTargetByMethod` type prevents `get` and `head` methods from declaring body targets at compile time, so this combination is rejected by the type checker rather than at runtime.

## The Validation Function

The function receives the target value and the context, `(value, c)`, and returns one of three results:

- **A plain value** (any non-`Response` value). The middleware calls `c.req.addValidatedData(target, value)`, then `next()`. Handlers read the value with `c.req.valid(target)`.
- **A `Response`**, including a `TypedResponse` produced by `c.json` or `c.text` with a status. The middleware returns that response without calling `next()`, so the handler never runs. This is how a function reports a validation error with a specific status and body.
- **A promise** of either of the above. The middleware awaits it before deciding.

<!-- openwiki: broken internal link [/openwiki/middleware/composition-and-error-handling.md] link "/openwiki/middleware/composition-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
A thrown error is not handled by the validator. It propagates to the application's error handler (see [Middleware Composition and Error Handling](/openwiki/middleware/composition-and-error-handling.md)), so a validation library that throws on failure can rely on the app-level `onError` to format the response.

The type `ValidationFunction<InputType, OutputType, E, P>` describes this contract, and `ExtractValidatorOutput` removes `Response` types from the output so that the handler's `c.req.valid` type reflects only the successful value.

## Type-Level Flow

`types.ts` threads the validator's result through the application type:

- A route's type includes an `Input` record with `in` (what a client may send) and `out` (what the handler receives). The validator middleware adds an entry to `in` and `out` for its target, and `HonoRequest.valid<T>(target)` is typed through `InputToDataByTarget`, which reads the `out` entry for the target.
- `Schema` is the map from path to method to `Endpoint`. Each route contributes an endpoint whose `input` and `output` come from `ToSchema`, which keys on the method (`$get`, `$post`) and on the response status. `MergeSchemaPath` rewrites those keys when a sub-application is mounted under a base path, so mounted routes keep their types.
- `TypedResponse<T, U, F>` records the body type `T`, the status `U`, and the response format `F` (`json`, `text`, and so on). Handlers that return a typed response expose that information to the client, which reads it through `InferResponseType`.

<!-- openwiki: broken internal link [/openwiki/client/typed-rpc-client.md] link "/openwiki/client/typed-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
This is the mechanism that makes the RPC client typed. The client's `InferRequestType` reads the `in` side of each endpoint, so a client call with the wrong JSON shape fails to type-check against the same validator schema that the server enforces. See [Typed RPC Client (hc)](/openwiki/client/typed-rpc-client.md).

## Invariants and Failure Modes

- Only one validator per target and route is meaningful. A second validator for the same target overwrites the first's validated data.
- `c.req.valid(target)` returns `undefined` if no validator stored data for that target, so handlers must be mounted behind the matching validator.
- A body validator does not parse a body that the content-type check rejects, so a client that sends the wrong content type reaches the validation function with an empty object. The function must treat that case as invalid if the body is required.
- Malformed JSON and malformed form bodies are reported as `400` by the middleware before the validation function runs.

## Extension Seams

- Any function that matches the validation signature can be used, so schema libraries plug in without adapters. Their output type becomes the handler's `valid` type.
- New targets require changes to `ValidationTargets` and to the middleware's `switch`, which is why the target list is closed.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/validator/validator.test.ts` covers each target, the content-type gating, and the malformed-input errors, and `src/validator/utils.test.ts` covers the type utilities. The compile-time behavior is exercised by the type tests run through `tsc -p tsconfig.spec.json` (see [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md)).
