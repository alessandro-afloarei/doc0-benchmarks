---
title: "Validation"
---
## Overview

`validator(target, fn)` builds a middleware that reads one part of the request, passes it to a function the user writes, and stores the function's result for the handler to read with `c.req.valid(target)`. The function can be a schema library's parser or a hand-written check. The middleware itself does no checking: it chooses the input by target, parses the body only when the Content-Type allows it, and stores the output. This page follows that path. The storage side is in [[HonoRequest]], and the typed client that sends the same inputs is in [[Typed Client]].

Sources: [src/validator/validator.ts:46-89](repo://src/validator/validator.ts#L46-L89)

## Targets

The first argument names one of the six targets in `ValidationTargets`: `json`, `form`, `query`, `param`, `header` or `cookie`. The function returned by `validator` switches on this name, so each target reads its own part of the request.

Sources: [src/validator/validator.ts:93-159](repo://src/validator/validator.ts#L93-L159), [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690)

`query` builds the value from `c.req.queries()`, and a key with one value is unwrapped to a string while a key with several stays an array. `param` uses `c.req.param()`, `header` uses `c.req.header()`, and `cookie` uses `getCookie(c)`. None of these read the body, so they run on every request method.

Sources: [src/validator/validator.ts:144-159](repo://src/validator/validator.ts#L144-L159)

## Body gating

A `json` target parses the body only when the Content-Type matches the JSON pattern, which accepts `application/json` and types with a `+json` suffix. If the header is missing or does not match, the value stays an empty object and the function still runs. A body that does match but is not valid JSON is refused with a 400 `HTTPException`.

Sources: [src/validator/validator.ts:24-24](repo://src/validator/validator.ts#L24-L24), [src/validator/validator.ts:93-104](repo://src/validator/validator.ts#L93-L104)

A `form` target accepts multipart and urlencoded bodies, and checks the Content-Type the same way. It reads the body as an array buffer and converts it to `FormData` with `bufferToFormData`, and caches the `FormData` in `bodyCache` so that a second `form` validator does not read the stream again. A key that ends in `[]`, or that repeats, becomes an array in the object the function receives.

Sources: [src/validator/validator.ts:25-26](repo://src/validator/validator.ts#L25-L26), [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143)

## The validation function

The function receives the value and the context, and may return a value, a `Response` or a promise of either. A returned `Response` is handed back to the caller, which stops the chain at this middleware. Any other value is stored with `addValidatedData` for the target, and then the middleware calls `next()`.

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

The function's type is captured so that the middleware's input and output types can be inferred. `ExtractValidatorOutput` reads the output from the function type, and `InferInput` gives the input type for each target from that output.

Sources: [src/validator/validator.ts:175-182](repo://src/validator/validator.ts#L175-L182), [src/validator/utils.ts:59-59](repo://src/validator/utils.ts#L59-L59)

## Using a validator in a route

A route places the validator before the handler, and the handler reads the result with `c.req.valid`. Each target stores one value, so a second validator for the same target on a route replaces the first value, while validators for different targets store separate values.

Sources: [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/request.ts:339-354](repo://src/request.ts#L339-L354)
